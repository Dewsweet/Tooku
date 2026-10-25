// @vitest-environment node
import { tookuServiceProtocol } from '../src/domain/serviceProtocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createUserApi } from '../server/api';
import { createNavidromeProxy, createPlaybackProxy } from '../server/navidromeProxy';
import { CredentialVault, sessionLifetime } from '../server/vault';
import { createRecommendationsApi } from '../server/recommendations/http';
import { createRecommendationService } from '../server/recommendations/service';
import { defaultRecommendationSettings, emptyRecommendationCredentials } from '../src/domain/recommendations';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const done of cleanups.splice(0).reverse()) await done(); vi.unstubAllEnvs(); });
function directory() { const dir = mkdtempSync(join(tmpdir(), 'tooku-session-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const forbiddenFetchPorts = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
async function listen(server: Server) {
  let address: ReturnType<Server['address']>;
  do {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
    if (forbiddenFetchPorts.has(address.port)) await new Promise<void>((done) => server.close(() => done()));
  } while (forbiddenFetchPorts.has(address.port));
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); }); };
  cleanups.push(close); return { origin: `http://127.0.0.1:${address.port}`, close };
}
async function fixture(options: Parameters<typeof createUserApi>[0] = { filename: ':memory:' }) {
  const verify = options.verify ?? vi.fn(async ({ u }: { u: string }) => u.toLowerCase());
  const users = createUserApi({ ...options, verify }); let closed = false;
  const proxy = createNavidromeProxy(options.upstream ?? 'http://127.0.0.1:1', users);
  const playback = createPlaybackProxy(options.upstream ?? 'http://127.0.0.1:1', users);
  const running = await listen(createServer((req, res) => {
    const next = () => { res.writeHead(404); res.end(); };
    if (req.url?.startsWith('/api/tooku-stream/')) void playback(req, res, next);
    else if (req.url?.startsWith('/api/navidrome/') || req.url?.startsWith('/nd/')) void proxy(req, res, next);
    else void users.handle(req, res, next);
  }));
  const close = async () => { if (closed) return; closed = true; await running.close(); users.close(); }; cleanups.push(close);
  const call = (path: string, method = 'GET', data?: unknown, cookie = '', headers: Record<string, string> = {}) => fetch(`${running.origin}/api/tooku/${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  const login = async (u = 'Alice', clientBase?: string, headers: Record<string, string> = {}) => {
    const auth = { u, t: randomBytes(16).toString('hex'), s: randomBytes(16).toString('hex') };
    const response = await call('session', 'POST', { ...auth, persistent: true, nativeToken: 'synthetic-native-token', admin: true, clientBase }, '', headers);
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
    const alias = await (await app.call('connection', 'POST', { server: upstream, purpose: 'alias' })).json() as { connectionId: string };
    expect(alias.connectionId).toMatch(/^[\w-]{43}$/);
    expect((await resolve('https://other.example.test')).status).toBe(502);
    const login = await app.login('Alice', upstream);
    expect(await (await app.call('session', 'GET', undefined, login.cookie)).json()).toMatchObject({ username: 'Alice', clientBase: upstream, persistent: true, serviceProtocol: tookuServiceProtocol });
    expect((await app.call('session', 'POST', { ...login.auth, persistent: true, clientBase: 'https://other.example.test' })).status).toBe(400);
  });
  it('registers a verified server with a short connection ticket and binds proxy, data and playback to its session', async () => {
    let now = Date.now();
    const seen: URL[] = [];
    const remote = await listen(createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://fixture'); seen.push(url);
      if (url.pathname === '/rest/ping.view') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', type: 'navidrome', serverVersion: 'fixture' } })); return;
      }
      if (url.pathname === '/auth/login') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ token: 'native', isAdmin: false })); return; }
      if (url.pathname === '/rest/stream.view') { res.setHeader('Content-Type', 'audio/mpeg'); res.end('remote-audio'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', song: { id: 'remote-song' } } }));
    }));
    const verifiedTargets: string[] = [];
    const verify = vi.fn(async ({ u }: { u: string }, target: string) => { verifiedTargets.push(target); return u.toLowerCase(); });
    const app = await fixture({ filename: ':memory:', upstream: 'http://127.0.0.1:1', allowPrivateServers: true, verify, now: () => now });
    const fixed = await app.login('Alice');
    const registration = await app.call('connection', 'POST', { server: remote.origin });
    expect(registration.status).toBe(200);
    const connection = await registration.json() as { managed: boolean; connectionId: string };
    expect(connection.managed).toBe(true); expect(connection.connectionId).toMatch(/^[\w-]{43}$/);
    expect((await fetch(`${app.origin}/api/navidrome/rest/ping.view`, { headers: { 'X-Tooku-Connection': connection.connectionId } })).status).toBe(200);
    expect((await fetch(`${app.origin}/api/navidrome/rest/getSong.view?id=remote-song`, { headers: { 'X-Tooku-Connection': connection.connectionId } })).status).toBe(403);
    const auth = { u: 'Alice', t: randomBytes(16).toString('hex'), s: randomBytes(16).toString('hex') };
    expect((await app.call('session', 'POST', { ...auth, persistent: true, clientBase: remote.origin })).status).toBe(400);
    const login = await app.call('session', 'POST', { ...auth, persistent: true, clientBase: remote.origin, connectionId: connection.connectionId });
    expect(login.status).toBe(200); const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await login.clone().json() as { owner: string }).owner).not.toBe(fixed.info.owner);
    expect(verifiedTargets).toContain(remote.origin);
    const restored = await (await app.call('session', 'GET', undefined, cookie)).json();
    expect(restored).toMatchObject({ username: 'Alice', clientBase: remote.origin, persistent: true });
    const song = await fetch(`${app.origin}/api/navidrome/rest/getSong.view?id=remote-song&tookuSession=1&tookuUser=Alice`, { headers: { Cookie: cookie } });
    expect(song.status).toBe(200); expect(await song.text()).toContain('remote-song');
    const grant = await (await app.call('playback', 'POST', { id: 'remote-song', mode: 'original' }, cookie)).json() as { url: string };
    const audio = await fetch(`${app.origin}${grant.url}`, { headers: { Cookie: cookie } });
    expect(audio.status).toBe(200); expect(await audio.text()).toBe('remote-audio');
    expect(seen.some((url) => url.pathname === '/rest/stream.view' && url.searchParams.get('id') === 'remote-song')).toBe(true);
    const expiring = await (await app.call('connection', 'POST', { server: remote.origin })).json() as { connectionId: string };
    now += 10 * 60000 + 1;
    expect((await app.call('session', 'POST', { ...auth, persistent: true, clientBase: remote.origin, connectionId: expiring.connectionId })).status).toBe(400);
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
    expect((await app.call('session', 'DELETE', undefined, first.cookie, { Origin: '%' })).status).toBe(403);
    expect((await app.call('credentials', 'GET', undefined, first.cookie, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    now += sessionLifetime + 1; expect((await app.call('session', 'GET', undefined, first.cookie)).status).toBe(401);
    const second = await app.login(); revoked = true;
    expect((await app.call('session', 'GET', undefined, second.cookie)).status).toBe(401);
    revoked = false; expect((await app.call('session', 'GET', undefined, second.cookie)).status).toBe(401);
  });
  it('trusts a single forwarded HTTPS protocol only when the reverse proxy is explicitly trusted', async () => {
    const app = await fixture();
    let login = await app.login('Alice', undefined, { 'X-Forwarded-Proto': 'https' });
    expect(login.response.headers.get('set-cookie')).not.toContain('; Secure');
    vi.stubEnv('TOOKU_TRUST_PROXY', 'true');
    login = await app.login('Alice', undefined, { 'X-Forwarded-Proto': 'https' });
    expect(login.response.headers.get('set-cookie')).toContain('; Secure');
    login = await app.login('Alice', undefined, { 'X-Forwarded-Proto': 'https, http' });
    expect(login.response.headers.get('set-cookie')).not.toContain('; Secure');
  });
  it('keeps the original ciphertext when the encryption key is missing, wrong or the record is tampered with', () => {
    const dir = directory(); const file = join(dir, 'security.sqlite'); const key = join(dir, 'tooku-secret.key');
    const vault = new CredentialVault(file); vault.saveCredentials('owner', 0, { aiKey: 'synthetic-key' }); vault.close();
    const original = readFileSync(key); unlinkSync(key);
    expect(() => new CredentialVault(file)).toThrow('key is missing');
    writeFileSync(key, randomBytes(32)); expect(() => new CredentialVault(file)).toThrow();
    writeFileSync(key, original); const restored = new CredentialVault(file); expect(restored.credentials('owner').credentials.aiKey).toBe('synthetic-key'); restored.close();
  });
  it('migrates the security database and keeps stable server ids and aliases encrypted', () => {
    const dir = directory(); const file = join(dir, 'security.sqlite');
    const legacy = new DatabaseSync(file); legacy.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE credentials (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL) STRICT; PRAGMA user_version=1;`); legacy.close();
    let vault = new CredentialVault(file); const first = vault.ensureServer('https://private-name.example/music', 100);
    expect(first.id).toMatch(/^[\w-]{22}$/); expect(vault.ensureServer('https://private-name.example/music').id).toBe(first.id);
    expect(vault.addServerAlias(first.id, 'https://new-name.example/music', 200)).toMatchObject({ primary: 'https://private-name.example/music', aliases: ['https://private-name.example/music', 'https://new-name.example/music'] });
    vault.close();
    expect(readFileSync(file).includes(Buffer.from('private-name.example'))).toBe(false);
    vault = new CredentialVault(file); expect(vault.serverByAddress('https://new-name.example/music')?.id).toBe(first.id);
    expect(vault.removeServerAlias(first.id, 'https://private-name.example/music').aliases).toEqual(['https://new-name.example/music']);
    expect(() => vault.removeServerAlias(first.id, 'https://new-name.example/music')).toThrow('至少保留一个'); vault.close();
    const migrated = new DatabaseSync(file, { readOnly: true }); expect(migrated.prepare('PRAGMA user_version').get()?.user_version).toBe(2); migrated.close();
  });
  it('adds an explicitly confirmed address alias and reuses the original account owner', async () => {
    const protocol = () => createServer((req, res) => {
      const url = new URL(req.url!, 'http://fixture');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ 'subsonic-response': url.pathname === '/rest/ping.view' ? { status: 'ok', type: 'navidrome' } : { status: 'ok' } }));
    });
    const original = await listen(protocol()); const replacement = await listen(protocol());
    let mismatch = false;
    const app = await fixture({ filename: ':memory:', upstream: original.origin, allowPrivateServers: true, verify: async ({ u }, target) => mismatch && target === replacement.origin ? 'different-account' : u.toLowerCase() });
    const first = await app.login('Alice', original.origin);
    const candidate = await (await app.call('connection', 'POST', { server: replacement.origin })).json() as { connectionId: string };
    expect((await app.call('server/aliases', 'POST', { connectionId: candidate.connectionId }, first.cookie)).status).toBe(400);
    mismatch = true; expect((await app.call('server/aliases', 'POST', { connectionId: candidate.connectionId, confirm: true }, first.cookie)).status).toBe(409); mismatch = false;
    const linked = await app.call('server/aliases', 'POST', { connectionId: candidate.connectionId, confirm: true }, first.cookie);
    expect(linked.status).toBe(200); expect(await linked.json()).toMatchObject({ address: original.origin, primary: original.origin, aliases: [original.origin, replacement.origin] });
    const current = await app.call('server', 'GET', undefined, first.cookie); expect((await current.json() as { aliases: string[] }).aliases).toContain(replacement.origin);
    const preferred = await app.call('server', 'PATCH', { primary: replacement.origin }, first.cookie);
    expect(preferred.status).toBe(200); expect(await preferred.json()).toMatchObject({ primary: replacement.origin });
    expect((await app.call('server', 'PATCH', { primary: 'https://unverified.example.test' }, first.cookie)).status).toBe(400);
    expect((await app.call('server/aliases', 'DELETE', { address: original.origin, confirm: true }, first.cookie)).status).toBe(409);
    const nextCandidate = await (await app.call('connection', 'POST', { server: replacement.origin })).json() as { connectionId: string };
    const auth = { u: 'Alice', t: randomBytes(16).toString('hex'), s: randomBytes(16).toString('hex') };
    const next = await app.call('session', 'POST', { ...auth, persistent: true, clientBase: replacement.origin, connectionId: nextCandidate.connectionId });
    expect(next.status).toBe(200); expect((await next.clone().json() as { owner: string }).owner).toBe(first.info.owner);
    const nextCookie = next.headers.get('set-cookie')?.split(';')[0]; if (!nextCookie) throw new Error('Missing replacement cookie');
    const removed = await app.call('server/aliases', 'DELETE', { address: original.origin, confirm: true }, nextCookie);
    expect(removed.status).toBe(200); expect(await removed.json()).toMatchObject({ address: replacement.origin, primary: replacement.origin, aliases: [replacement.origin] });
    expect((await app.call('session', 'GET', undefined, first.cookie)).status).toBe(401);
    expect((await app.call('server/aliases', 'DELETE', { address: replacement.origin, confirm: true }, nextCookie)).status).toBe(409);
  });
  it('authenticates protocol GET and form-POST requests through the same proxy without browser auth URLs', async () => {
    const seen: { url: URL; body: string; headers: IncomingHttpHeaders }[] = [];
    const upstream = await listen(createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      try { for await (const chunk of req) chunks.push(chunk); }
      catch { return; }
      seen.push({ url: new URL(req.url!, 'http://fixture'), body: Buffer.concat(chunks).toString(), headers: req.headers });
      res.setHeader('Set-Cookie', 'upstream=must-not-leak'); res.setHeader('X-Powered-By', 'fixture');
      res.end('ok');
    }));
    const app = await fixture({ filename: ':memory:', upstream: upstream.origin }); const login = await app.login();
    let firstResponse: Response | undefined;
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`${app.origin}/api/navidrome/rest/getSong.view?id=song&tookuSession=1`, { method, headers: { Cookie: login.cookie, Authorization: 'Bearer browser-value', 'X-Forwarded-For': '203.0.113.4', 'X-Forwarded-Host': 'spoofed.test', 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/x-www-form-urlencoded' }, body: method === 'POST' ? 'songId=a&songId=a' : undefined });
      firstResponse ??= response;
      expect(response.status).toBe(200); expect(await response.text()).toBe('ok');
    }
    expect(firstResponse?.headers.get('set-cookie')).toBeNull(); expect(firstResponse?.headers.get('x-powered-by')).toBeNull();
    expect(seen).toHaveLength(2); expect(seen[1].body).toBe('songId=a&songId=a');
    for (const request of seen) {
      expect(request.url.searchParams.get('t')).toBe(login.auth.t); expect(request.url.searchParams.has('tookuSession')).toBe(false);
      expect(request.headers.cookie).toBeUndefined(); expect(request.headers.authorization).toBeUndefined();
      expect(request.headers['x-forwarded-for']).toBeUndefined(); expect(request.headers['x-forwarded-host']).toBeUndefined(); expect(request.headers['x-forwarded-proto']).toBeUndefined();
    }
    expect((await fetch(`${app.origin}/api/navidrome/rest/ping.view?tookuSession=1`)).status).toBe(401);
    expect((await fetch(`${app.origin}/api/navidrome/rest/ping.view?tookuSession=1&tookuUser=another-user`, { headers: { Cookie: login.cookie } })).status).toBe(401);
    expect((await fetch(`${app.origin}/api/navidrome/rest/ping.view?tookuSession=1&tookuUser=Alice&tookuOwner=another-server`, { headers: { Cookie: login.cookie } })).status).toBe(401);
    expect((await fetch(`${app.origin}/api/navidrome/api/artist/artist?tookuSession=1&tookuUser=Alice`, { headers: { Cookie: login.cookie } })).status).toBe(200);
    expect(seen[2].headers['x-nd-authorization']).toBe('Bearer synthetic-native-token');
    expect((await fetch(`${app.origin}/api/navidrome/api/artist/artist/image?tookuSession=1&tookuUser=Alice`, { method: 'POST', headers: { Cookie: login.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(415);
    const oversizedStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${app.origin}/api/navidrome/api/artist/artist/image?tookuSession=1&tookuUser=Alice`, { method: 'POST', headers: { Cookie: login.cookie, 'Content-Type': 'multipart/form-data; boundary=fixture' } }, (response) => {
        response.resume(); response.on('end', () => resolve(response.statusCode ?? 0));
      });
      request.on('error', reject);
      for (let index = 0; index < 34; index++) request.write(Buffer.alloc(65536));
      request.end();
    });
    expect(oversizedStatus).toBe(413);
    const rawToken = 'a'.repeat(32);
    expect((await fetch(`${app.origin}/api/navidrome/rest/ping.view?u=new-user&t=${rawToken}&s=${'b'.repeat(16)}`, { headers: { Cookie: login.cookie } })).status).toBe(200);
    expect(seen[3].url.searchParams.get('t')).toBe(rawToken);
    expect((await fetch(`${app.origin}/nd/rest/ping.view`, { headers: { Cookie: login.cookie } })).status).toBe(200);
  });
  it('uses short same-origin playback grants bound to the session, track and transcode mode', async () => {
    const seen: { url: URL; range: string | undefined; cookie: string | undefined }[] = [];
    const upstream = await listen(createServer((req, res) => {
      const url = new URL(req.url!, 'http://fixture'); seen.push({ url, range: req.headers.range, cookie: req.headers.cookie });
      if (url.searchParams.get('id') === 'redirect') { res.writeHead(302, { Location: `https://cdn.invalid/audio?t=${url.searchParams.get('t')}` }); res.end(); return; }
      res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 10-19/100', 'Accept-Ranges': 'bytes', 'Set-Cookie': 'navidrome=private', 'Content-Disposition': 'attachment; filename="private.mp3"' });
      res.end('synthetic-audio');
    }));
    const app = await fixture({ filename: ':memory:', upstream: upstream.origin });
    const alice = await app.login('Alice'); const bob = await app.login('Bob');
    const issue = async (cookie = alice.cookie) => {
      const response = await app.call('playback', 'POST', { id: 'song_1', mode: 'compatible' }, cookie);
      expect(response.status).toBe(200); return await response.json() as { url: string; expiresAt: number };
    };
    const first = await issue();
    expect(first.url).toMatch(/^\/api\/tooku-stream\/[a-zA-Z0-9_-]{43}$/); expect(first.expiresAt).toBeGreaterThan(Date.now());
    expect(first.url).not.toContain('?');
    expect((await fetch(`${app.origin}${first.url}`)).status).toBe(401);
    expect((await fetch(`${app.origin}${first.url}`, { headers: { Cookie: bob.cookie } })).status).toBe(401);
    expect((await fetch(`${app.origin}${first.url}`, { headers: { Cookie: alice.cookie, Range: 'bytes=0-1,5-6' } })).status).toBe(416);
    const stream = await fetch(`${app.origin}${first.url}`, { headers: { Cookie: alice.cookie, Range: 'bytes=10-19' } });
    expect(stream.status).toBe(206); expect(await stream.text()).toBe('synthetic-audio');
    expect(stream.headers.get('content-type')).toBe('application/octet-stream');
    expect(stream.headers.get('cache-control')).toBe('private, no-store'); expect(stream.headers.get('content-disposition')).toBe('inline');
    expect(stream.headers.get('cross-origin-resource-policy')).toBe('same-origin'); expect(stream.headers.get('set-cookie')).toBeNull();
    expect(seen).toHaveLength(1); expect(seen[0].range).toBe('bytes=10-19'); expect(seen[0].cookie).toBeUndefined();
    expect(seen[0].url.pathname).toBe('/rest/stream.view'); expect(seen[0].url.searchParams.get('id')).toBe('song_1');
    expect(seen[0].url.searchParams.get('format')).toBe('mp3'); expect(seen[0].url.searchParams.get('maxBitRate')).toBe('320');
    expect(seen[0].url.searchParams.get('u')).toBe(alice.auth.u); expect(seen[0].url.searchParams.get('t')).toBe(alice.auth.t);
    const redirectGrant = await (await app.call('playback', 'POST', { id: 'redirect', mode: 'original' }, alice.cookie)).json() as { url: string };
    const redirected = await fetch(`${app.origin}${redirectGrant.url}`, { headers: { Cookie: alice.cookie } });
    expect(redirected.status).toBe(502); expect(redirected.headers.get('location')).toBeNull(); expect(await redirected.text()).toBe('');
    const second = await issue(); expect((await fetch(`${app.origin}${first.url}`, { headers: { Cookie: alice.cookie } })).status).toBe(404);
    await app.call('session', 'DELETE', undefined, alice.cookie);
    expect((await fetch(`${app.origin}${second.url}`, { headers: { Cookie: alice.cookie } })).status).toBe(404);
  });
  it('expires playback grants and limits abnormal concurrent stream reuse', async () => {
    let now = Date.now(); const responses: import('node:http').ServerResponse[] = [];
    let third!: () => void; const threeArrived = new Promise<void>((resolve) => { third = resolve; });
    const upstream = await listen(createServer((_req, res) => {
      responses.push(res); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.flushHeaders();
      if (responses.length === 3) third();
    }));
    const app = await fixture({ filename: ':memory:', upstream: upstream.origin, now: () => now }); const login = await app.login();
    const grant = await (await app.call('playback', 'POST', { id: 'song', mode: 'original' }, login.cookie)).json() as { url: string };
    const pending = Array.from({ length: 3 }, () => fetch(`${app.origin}${grant.url}`, { headers: { Cookie: login.cookie } }));
    await threeArrived;
    expect((await fetch(`${app.origin}${grant.url}`, { headers: { Cookie: login.cookie } })).status).toBe(429);
    for (const response of responses) response.end('audio');
    for (const response of await Promise.all(pending)) await response.arrayBuffer();
    const expiring = await (await app.call('playback', 'POST', { id: 'song', mode: 'original' }, login.cookie)).json() as { url: string };
    now += 4 * 60 * 60 * 1000 + 1;
    expect((await fetch(`${app.origin}${expiring.url}`, { headers: { Cookie: login.cookie } })).status).toBe(410);
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
