import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { UserDataApi } from '../src/api/userData';
import { useSession } from '../src/state/session';
import { RecommendationsApi } from '../src/api/recommendations';
import { defaultRecommendationSettings, emptyRecommendationCredentials } from '../src/domain/recommendations';

afterEach(() => { useSession.getState().api?.dispose(); useSession.getState().setSession(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
it('restores a cookie session without exposing authentication parameters and includes account binding on form POST', async () => {
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    if (input === '/api/tooku/session') return json({ owner: 'synthetic-owner', username: '合成账号', admin: true });
    if (input.includes('getOpenSubsonicExtensions')) return json({ 'subsonic-response': { status: 'ok', openSubsonicExtensions: [{ name: 'formPost', versions: [1] }] } });
    expect(options?.credentials).toBe('same-origin');
    return json({ 'subsonic-response': { status: 'ok', serverVersion: 'fixture' } });
  });
  vi.stubGlobal('fetch', fetcher);
  const restored = await MusicApi.restoreSession(); expect(restored).not.toBeNull();
  const api = restored!.api; useSession.getState().setSession(api);
  expect(api.persistent).toBe(true); expect(api.canEditArtistImages).toBe(true);
  const stream = new URL(api.streamUrl('song', 'original'));
  expect(stream.searchParams.get('tookuUser')).toBe('合成账号');
  for (const field of ['u', 't', 's', 'p']) expect(stream.searchParams.has(field)).toBe(false);
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
it('does not send persistent cookies or request saved keys while using a direct Navidrome connection', async () => {
  const api = new MusicApi('https://direct.example.test', 'synthetic-user', 'synthetic-password'); useSession.getState().setSession(api);
  const fetcher = vi.fn<typeof fetch>(async () => json({ ok: true })); vi.stubGlobal('fetch', fetcher);
  await new RecommendationsApi().check('lastfm', defaultRecommendationSettings, { ...emptyRecommendationCredentials, lastfmKey: 'synthetic-draft' });
  const init = fetcher.mock.calls[0]?.[1]; expect(init).toMatchObject({ credentials: 'omit' });
  expect(JSON.parse(String(init?.body))).not.toHaveProperty('useSavedCredentials');
});
