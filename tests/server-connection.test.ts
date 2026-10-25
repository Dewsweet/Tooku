import { tookuServiceProtocol } from '../src/domain/serviceProtocol';
import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi, prepareServerAlias, testServerConnection } from '../src/api/client';
import { UserDataApi } from '../src/api/userData';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([
  [{ connectionError: 'origin' }, 'Host'],
  [{ error: '仅允许同源访问。' }, 'Host'],
  [{ connectionError: 'policy' }, '允许范围'],
  [{ error: '音乐服务器地址不在允许范围内。' }, '允许范围'],
  [{ connectionError: 'private' }, '私网'],
  [{ error: '此部署未开放私网音乐服务器。' }, '私网'],
] as const)('distinguishes reverse-proxy and address-policy denials, including old server responses: %j', async (body, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })));
  const api = new MusicApi('https://music.example.test', 'alice', 'synthetic-password');
  await expect(api.prepare()).rejects.toThrow(message);
  await expect(new UserDataApi().connect({ u: 'alice', t: 'synthetic', s: 'synthetic' })).rejects.toThrow(message);
  api.dispose();
});
it('does not label an unexplained reverse-proxy 403 as a music server address rejection', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>private gateway detail</html>', { status: 403 })));
  await expect(testServerConnection('https://music.example.test')).rejects.toThrow('反向代理拒绝了连接登记');
});
it('preserves safe connection diagnostics during registration and persistent-session creation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ connectionError: 'tls', error: 'synthetic secret upstream detail' }), { status: 502 })));
  await expect(testServerConnection('https://fixture.example.test:22443')).rejects.toThrow('HTTPS 证书验证失败');
  await expect(new UserDataApi().connect({ u: 'alice', t: 'synthetic', s: 'synthetic' })).rejects.toThrow('HTTPS 证书验证失败');
});
it('does not display arbitrary response errors as connection diagnostics', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ connectionError: 'unknown', error: 'synthetic secret upstream detail' }), { status: 502 })));
  await expect(testServerConnection('https://fixture.example.test')).rejects.toThrow('Tooku 无法连接或验证');
  await expect(new UserDataApi().connect({ u: 'alice', t: 'synthetic', s: 'synthetic' })).rejects.toThrow('本地数据仍保留');
});
function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ 'subsonic-response': body }), { status, headers: { 'Content-Type': 'application/json' } });
}
function connection(managed = false) { return new Response(JSON.stringify({ managed }), { headers: { 'Content-Type': 'application/json' } }); }
function directFetch(makeResponse: () => Response) {
  return vi.fn((...args: [string, RequestInit?]) => Promise.resolve(args[0] === '/api/tooku/connection' ? connection() : makeResponse()));
}

it('measures an uncached anonymous protocol request without account fields', async () => {
  const fetch = directFetch(() => response({ status: 'ok', version: '1.16.1' })); vi.stubGlobal('fetch', fetch);
  vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(142.4);
  expect(await testServerConnection('https://fixture.example.test/music')).toEqual({ latencyMs: 42 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][0]).toBe('/api/tooku/connection');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'omit' });
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ server: 'https://fixture.example.test/music' });
  const [url, options] = fetch.mock.calls[1];
  const parsed = new URL(url);
  expect(parsed.pathname).toBe('/music/rest/ping.view');
  expect([...parsed.searchParams.keys()].sort()).toEqual(['c', 'f', 'v']);
  expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
});

it.each([200, 401, 403])('recognizes a protocol authentication response as reachable (HTTP %s)', async (status) => {
  vi.stubGlobal('fetch', directFetch(() => response({ status: 'failed', error: { code: 40 } }, status)));
  expect((await testServerConnection(window.location.origin)).latencyMs).toBeGreaterThanOrEqual(1);
});

it('uses the same-origin proxy alias without sending credentials', async () => {
  const fetch = vi.fn((...args: [string, RequestInit?]) => Promise.resolve(args[0] === '/api/tooku/connection' ? connection(true) : response({ status: 'failed', error: { code: 10 } }))); vi.stubGlobal('fetch', fetch);
  await testServerConnection(window.location.origin);
  expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/api/navidrome/rest/ping.view');
});

it('uses an opaque registration ticket for a newly verified managed server', async () => {
  const connectionId = 'a'.repeat(43);
  const fetch = vi.fn((...args: [string, RequestInit?]) => Promise.resolve(args[0] === '/api/tooku/connection'
    ? new Response(JSON.stringify({ managed: true, connectionId }), { headers: { 'Content-Type': 'application/json' } })
    : response({ status: 'ok', type: 'navidrome' })));
  vi.stubGlobal('fetch', fetch);
  await testServerConnection('https://music.example.test');
  expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/api/navidrome/rest/ping.view');
  expect(fetch.mock.calls[1][1]?.headers).toEqual({ 'X-Tooku-Connection': connectionId });
});

it('prepares a server alias with only its normalized address and opaque ticket', async () => {
  const connectionId = 'c'.repeat(43);
  const fetch = vi.fn((input: string, options?: RequestInit) => {
    void input; void options; return Promise.resolve(new Response(JSON.stringify({ managed: true, connectionId })));
  });
  vi.stubGlobal('fetch', fetch);
  await expect(prepareServerAlias('https://music.example.test/library/')).resolves.toEqual({ base: 'https://music.example.test/library', connectionId });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/api/tooku/connection');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ server: 'https://music.example.test/library', purpose: 'alias' });
});

