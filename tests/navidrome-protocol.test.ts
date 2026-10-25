// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type RequestListener } from 'node:http';
import { requestNavidromeProtocol } from '../server/navidromeProtocol';
import { connectionFailure } from '../server/navidromeErrors';
import { resolveNavidromeTarget } from '../server/navidromeTarget';
import { navidromeConnectionMessage } from '../src/domain/navidromeConnection';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanups.push(() => new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
  return { base: `http://music.example.test:${address.port}/navidrome`, address: '127.0.0.1', family: 4 as const };
}
function envelope(status = 'ok', extra: Record<string, unknown> = {}) { return JSON.stringify({ 'subsonic-response': { status, ...extra } }); }

it('uses anonymous GET, preserves host/port/subpath, and keeps authenticated POST parameters out of the URL', async () => {
  const seen: { path: string; method?: string; body: string; host?: string }[] = [];
  const target = await fixture(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ path: req.url!, method: req.method, body, host: req.headers.host });
    expect(req.headers.accept).toBe('application/json'); expect(req.headers['accept-encoding']).toBe('identity');
    res.end(envelope('ok', { user: { username: 'alice' } }));
  });
  await expect(requestNavidromeProtocol(target, 'ping')).resolves.toMatchObject({ status: 'ok' });
  await expect(requestNavidromeProtocol(target, 'getUser', { u: 'alice', t: 'synthetic-token', s: 'synthetic-salt' })).resolves.toMatchObject({ user: { username: 'alice' } });
  expect(seen[0]).toMatchObject({ method: 'GET', body: '', host: new URL(target.base).host });
  expect(seen[0].path).toBe('/navidrome/rest/ping.view?v=1.16.1&c=Tooku&f=json');
  expect(seen[1]).toMatchObject({ method: 'POST', path: '/navidrome/rest/getUser.view' });
  expect(new URLSearchParams(seen[1].body).get('t')).toBe('synthetic-token');
});
it.each([401, 403])('recognizes a protocol authentication challenge with HTTP %s', async (status) => {
  const target = await fixture((_req, res) => { res.writeHead(status); res.end(envelope('failed', { error: { code: 40 } })); });
  await expect(requestNavidromeProtocol(target, 'ping')).resolves.toMatchObject({ status: 'failed' });
});
it.each([
  [302, '', 'redirect'], [404, '<html>private upstream detail</html>', 'http'],
  [403, '<html>Forbidden</html>', 'http'], [502, envelope(), 'http'],
  [200, '<html>Navidrome UI</html>', 'protocol'], [200, '{}', 'protocol'],
  [200, 'x'.repeat(1024 * 1024 + 1), 'size'],
] as const)('classifies HTTP %s validation failures without leaking upstream content', async (status, body, reason) => {
  const target = await fixture((_req, res) => { res.writeHead(status, { Location: 'https://untrusted.example.test' }); res.end(body); });
  await expect(requestNavidromeProtocol(target, 'ping')).rejects.toMatchObject({ connectionError: reason });
});
it('settles an aborted partial response instead of hanging', async () => {
  const target = await fixture((_req, res) => { res.writeHead(200, { 'Content-Length': 500 }); res.write('{'); setImmediate(() => res.destroy()); });
  await expect(requestNavidromeProtocol(target, 'ping')).rejects.toMatchObject({ connectionError: 'interrupted' });
});
it('bounds a stalled response even if the socket remains open', async () => {
  const target = await fixture(() => {});
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const pending = expect(requestNavidromeProtocol(target, 'ping')).rejects.toMatchObject({ connectionError: 'timeout' });
  await vi.advanceTimersByTimeAsync(8001); await pending;
});
it('classifies connection errors and displays only whitelisted diagnostic messages', () => {
  for (const code of ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) expect(connectionFailure({ code, message: 'secret' }).connectionError).toBe('tls');
  expect(connectionFailure(new AggregateError([{ code: 'ECONNREFUSED' }])).connectionError).toBe('refused');
  expect(navidromeConnectionMessage({ connectionError: 'http', upstreamStatus: 403, error: 'secret' })).toContain('HTTP 403');
  expect(navidromeConnectionMessage({ connectionError: '__proto__', error: 'secret' })).toBeUndefined();
  expect(navidromeConnectionMessage({ connectionError: 'unknown', error: 'secret' })).toBeUndefined();
});
it('keeps all DNS answers pinned and refuses a mixed public/private answer', async () => {
  const resolve = vi.fn().mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }, { address: '1.1.1.1', family: 4 }]);
  const target = await resolveNavidromeTarget('https://music.example.test:22443/music', false, resolve);
  expect(target.addresses).toHaveLength(2); expect(resolve).toHaveBeenCalledTimes(1);
  resolve.mockResolvedValue([{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  await expect(resolveNavidromeTarget(target.base, false, resolve)).rejects.toThrow('允许范围');
  resolve.mockRejectedValue(new Error('secret hostname'));
  await expect(resolveNavidromeTarget(target.base, false, resolve)).rejects.toMatchObject({ connectionError: 'dns' });
});
it('bounds a stalled DNS lookup', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const pending = expect(resolveNavidromeTarget('https://music.example.test', false, vi.fn(() => new Promise<never>(() => {})))).rejects.toMatchObject({ connectionError: 'dns' });
  await vi.advanceTimersByTimeAsync(3001); await pending;
});
