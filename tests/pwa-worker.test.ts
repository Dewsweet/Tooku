// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

interface TestFetchEvent {
  request: { method: string; url: string; mode: string };
  respondWith: (response: Promise<Response>) => void;
}

function worker() {
  let onFetch: ((event: TestFetchEvent) => void) | undefined;
  const put = vi.fn().mockResolvedValue(undefined);
  const match = vi.fn().mockResolvedValue(new Response('offline shell', { headers: { 'Content-Type': 'text/html' } }));
  const open = vi.fn().mockResolvedValue({ put, match });
  const fetch = vi.fn().mockResolvedValue(new Response('online shell', { headers: { 'Content-Type': 'text/html' } }));
  const template = readFileSync(new URL('../src/pwa/service-worker.js', import.meta.url), 'utf8');
  runInNewContext(template.replaceAll('__TOOKU_CACHE_VERSION__', 'test').replaceAll('__TOOKU_PRECACHE__', '[]'), {
    URL, Request, Response, fetch, caches: { open },
    self: { location: { origin: 'https://tooku.example' }, addEventListener: (name: string, callback: (event: TestFetchEvent) => void) => { if (name === 'fetch') onFetch = callback; } },
  });
  return {
    put, open, match, fetch,
    async request(path: string, mode = 'navigate', method = 'GET') {
      let response: Promise<Response> | undefined;
      onFetch?.({ request: { method, mode, url: new URL(path, 'https://tooku.example').href }, respondWith: (value) => { response = value; } });
      return response;
    },
  };
}

it.each(['/api', '/api/tooku/backup', '/api/tooku/session', '/api/lyrics/fetch', '/api/tooku-stream/synthetic', '/nd', '/nd/rest/getCoverArt.view'])('leaves API navigation %s outside the worker and its caches', async (path) => {
  const app = worker(); expect(await app.request(path)).toBeUndefined();
  expect(app.fetch).not.toHaveBeenCalled(); expect(app.open).not.toHaveBeenCalled();
});

it.each(['/assets/font.woff2', '/assets/cover.jpg', '/assets/audio.mp3', 'https://other.example/assets/app.js'])('does not intercept non-shell resource %s', async (path) => {
  const app = worker(); expect(await app.request(path, 'cors')).toBeUndefined();
  expect(app.open).not.toHaveBeenCalled();
});

it('caches HTML navigations and restores only that shell when offline', async () => {
  const app = worker(); expect(await (await app.request('/albums'))?.text()).toBe('online shell');
  expect(app.put).toHaveBeenCalledWith('/', expect.any(Response));
  app.fetch.mockRejectedValueOnce(new TypeError('offline'));
  expect(await (await app.request('/artists'))?.text()).toBe('offline shell');
});

it('does not replace the shell with non-HTML responses or HTTP errors', async () => {
  const app = worker(); app.fetch.mockResolvedValueOnce(new Response('{"synthetic":true}', { headers: { 'Content-Type': 'application/json' } }));
  expect(await (await app.request('/unknown'))?.text()).toContain('synthetic'); expect(app.put).not.toHaveBeenCalled();
  app.fetch.mockResolvedValueOnce(new Response('failed', { status: 500, headers: { 'Content-Type': 'text/html' } }));
  await app.request('/albums'); expect(app.put).not.toHaveBeenCalled();
});

it.each(['/assets/app-hash.js', '/assets/app-hash.css', '/tooku.svg', '/navidrome.svg'])('serves allowed static resource %s from its shell cache', async (path) => {
  const app = worker(); expect(await (await app.request(path, 'cors'))?.text()).toBe('offline shell'); expect(app.match).toHaveBeenCalled();
});
