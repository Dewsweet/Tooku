import { afterEach, expect, it, vi } from 'vitest';
import { testServerConnection } from '../src/api/client';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ 'subsonic-response': body }), { status, headers: { 'Content-Type': 'application/json' } });
}

it('measures an uncached anonymous protocol request without account fields', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ status: 'ok', version: '1.16.1' })); vi.stubGlobal('fetch', fetch);
  vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(142.4);
  expect(await testServerConnection('https://fixture.example.test/music')).toEqual({ latencyMs: 42 });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  const parsed = new URL(url);
  expect(parsed.pathname).toBe('/music/rest/ping.view');
  expect([...parsed.searchParams.keys()].sort()).toEqual(['c', 'f', 'v']);
  expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
});

it.each([200, 401, 403])('recognizes a protocol authentication response as reachable (HTTP %s)', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 'failed', error: { code: 40 } }, status)));
  expect((await testServerConnection(window.location.origin)).latencyMs).toBeGreaterThanOrEqual(1);
});

it('uses the same-origin proxy alias without sending credentials', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ status: 'failed', error: { code: 10 } })); vi.stubGlobal('fetch', fetch);
  await testServerConnection(window.location.origin);
  expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/nd/rest/ping.view');
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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse()));
  await expect(testServerConnection('https://fixture.example.test')).rejects.toThrow('未识别到音乐服务');
});

it('reports HTTP and network failures without echoing remote data', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('private upstream error', { status: 503 })); vi.stubGlobal('fetch', fetch);
  await expect(testServerConnection('https://fixture.example.test')).rejects.toThrow('HTTP 503');
  fetch.mockRejectedValue(new TypeError('private network detail'));
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
