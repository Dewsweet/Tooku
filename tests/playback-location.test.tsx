import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { TrackList } from '../src/components/Common';
import { PlaybackSourceLink } from '../src/components/TrackLinks';
import { locateTrackIndex, playbackDestination } from '../src/domain/playbackLocation';
import type { PlaybackSource, QueueEntry } from '../src/domain/models';
import { player, usePlayer } from '../src/features/player/engine';
import { useSession } from '../src/state/session';

const tracks = [{ id: 'a', title: '重复歌曲', artist: '歌手', albumId: 'fallback' }, { id: 'b', title: '第二首', artist: '歌手' }, { id: 'a', title: '重复歌曲', artist: '歌手', albumId: 'fallback' }];
let api: MusicApi; let client: QueryClient;
beforeEach(() => {
  api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'favorites').mockResolvedValue({ songs: [], albums: [], artists: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSession.getState().setSession(api);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null); usePlayer.setState(usePlayer.getInitialState()); Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo'); vi.restoreAllMocks(); });
function RouteView({ source }: { source: PlaybackSource }) {
  return <main className="content"><output>{useLocation().pathname}</output><TrackList tracks={tracks} source={source} /></main>;
}
it.each(['playlist', 'album'] as const)('navigates to the %s source and focuses the correct duplicate without changing audio', async (kind) => {
  const source = { kind, id: 'source' };
  const entry: QueueEntry = { entryId: 'current', track: tracks[2], source, sourceIndex: 2 };
  usePlayer.setState({ entries: [entry], currentId: entry.entryId, position: 52, status: 'playing' });
  const replace = vi.spyOn(player, 'replace'); const attach = vi.spyOn(player, 'attach');
  render(<QueryClientProvider client={client}><MemoryRouter><PlaybackSourceLink entry={entry} /><Routes><Route path="/" element={<p>开始</p>} /><Route path="*" element={<RouteView source={source} />} /></Routes></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('link', { name: '重复歌曲' }));
  await waitFor(() => expect(document.activeElement).toHaveAttribute('data-track-index', '2'));
  expect(screen.getByText(`/${kind === 'album' ? 'albums' : 'playlists'}/source`)).toBeInTheDocument();
  expect(HTMLElement.prototype.scrollTo).toHaveBeenCalled();
  expect(usePlayer.getState()).toMatchObject({ currentId: 'current', position: 52, status: 'playing' });
  expect(replace).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled();
  screen.getByRole('button', { name: '收藏 第二首' }).focus();
  fireEvent.click(screen.getByRole('link', { name: '重复歌曲' }));
  await waitFor(() => expect(document.activeElement).toHaveAttribute('data-track-index', '2'));
});
it('falls back to the album for unknown, artist and collection sources without reusing their index', () => {
  for (const source of [undefined, { kind: 'artist' as const, id: 'artist' }, { kind: 'collection' as const, id: 'favorites' }]) {
    expect(playbackDestination({ entryId: 'a', track: tracks[0], source, sourceIndex: 9 })).toEqual({ pathname: '/albums/fallback', source: { kind: 'album', id: 'fallback' }, trackId: 'a' });
  }
  expect(playbackDestination({ entryId: 'a', track: tracks[1] })).toBeUndefined();
});
it('handles old queues, changed source order and removed tracks', () => {
  expect(locateTrackIndex(tracks, 'a')).toBe(0);
  expect(locateTrackIndex(tracks, 'a', 2)).toBe(2);
  expect(locateTrackIndex([tracks[1], tracks[0]], 'a', 2)).toBe(1);
  expect(locateTrackIndex(tracks, 'removed', 2)).toBe(-1);
});
it('does not consume another account’s pending location', async () => {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: '/playlists/source', state: { tookuTrack: { identity: 'other-account', source: { kind: 'playlist', id: 'source' }, trackId: 'a', sourceIndex: 2 } } }]}><RouteView source={{ kind: 'playlist', id: 'source' }} /></MemoryRouter></QueryClientProvider>);
  await screen.findByRole('button', { name: '收藏 第二首' });
  expect(HTMLElement.prototype.scrollTo).not.toHaveBeenCalled();
});