it('rejects an alias when the server does not issue a valid ticket', async () => {
  vi.stubGlobal('fetch', vi.fn((input: string, options?: RequestInit) => {
    void input; void options; return Promise.resolve(new Response(JSON.stringify({ managed: true })));
  }));
  await expect(prepareServerAlias('https://music.example.test')).rejects.toThrow('未通过 Navidrome 服务验证');
});

it('carries the verified target ticket through login into the persistent session', async () => {
  const connectionId = 'b'.repeat(43); const calls: [string, RequestInit?][] = [];
  const fetch = vi.fn(async (...args: [string, RequestInit?]) => {
    calls.push(args); const [url] = args;
    if (url === '/api/tooku/connection') return new Response(JSON.stringify({ managed: true, connectionId }));
    if (url === '/api/tooku/session') return new Response(JSON.stringify({ owner: 'owner-1', persistent: true, serviceProtocol: tookuServiceProtocol }));
    if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: 'native-token', isAdmin: true }));
    if (url.includes('getOpenSubsonicExtensions')) return response({ status: 'ok', openSubsonicExtensions: [] });
    return response({ status: 'ok', type: 'navidrome', serverVersion: 'fixture' });
  });
  vi.stubGlobal('fetch', fetch);
  const api = new MusicApi('https://music.example.test', 'Alice', 'synthetic-password', 'a'.repeat(32));
  await api.prepare(); await api.connect('synthetic-password'); await api.userData();
  expect(api.managed).toBe(true); expect(api.persistent).toBe(true);
  const session = calls.find(([url]) => url === '/api/tooku/session');
  expect(JSON.parse(String(session?.[1]?.body))).toMatchObject({ clientBase: 'https://music.example.test', connectionId, nativeToken: 'native-token', admin: true });
  for (const [, options] of calls.filter(([url]) => url.startsWith(`${window.location.origin}/api/navidrome`))) {
    expect(options?.headers).toMatchObject({ 'X-Tooku-Connection': connectionId });
  }
  api.dispose();
});

it.each([403, 404, 429, 502])('does not fall back to credential-bearing direct requests when registration fails with HTTP %s', async (status) => {
  const fetch = vi.fn().mockResolvedValue(new Response('private upstream detail', { status })); vi.stubGlobal('fetch', fetch);
  const api = new MusicApi('https://music.example.test:4533/navidrome', 'Alice', 'synthetic-password');
  await expect(api.prepare()).rejects.toMatchObject({ name: 'ApiError', httpStatus: status });
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('/api/tooku/connection');
  expect(String(fetch.mock.calls[0][1].body)).not.toContain('synthetic-password'); api.dispose();
});

it('does not hide a registration network error or a malformed successful response as direct mode', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('private network detail')).mockResolvedValueOnce(new Response('<html>old deployment</html>')).mockResolvedValueOnce(new Response(JSON.stringify({ managed: true, connectionId: 'invalid' })));
  vi.stubGlobal('fetch', fetch);
  const api = new MusicApi('https://music.example.test:4533', 'Alice', 'synthetic-password');
  await expect(api.prepare()).rejects.toThrow('持久化服务');
  await expect(api.prepare()).rejects.toThrow('登记响应无效');
  await expect(api.prepare()).rejects.toThrow('票据无效');
  expect(fetch).toHaveBeenCalledTimes(3); api.dispose();
});

it.each(['', 'not-a-url', 'ftp://fixture.example.test', 'https://user:synthetic@fixture.example.test', 'https://fixture.example.test?token=synthetic'])('rejects invalid input before sending a request: %s', async (input) => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(testServerConnection(input)).rejects.toThrow('服务地址');
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  () => new Response('<html>Not a music server</html>'),
  () => new Response(JSON.stringify({ status: 'ok' })),
  () => response({ status: 'failed', error: { code: 70 } }),
  () => response({ status: 'ok' }, 401),
])('rejects unrecognized or inconsistent service responses', async (makeResponse) => {
  vi.stubGlobal('fetch', directFetch(makeResponse));
  await expect(testServerConnection('https://fixture.example.test')).rejects.toThrow('未识别到音乐服务');
});

it('reports HTTP and network failures without echoing remote data', async () => {
  const fetch = directFetch(() => new Response('private upstream error', { status: 503 })); vi.stubGlobal('fetch', fetch);
  await expect(testServerConnection('https://fixture.example.test')).rejects.toThrow('HTTP 503');
  fetch.mockImplementation((input: string) => input === '/api/tooku/connection' ? Promise.resolve(connection()) : Promise.reject(new TypeError('private network detail')));
  await expect(testServerConnection('https://fixture.example.test')).rejects.toThrow('无法连接，请检查地址、网络或跨域访问设置。');
});

function abortableFetch() {
  vi.stubGlobal('fetch', vi.fn((_input: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = options?.signal; if (!signal) throw new Error('Missing signal');
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  })));
}
it('propagates cancellation so a stale request cannot update the UI', async () => {
  abortableFetch(); const controller = new AbortController();
  const assertion = expect(testServerConnection('https://fixture.example.test', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await assertion;
});

it('reports the bounded connection-test timeout separately from cancellation', async () => {
  abortableFetch(); const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const assertion = expect(testServerConnection('https://fixture.example.test')).rejects.toThrow('连接超时');
  controller.abort(); await assertion; expect(timeout).toHaveBeenCalledWith(20000);
});
