import { afterEach, expect, it, vi } from 'vitest';
import { testServerConnection } from '../src/api/client';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

it('reports an eight-second timeout separately from cancellation', async () => {
  abortableFetch(); const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const assertion = expect(testServerConnection('https://fixture.example.test')).rejects.toThrow('连接超时');
  controller.abort(); await assertion; expect(timeout).toHaveBeenCalledWith(8000);
});
