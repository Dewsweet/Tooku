import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { isNavidromeProxyRequest } from '../server/navidromeProxy';

const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const ok = (data = {}) => json({ 'subsonic-response': { status: 'ok', ...data } });
afterEach(() => vi.unstubAllGlobals());

async function login(admin = true) {
  const fetch = vi.fn().mockResolvedValueOnce(ok({ type: 'navidrome', serverVersion: '0.64.1' }))
    .mockResolvedValueOnce(ok()).mockResolvedValueOnce(json({ token: 'fixture-token', isAdmin: admin }));
  vi.stubGlobal('fetch', fetch);
  const api = new MusicApi('https://example.test/nd', 'fixture', 'fixture-password');
  await api.connect('fixture-password');
  return { api, fetch };
}

it('authenticates artwork in memory and clears access when the session closes', async () => {
  const { api, fetch } = await login();
  expect(api.canEditArtistImages).toBe(true);
  const [url, init] = fetch.mock.calls[2];
  expect(url).toBe('https://example.test/nd/auth/login');
  expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error');
  expect(JSON.parse(init.body)).toEqual({ username: 'fixture', password: 'fixture-password' });
  expect(JSON.stringify(api)).not.toContain('fixture-password'); expect(JSON.stringify(api)).not.toContain('fixture-token');
  api.dispose(); expect(api.canEditArtistImages).toBe(false);
});

it('keeps listening available when the native API is unavailable and refuses image writes', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(ok({ type: 'navidrome', serverVersion: '0.64.1' }))
    .mockResolvedValueOnce(ok()).mockRejectedValueOnce(new Error('proxy unavailable'));
  vi.stubGlobal('fetch', fetch);
  const api = new MusicApi('https://example.test', 'fixture', 'fixture');
  expect(await api.connect('fixture')).toBe('0.64.1');
  await expect(api.saveArtistImage('a', 'data:image/jpeg;base64,AA==')).rejects.toThrow('管理员');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('does not offer a native write to non-admin users', async () => {
  const { api, fetch } = await login(false);
  expect(api.canEditArtistImages).toBe(false);
  await expect(api.saveArtistImage('a')).rejects.toThrow('管理员');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('honors server permission denial and expires the artwork session on HTTP 401', async () => {
  const { api, fetch } = await login();
  fetch.mockResolvedValueOnce(json({ id: 'a' })).mockResolvedValueOnce(json({ error: 'private echo' }, 403));
  await expect(api.saveArtistImage('a', 'data:image/jpeg;base64,AA==')).rejects.toThrow('拒绝');
  expect(fetch).toHaveBeenCalledTimes(5);
  fetch.mockResolvedValueOnce(json({}, 401));
  await expect(api.artistImage('a')).rejects.toThrow('会话已失效');
  expect(api.canEditArtistImages).toBe(false);
});

it('uploads multipart artwork with the refreshed token and verifies the artist record', async () => {
  const { api, fetch } = await login();
  fetch.mockResolvedValueOnce(json({ id: 'a' }, 200, { 'x-nd-authorization': 'refreshed-fixture' }))
    .mockResolvedValueOnce(json({ status: 'ok' })).mockResolvedValueOnce(json({ id: 'a', uploadedImage: 'a.jpg', updatedAt: 'new' }));
  expect(await api.saveArtistImage('a', 'data:image/jpeg;base64,AA==')).toEqual({ uploadedImage: 'a.jpg', updatedAt: 'new' });
  const [url, init] = fetch.mock.calls[4];
  expect(url).toBe('https://example.test/nd/api/artist/a/image'); expect(init.method).toBe('POST');
  expect(init.headers['x-nd-authorization']).toBe('Bearer refreshed-fixture');
  expect(init.body).toBeInstanceOf(FormData); expect(init.body.get('image').type).toBe('image/jpeg');
  expect(fetch).toHaveBeenCalledTimes(6);
});

it('blocks another uncertain write until an explicit read verifies the current record', async () => {
  const { api, fetch } = await login();
  fetch.mockResolvedValueOnce(json({ id: 'a' })).mockRejectedValueOnce(new Error('timeout'));
  await expect(api.saveArtistImage('a', 'data:image/jpeg;base64,AA==')).rejects.toThrow('结果暂时未知');
  await expect(api.saveArtistImage('a', 'data:image/jpeg;base64,AA==')).rejects.toThrow('先重新读取');
  expect(fetch).toHaveBeenCalledTimes(5);
  fetch.mockResolvedValueOnce(json({ id: 'a', uploadedImage: 'saved-despite-timeout.jpg', updatedAt: 'new' }));
  expect((await api.artistImage('a')).uploadedImage).toBe('saved-despite-timeout.jpg');
  expect(fetch).toHaveBeenCalledTimes(6);
});

it('serializes artist image saves even while the first preflight read is pending', async () => {
  const { api, fetch } = await login();
  let read: ((value: Response) => void) | undefined;
  fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { read = resolve; }));
  const first = api.saveArtistImage('a');
  await expect(api.saveArtistImage('a', 'data:image/jpeg;base64,AA==')).rejects.toThrow('正在保存');
  expect(fetch).toHaveBeenCalledTimes(4);
  read?.(json({ id: 'a' }));
  expect((await first).uploadedImage).toBe('');
});

it('verifies removal with an omitted uploadedImage field and rejects mismatched upload readbacks', async () => {
  const { api, fetch } = await login();
  fetch.mockResolvedValueOnce(json({ id: 'a', uploadedImage: 'old.jpg' })).mockResolvedValueOnce(json({ status: 'ok' })).mockResolvedValueOnce(json({ id: 'a' }));
  expect((await api.saveArtistImage('a')).uploadedImage).toBe('');
  expect(fetch.mock.calls[4][1].method).toBe('DELETE');
  fetch.mockResolvedValueOnce(json({ id: 'a' })).mockResolvedValueOnce(json({ status: 'ok' })).mockResolvedValueOnce(json({ id: 'a' }));
  await expect(api.saveArtistImage('a', 'data:image/jpeg;base64,AA==')).rejects.toThrow('与预期不同');
});

it('does not upload malformed image data and does not interpret unrelated HTML as artist metadata', async () => {
  const { api, fetch } = await login();
  fetch.mockResolvedValueOnce(json({ id: 'a' }));
  await expect(api.saveArtistImage('a', 'https://example.test/photo.jpg')).rejects.toThrow('有效');
  fetch.mockResolvedValueOnce(new Response('<html>SPA fallback</html>'));
  await expect(api.artistImage('a')).rejects.toThrow('无效数据');
  expect(fetch).toHaveBeenCalledTimes(5);
});

it('limits the native proxy to authentication and artist artwork operations', () => {
  expect(isNavidromeProxyRequest('/nd/auth/login', 'POST')).toBe(true);
  expect(isNavidromeProxyRequest('/nd/api/artist/a', 'GET')).toBe(true);
  expect(isNavidromeProxyRequest('/nd/api/artist/a/image', 'DELETE')).toBe(true);
  for (const [url, method] of [['/nd/auth/createAdmin', 'POST'], ['/nd/api/user', 'POST'], ['/nd/api/artist/a', 'DELETE'], ['/nd/api/artist/%2e%2e/image', 'POST'], ['/nd/auth/login', 'GET']]) expect(isNavidromeProxyRequest(url, method)).toBe(false);
});
