import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicApi } from '../src/api/client';
import { TookuLyricsApi } from '../src/api/lyrics';
import { useSession } from '../src/state/session';
import { useLyricsProfiles, updateLyricChoice } from '../src/state/lyrics';
import { LyricsApiContext, useLyrics } from '../src/features/lyrics/useLyrics';
import { lyricHash } from '../src/domain/lyrics/normalize';
import type { FetchResult } from '../src/domain/lyrics/types';
import type { Track } from '../src/domain/models';

let api: MusicApi; let network: TookuLyricsApi; let client: QueryClient;
const track: Track = { id: 'a', title: 'Song', artist: 'Artist', duration: 180 };
const fetched: FetchResult = { version: 1, cached: false, stale: false, document: { version: 1, source: 'netease', recordId: '123', tracks: [{ role: 'original', text: '[00:01]hello' }, { role: 'translation', text: '[00:01]你好' }] } };
beforeEach(() => {
  api = new MusicApi('http://example.test', 'sample', crypto.randomUUID()); useSession.getState().setSession(api);
  useLyricsProfiles.setState({ profiles: {}, refreshes: {} }); network = new TookuLyricsApi();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, 'lyrics').mockResolvedValue({ synced: false, offsetMs: 0, lines: [] });
  vi.spyOn(network, 'search').mockResolvedValue({ version: 1, candidates: [{ provider: 'netease', id: '123', title: 'Song', artists: ['Artist'], durationMs: 180000, confident: true }], errors: [] });
  vi.spyOn(network, 'lyrics').mockResolvedValue(fetched);
});
afterEach(() => { cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null); vi.restoreAllMocks(); });
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={client}><LyricsApiContext value={network}>{children}</LyricsApiContext></QueryClientProvider>; }

