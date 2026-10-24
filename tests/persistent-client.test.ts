import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { UserDataApi } from '../src/api/userData';
import { useSession } from '../src/state/session';
import { RecommendationsApi } from '../src/api/recommendations';
import { defaultRecommendationSettings, emptyRecommendationCredentials } from '../src/domain/recommendations';

afterEach(() => { useSession.getState().api?.dispose(); useSession.getState().setSession(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const playback = () => json({ url: `/api/tooku-stream/${'a'.repeat(43)}`, expiresAt: Date.now() + 3600000 });
it('restores a cookie session without exposing authentication parameters and includes account binding on form POST', async () => {
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    if (input === '/api/tooku/session') return json({ owner: 'synthetic-owner', username: '合成账号', admin: true, clientBase: 'http://127.0.0.1:44533' });
    if (input === '/api/tooku/playback') return playback();
    if (input.includes('getOpenSubsonicExtensions')) return json({ 'subsonic-response': { status: 'ok', openSubsonicExtensions: [{ name: 'formPost', versions: [1] }] } });
    expect(options?.credentials).toBe('same-origin');
    return json({ 'subsonic-response': { status: 'ok', serverVersion: 'fixture' } });
  });
  vi.stubGlobal('fetch', fetcher);
  const restored = await MusicApi.restoreSession(); expect(restored).not.toBeNull();
  const api = restored!.api; useSession.getState().setSession(api);
  expect(api.base).toBe('http://127.0.0.1:44533');
  expect(api.persistent).toBe(true); expect(api.canEditArtistImages).toBe(true);
  expect(() => api.streamUrl('song', 'original')).toThrow('临时播放授权');
  const stream = new URL((await api.playbackUrl('song', 'original')).url);
  expect(stream.pathname).toMatch(/^\/api\/tooku-stream\/[a-zA-Z0-9_-]{43}$/);
  for (const field of ['u', 't', 's', 'p', 'id', 'format']) expect(stream.searchParams.has(field)).toBe(false);
  const grant = fetcher.mock.calls.find(([input]) => input === '/api/tooku/playback');
  expect(grant?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  expect(JSON.parse(String(grant?.[1]?.body))).toEqual({ id: 'song', mode: 'original' });
  await api.request('getSong', { id: 'song' });
  const [url, options] = fetcher.mock.calls.at(-1)!;
  expect(new URL(url).searchParams.get('tookuUser')).toBe('合成账号'); expect(options?.method).toBe('POST');
  const form = options?.body; expect(form).toBeInstanceOf(URLSearchParams);
  expect((form as URLSearchParams).has('t')).toBe(false);
  api.dispose(); expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
});
it('binds account data operations to the verified owner and keeps logout separate from disposal', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ owner: 'synthetic-owner', username: 'user', admin: false })); vi.stubGlobal('fetch', fetcher);
  const client = new UserDataApi(); await client.restore();
  fetcher.mockResolvedValueOnce(json({ revision: 0, saved: { lastfmKey: false, aiKey: true, appleToken: false, spotifyClientId: false, spotifyClientSecret: false } }));
  expect((await client.credentials()).saved.aiKey).toBe(true);
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ credentials: 'same-origin', headers: { 'X-Tooku-Owner': 'synthetic-owner' } });
  await client.logout(); expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'DELETE' });
  client.dispose(); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('validates managed server records and preserves their sanitized management errors', async () => {
  const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
  const client = new UserDataApi();
  fetcher.mockResolvedValueOnce(json({ id: 'a'.repeat(22), address: 'https://old.example.test', primary: 'https://new.example.test', aliases: ['https://old.example.test', 'https://new.example.test'] }));
  await expect(client.server()).resolves.toMatchObject({ primary: 'https://new.example.test' });
  fetcher.mockResolvedValueOnce(json({ id: 'a'.repeat(22), address: 'https://old.example.test', primary: 'https://missing.example.test', aliases: ['https://old.example.test'] }));
  await expect(client.server()).rejects.toThrow('音乐服务器记录无效');
  fetcher.mockResolvedValueOnce(json({ error: '新地址的账号与当前服务器记录不一致。' }, 409));
  await expect(client.addServerAlias('b'.repeat(43))).rejects.toThrow('新地址的账号与当前服务器记录不一致。');
  fetcher.mockResolvedValueOnce(json({ error: 'internal detail must stay hidden' }, 409));
  await expect(client.request('data', 'PUT', {})).rejects.toThrow('另一设备已修改数据');
});
it('promotes the configured direct Navidrome address to managed persistence without changing its local identity', async () => {
  const direct = 'http://127.0.0.1:44533';
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === '/api/tooku/connection') return json({ managed: true });
    if (url === '/api/tooku/session') return json({ owner: 'synthetic-owner', username: 'user', admin: false, persistent: true, clientBase: direct });
    if (url === '/api/tooku/playback') return playback();
    return json({ 'subsonic-response': { status: 'ok', serverVersion: 'fixture' } });
  });
  vi.stubGlobal('fetch', fetcher);
  const api = new MusicApi(direct, 'user', 'synthetic-password', '0123456789abcdef');
  await api.prepare(); await api.connect(); await api.userData();
  expect(api.identity).toBe(`${direct}|user`); expect(api.base).toBe(direct); expect(api.persistent).toBe(true);
  expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith(`${window.location.origin}/api/navidrome/rest/`))).toHaveLength(2);
  const session = fetcher.mock.calls.find(([input]) => input === '/api/tooku/session');
  expect(JSON.parse(String(session?.[1]?.body))).toMatchObject({ clientBase: direct, persistent: true });
  expect(new URL((await api.playbackUrl('song', 'compatible')).url).pathname).toMatch(/^\/api\/tooku-stream\//);
});
it('does not send persistent cookies or request saved keys while using a direct Navidrome connection', async () => {
  const api = new MusicApi('https://direct.example.test', 'synthetic-user', 'synthetic-password'); useSession.getState().setSession(api);
  const fetcher = vi.fn<typeof fetch>(async () => json({ ok: true })); vi.stubGlobal('fetch', fetcher);
  await new RecommendationsApi().check('lastfm', defaultRecommendationSettings, { ...emptyRecommendationCredentials, lastfmKey: 'synthetic-draft' });
  const init = fetcher.mock.calls[0]?.[1]; expect(init).toMatchObject({ credentials: 'omit' });
  expect(JSON.parse(String(init?.body))).not.toHaveProperty('useSavedCredentials');
});
