// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createUserApi } from '../server/api';
import { createNavidromeProxy } from '../server/navidromeProxy';
import { CredentialVault, sessionLifetime } from '../server/vault';
import { createRecommendationsApi } from '../server/recommendations/http';
import { createRecommendationService } from '../server/recommendations/service';
import { defaultRecommendationSettings, emptyRecommendationCredentials } from '../src/domain/recommendations';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const done of cleanups.splice(0).reverse()) await done(); vi.unstubAllEnvs(); });
function directory() { const dir = mkdtempSync(join(tmpdir(), 'tooku-session-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); }); };
  cleanups.push(close); return { origin: `http://127.0.0.1:${address.port}`, close };
}
async function fixture(options: Parameters<typeof createUserApi>[0] = { filename: ':memory:' }) {
  const verify = options.verify ?? vi.fn(async ({ u }: { u: string }) => u.toLowerCase());
  const users = createUserApi({ ...options, verify }); let closed = false;
  const proxy = createNavidromeProxy(options.upstream ?? 'http://127.0.0.1:1', users);
  const running = await listen(createServer((req, res) => {
    const next = () => { res.writeHead(404); res.end(); };
    if (req.url?.startsWith('/api/navidrome/') || req.url?.startsWith('/nd/')) void proxy(req, res, next);
    else void users.handle(req, res, next);
  }));
  const close = async () => { if (closed) return; closed = true; await running.close(); users.close(); }; cleanups.push(close);
  const call = (path: string, method = 'GET', data?: unknown, cookie = '', headers: Record<string, string> = {}) => fetch(`${running.origin}/api/tooku/${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  const login = async (u = 'Alice', clientBase?: string) => {
    const auth = { u, t: randomBytes(16).toString('hex'), s: randomBytes(16).toString('hex') };
    const response = await call('session', 'POST', { ...auth, persistent: true, nativeToken: 'synthetic-native-token', admin: true, clientBase });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')?.split(';')[0]; if (!cookie) throw new Error('Missing test cookie');
    return { auth, cookie, response, info: await response.json() as { owner: string } };
  };
  return { ...running, users, call, login, close, verify };
}

describe('persistent browser sessions and encrypted credentials', () => {
  it('recognizes only the configured upstream and restores its original browser identity', async () => {
    const upstream = 'http://127.0.0.1:44533'; const app = await fixture({ filename: ':memory:', upstream });
    const resolve = (server: string) => app.call('connection', 'POST', { server });
    expect(await (await resolve(upstream)).json()).toEqual({ managed: true });
    expect(await (await resolve('http://localhost:44533')).json()).toEqual({ managed: true });
    expect(await (await resolve('https://other.example.test')).json()).toEqual({ managed: false });
    const login = await app.login('Alice', upstream);
    expect(await (await app.call('session', 'GET', undefined, login.cookie)).json()).toMatchObject({ username: 'Alice', clientBase: upstream, persistent: true });
    expect((await app.call('session', 'POST', { ...login.auth, persistent: true, clientBase: 'https://other.example.test' })).status).toBe(400);
  });
  it('survives a server restart, revalidates upstream auth, keeps secrets server-side and revokes logout', async () => {
    const dir = directory(); const filename = join(dir, 'tooku.sqlite');
    const first = await fixture({ filename }); const login = await first.login();
    expect(login.response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(login.response.headers.get('set-cookie')).toContain(`Max-Age=${sessionLifetime / 1000}`);
    expect(login.info).not.toHaveProperty('token'); expect(login.info).not.toHaveProperty('auth');
    const secret = randomBytes(24).toString('hex');
    const saved = await first.call('credentials', 'PUT', { revision: 0, credentials: { aiKey: secret } }, login.cookie);
    expect(await saved.json()).toMatchObject({ revision: 1, saved: { aiKey: true, lastfmKey: false } });
    await first.close();
    const bytes = readFileSync(join(dir, 'tooku-security.sqlite'));
    for (const value of [secret, login.auth.t, login.auth.s, login.cookie.split('=')[1], 'synthetic-native-token']) expect(bytes.includes(Buffer.from(value))).toBe(false);
    const second = await fixture({ filename });
    expect((await second.call('session', 'GET', undefined, login.cookie)).status).toBe(200);
    expect(second.verify).toHaveBeenCalledTimes(1);
    const status = await (await second.call('credentials', 'GET', undefined, login.cookie)).text();
    expect(status).not.toContain(secret); expect(JSON.parse(status)).toMatchObject({ revision: 1, saved: { aiKey: true } });
    const logout = await second.call('session', 'DELETE', undefined, login.cookie);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await second.call('credentials', 'GET', undefined, login.cookie)).status).toBe(401);
    await second.close();
    const third = await fixture({ filename }); expect((await third.call('session', 'GET', undefined, login.cookie)).status).toBe(401);
  });
  it('isolates accounts, rejects stale credential revisions, supports removal and invalidates the previous browser session on login', async () => {
    const app = await fixture(); const alice = await app.login(); const bob = await app.login('Bob');
    expect((await app.call('credentials', 'PUT', { revision: 0, credentials: { lastfmKey: 'synthetic-key' } }, alice.cookie)).status).toBe(200);
    expect((await (await app.call('credentials', 'GET', undefined, bob.cookie)).json()).saved.lastfmKey).toBe(false);
    expect((await app.call('credentials', 'PUT', { revision: 0, credentials: { aiKey: 'conflict' } }, alice.cookie)).status).toBe(409);
    expect((await app.call('credentials', 'PUT', { revision: 1, credentials: { password: 'rejected' } }, alice.cookie)).status).toBe(400);
    expect((await app.call('credentials', 'PUT', { revision: 1, credentials: emptyRecommendationCredentials }, alice.cookie)).status).toBe(200);
    expect((await (await app.call('credentials', 'GET', undefined, alice.cookie)).json()).saved.lastfmKey).toBe(false);
    await app.call('session', 'POST', { ...bob.auth, persistent: true }, alice.cookie);
    expect((await app.call('session', 'GET', undefined, alice.cookie)).status).toBe(401);
    expect((await app.call('data', 'PUT', { revision: 0 }, bob.cookie, { 'X-Tooku-Owner': alice.info.owner })).status).toBe(401);
    expect((await app.call('session', 'DELETE', undefined, bob.cookie, { 'X-Tooku-Owner': alice.info.owner })).status).toBe(401);
    expect((await app.call('session', 'GET', undefined, bob.cookie)).status).toBe(200);
  });
  it('enforces expiry, upstream revocation, same-origin checks and secure-cookie deployment configuration', async () => {
    let now = Date.now(); let revoked = false;
    const { DataError } = await import('../server/store');
    const app = await fixture({ filename: ':memory:', now: () => now, verify: async ({ u }) => { if (revoked) throw new DataError(401, 'revoked'); return u; } });
    vi.stubEnv('TOOKU_COOKIE_SECURE', 'true');
    const first = await app.login(); expect(first.response.headers.get('set-cookie')).toContain('; Secure');
    expect((await app.call('session', 'DELETE', undefined, first.cookie, { Origin: 'https://foreign.test' })).status).toBe(403);
    expect((await app.call('credentials', 'GET', undefined, first.cookie, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    now += sessionLifetime + 1; expect((await app.call('session', 'GET', undefined, first.cookie)).status).toBe(401);
    const second = await app.login(); revoked = true;
    expect((await app.call('session', 'GET', undefined, second.cookie)).status).toBe(401);
    revoked = false; expect((await app.call('session', 'GET', undefined, second.cookie)).status).toBe(401);
  });
  it('keeps the original ciphertext when the encryption key is missing, wrong or the record is tampered with', () => {
    const dir = directory(); const file = join(dir, 'security.sqlite'); const key = join(dir, 'tooku-secret.key');
    const vault = new CredentialVault(file); vault.saveCredentials('owner', 0, { aiKey: 'synthetic-key' }); vault.close();
    const original = readFileSync(key); unlinkSync(key);
    expect(() => new CredentialVault(file)).toThrow('key is missing');
    writeFileSync(key, randomBytes(32)); expect(() => new CredentialVault(file)).toThrow();
    writeFileSync(key, original); const restored = new CredentialVault(file); expect(restored.credentials('owner').credentials.aiKey).toBe('synthetic-key'); restored.close();
  });
  it('authenticates media and form-POST requests through the same proxy without browser auth URLs', async () => {
    const seen: { url: URL; body: string; header: string | string[] | undefined }[] = [];
    const upstream = await listen(createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      seen.push({ url: new URL(req.url!, 'http://fixture'), body: Buffer.concat(chunks).toString(), header: req.headers['x-nd-authorization'] });
      res.end('ok');
    }));
    const app = await fixture({ filename: ':memory:', upstream: upstream.origin }); const login = await app.login();
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`${app.origin}/api/navidrome/rest/stream.view?id=song&tookuSession=1`, { method, headers: { Cookie: login.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: method === 'POST' ? 'songId=a&songId=a' : undefined });
      expect(response.status).toBe(200); expect(await response.text()).toBe('ok');
    }
    expect(seen).toHaveLength(2); expect(seen[1].body).toBe('songId=a&songId=a');
    for (const request of seen) { expect(request.url.searchParams.get('t')).toBe(login.auth.t); expect(request.url.searchParams.has('tookuSession')).toBe(false); }
    expect((await fetch(`${app.origin}/api/navidrome/rest/ping.view?tookuSession=1`)).status).toBe(401);
    expect((await fetch(`${app.origin}/api/navidrome/rest/ping.view?tookuSession=1&tookuUser=another-user`, { headers: { Cookie: login.cookie } })).status).toBe(401);
    expect((await fetch(`${app.origin}/api/navidrome/api/artist/artist?tookuSession=1&tookuUser=Alice`, { headers: { Cookie: login.cookie } })).status).toBe(200);
    expect(seen[2].header).toBe('Bearer synthetic-native-token');
    const rawToken = 'a'.repeat(32);
    expect((await fetch(`${app.origin}/api/navidrome/rest/ping.view?u=new-user&t=${rawToken}&s=${'b'.repeat(16)}`, { headers: { Cookie: login.cookie } })).status).toBe(200);
    expect(seen[3].url.searchParams.get('t')).toBe(rawToken);
    expect((await fetch(`${app.origin}/nd/rest/ping.view`, { headers: { Cookie: login.cookie } })).status).toBe(200);
  });
  it('uses saved credentials only for an authenticated opt-in recommendation request and never echoes keys', async () => {
    const app = await fixture(); const login = await app.login(); const key = randomBytes(16).toString('hex');
    await app.call('credentials', 'PUT', { revision: 0, credentials: { aiKey: key } }, login.cookie);
    const service = createRecommendationService({ complete: vi.fn(async (_base, supplied) => { expect(supplied).toBe(key); return { choices: [{ message: { content: '{"ok":true}' } }] }; }) });
    const recommendations = createRecommendationsApi(service, app.users.recommendationCredentials); cleanups.push(() => recommendations.close());
    const running = await listen(createServer((req, res) => { void recommendations.handle(req, res, () => res.end()); }));
    const payload = { target: 'ai', settings: { ...defaultRecommendationSettings, aiBaseUrl: 'https://example.test/v1', model: 'fixture' }, credentials: emptyRecommendationCredentials, useSavedCredentials: true };
    const response = await fetch(`${running.origin}/api/recommendations/check`, { method: 'POST', headers: { Cookie: login.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(response.status).toBe(200); expect(await response.text()).not.toContain(key);
    const anonymous = await fetch(`${running.origin}/api/recommendations/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); expect(anonymous.status).toBe(401);
  });
});
