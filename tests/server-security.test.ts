// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type RequestListener, type Server } from 'node:http';
import { applySecurityHeaders, contentSecurityPolicy, sameOriginRequest } from '../server/security';

const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => {
    server.close(() => done()); server.closeAllConnections();
  })));
});

async function listen(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  return `http://127.0.0.1:${address.port}`;
}

describe('server transport security', () => {
  it('sets a restrictive browser policy while retaining direct Navidrome media and API access', async () => {
    const origin = await listen((req, res) => { applySecurityHeaders(req, res); res.end('ok'); });
    const response = await fetch(origin);
    expect(response.headers.get('content-security-policy')).toBe(contentSecurityPolicy);
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("media-src 'self' blob: http: https:");
    expect(contentSecurityPolicy).toContain("connect-src 'self' http: https:");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('permissions-policy')).toContain('microphone=()');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('strict-transport-security')).toBeNull();
  });

  it('emits HSTS only for an explicitly enabled HTTPS request from a trusted proxy', async () => {
    vi.stubEnv('TOOKU_HSTS', 'true');
    const origin = await listen((req, res) => { applySecurityHeaders(req, res); res.end('ok'); });
    expect((await fetch(origin, { headers: { 'X-Forwarded-Proto': 'https' } })).headers.get('strict-transport-security')).toBeNull();
    vi.stubEnv('TOOKU_TRUST_PROXY', 'true');
    expect((await fetch(origin, { headers: { 'X-Forwarded-Proto': 'https' } })).headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect((await fetch(origin, { headers: { 'X-Forwarded-Proto': 'https, http' } })).headers.get('strict-transport-security')).toBeNull();
  });

  it('accepts only a valid HTTP(S) Origin matching the received Host and ignores forwarded host claims', async () => {
    const origin = await listen((req, res) => { res.statusCode = sameOriginRequest(req) ? 204 : 403; res.end(); });
    expect((await fetch(origin)).status).toBe(204);
    expect((await fetch(origin, { headers: { Origin: origin } })).status).toBe(204);
    expect((await fetch(origin, { headers: { Origin: 'https://foreign.test', 'X-Forwarded-Host': 'foreign.test' } })).status).toBe(403);
    expect((await fetch(origin, { headers: { Origin: '%', 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(403);
    expect((await fetch(origin, { headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  });
});