it('uses readable local foreign lyrics without requiring a translation or contacting providers', async () => {
  vi.mocked(api.lyrics).mockResolvedValue({ synced: true, offsetMs: 0, lines: [{ text: 'hello', startMs: 1000 }] });
  const { result } = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(result.current.lyrics?.lines[0].text).toBe('hello'));
  expect(network.search).not.toHaveBeenCalled(); expect(network.lyrics).not.toHaveBeenCalled();
});
it('keeps a local read error visible without interpreting it as absence', async () => {
  vi.mocked(api.lyrics).mockRejectedValue(new Error('读取失败'));
  const { result } = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(result.current.error?.message).toBe('读取失败')); expect(network.search).not.toHaveBeenCalled();
});
it('automatically falls back only after local absence and shares work between lyric views', async () => {
  const first = renderHook(() => useLyrics(track), { wrapper }); const second = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(first.result.current.source).toBe('netease'));
  expect(second.result.current.lyrics?.lines[0].translation).toEqual(['你好']);
  expect(api.lyrics).toHaveBeenCalledTimes(1); expect(network.search).toHaveBeenCalledTimes(1); expect(network.lyrics).toHaveBeenCalledTimes(1);
});
it('does not use network for known instrumental tracks or when disabled', async () => {
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [], instrumental: true });
  const view = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(view.result.current.lyrics?.instrumental).toBe(true)); expect(network.search).not.toHaveBeenCalled();
  act(() => useLyricsProfiles.getState().update(api.identity, (s) => ({ ...s, enabled: false })));
  expect(network.search).not.toHaveBeenCalled();
});
it('automatically takes a nearby edition and lets the listener override its binding', async () => {
  useLyricsProfiles.getState().update(api.identity, (s) => ({ ...s, order: ['netease'] }));
  vi.mocked(network.search).mockResolvedValue({ version: 1, candidates: [{ provider: 'netease', id: '123', title: 'Song', artists: ['Artist'], confident: false }], errors: [] });
  const { result } = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(result.current.source).toBe('netease')); expect(network.lyrics).toHaveBeenCalledTimes(1);
  vi.mocked(network.lyrics).mockResolvedValue({ ...fetched, document: { ...fetched.document, recordId: '456' } });
  act(() => updateLyricChoice(api.identity, track.id, { mode: 'netease', bindings: { netease: '456' } }));
  await waitFor(() => expect(result.current.document?.recordId).toBe('456'));
  expect(network.lyrics).toHaveBeenCalledTimes(2); expect(useLyricsProfiles.getState().profiles['other-account']).toBeUndefined();
});
it('tries the next provider when the first returns no lyric data', async () => {
  vi.mocked(network.search).mockResolvedValueOnce({ version: 1, candidates: [], errors: [] }).mockResolvedValueOnce({ version: 1, candidates: [{ provider: 'qq', id: 'qq123', title: 'Song', artists: ['Artist'], durationMs: 185000 }], errors: [] });
  vi.mocked(network.lyrics).mockResolvedValue({ ...fetched, document: { ...fetched.document, source: 'qq', recordId: 'qq123' } });
  const view = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(view.result.current.source).toBe('qq')); expect(network.search).toHaveBeenCalledTimes(2);
});
it('uses the next nearby candidate when the first candidate has an empty body', async () => {
  vi.mocked(network.search).mockResolvedValue({ version: 1, candidates: ['123', '456'].map((id) => ({ provider: 'netease', id, title: 'Song', artists: ['Artist'], durationMs: 180000 })), errors: [] });
  vi.mocked(network.lyrics).mockResolvedValueOnce({ ...fetched, document: { ...fetched.document, tracks: [] } }).mockResolvedValueOnce({ ...fetched, document: { ...fetched.document, recordId: '456' } });
  const view = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(view.result.current.document?.recordId).toBe('456')); expect(network.lyrics).toHaveBeenCalledTimes(2);
});
it.each(['Guest／Artist／Composer', 'Artist (アーティスト)', 'Guest / Artist / Composer'])('automatically reads the first matching result for a combined or aliased artist tag (%s)', async (artist) => {
  const view = renderHook(() => useLyrics({ ...track, artist }), { wrapper });
  await waitFor(() => expect(view.result.current.lyrics?.lines[0].text).toBe('hello'));
  expect(view.result.current.document?.recordId).toBe('123');
  expect(network.search).toHaveBeenCalledTimes(1); expect(network.lyrics).toHaveBeenCalledTimes(1);
  expect(view.result.current.choice?.bindings).toBeUndefined();
});
it('skips a different performer in the first result and reads the matching artist later in the list', async () => {
  vi.mocked(network.search).mockResolvedValue({ version: 1, candidates: [
    { provider: 'netease', id: '999', title: 'Song', artists: ['Other'], durationMs: 180000 },
    { provider: 'netease', id: '123', title: 'Song', artists: ['Artist'], durationMs: 180000 },
  ], errors: [] });
  const view = renderHook(() => useLyrics({ ...track, artist: 'Artist／Composer' }), { wrapper });
  await waitFor(() => expect(view.result.current.document?.recordId).toBe('123'));
  expect(network.lyrics).toHaveBeenCalledExactlyOnceWith('netease', '123', expect.any(AbortSignal), false);
});
it('automatically reads a bilingual song title when the platform supplies the localized artist name', async () => {
  vi.mocked(network.search).mockResolvedValue({ version: 1, candidates: [
    { provider: 'netease', id: '123', title: '風になる', artists: ['つじあやの'], artistAliases: ['辻亚弥乃'], durationMs: 276600 },
  ], errors: [] });
  const view = renderHook(() => useLyrics({ ...track, title: '風になる (幻化成风)', artist: '辻亚弥乃', duration: 276 }), { wrapper });
  await waitFor(() => expect(view.result.current.document?.recordId).toBe('123'));
  expect(view.result.current.lyrics?.lines[0].translation).toEqual(['你好']);
  expect(network.search).toHaveBeenCalledTimes(1);
});
it('finishes with a quiet empty result when both providers return no data or fail', async () => {
  vi.mocked(network.search).mockResolvedValueOnce({ version: 1, candidates: [], errors: [] }).mockRejectedValueOnce(new Error('provider unavailable'));
  const view = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(network.search).toHaveBeenCalledTimes(2); expect(view.result.current.error).toBeNull(); expect(view.result.current.document).toBeUndefined();
});
it('treats local mode as local-first with fallback and reads legacy automatic modes compatibly', async () => {
  updateLyricChoice(api.identity, track.id, { mode: 'local' });
  const view = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(view.result.current.source).toBe('netease')); expect(view.result.current.mode).toBe('local');
});
it('switches explicitly to network and back to local while applying edits only to an unchanged source', async () => {
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [{ text: 'local' }] });
  const { result } = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(result.current.source).toBe('local'));
  act(() => updateLyricChoice(api.identity, track.id, { mode: 'network', edits: { netease: { layout: 'auto', hash: lyricHash(fetched.document), delayMs: 400 } } }));
  await waitFor(() => expect(result.current.edit?.delayMs).toBe(400));
  act(() => updateLyricChoice(api.identity, track.id, { mode: 'local' }));
  await waitFor(() => expect(result.current.lyrics?.lines[0].text).toBe('local')); expect(result.current.edit).toBeUndefined();
});
it('refreshes both lyric views using a new shared request that bypasses provider cache', async () => {
  const first = renderHook(() => useLyrics(track), { wrapper }); renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(first.result.current.source).toBe('netease'));
  await act(async () => { await first.result.current.retry(); });
  await waitFor(() => expect(network.lyrics).toHaveBeenCalledTimes(2)); expect(network.search).toHaveBeenLastCalledWith(expect.anything(), ['netease'], expect.any(AbortSignal), true);
  expect(network.lyrics).toHaveBeenLastCalledWith('netease', '123', expect.any(AbortSignal), true);
});
it('ignores late network results from a previously selected track', async () => {
  let resolve!: (value: FetchResult) => void;
  vi.mocked(network.lyrics).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = renderHook(({ current }) => useLyrics(current), { wrapper, initialProps: { current: track } });
  await waitFor(() => expect(network.lyrics).toHaveBeenCalledTimes(1));
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [{ text: 'new song local' }] });
  view.rerender({ current: { ...track, id: 'b' } });
  await waitFor(() => expect(view.result.current.lyrics?.lines[0].text).toBe('new song local'));
  await act(async () => resolve(fetched)); expect(view.result.current.lyrics?.lines[0].text).toBe('new song local');
});
it('cancels active frontend network work when the account disables network lyrics', async () => {
  vi.mocked(network.lyrics).mockImplementationOnce((_provider, _id, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const view = renderHook(() => useLyrics(track), { wrapper });
  await waitFor(() => expect(network.lyrics).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(network.lyrics).mock.calls[0][2];
  act(() => useLyricsProfiles.getState().update(api.identity, (s) => ({ ...s, enabled: false })));
  await waitFor(() => expect(signal?.aborted).toBe(true)); expect(view.result.current.source).toBe('local');
  expect(network.search).toHaveBeenCalledTimes(1);
});
