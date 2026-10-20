import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { ArtistDetail } from '../src/pages/ArtistDetail';
import { useLibrary } from '../src/state/library';
import { useSession } from '../src/state/session';
import { player } from '../src/features/player/engine';

vi.mock('../src/features/player/engine', () => ({ player: { replace: vi.fn(), shuffle: vi.fn() } }));
afterEach(() => { cleanup(); useSession.getState().setSession(null); useSession.getState().notify(''); useLibrary.setState({ profiles: {} }); vi.restoreAllMocks(); vi.clearAllMocks(); });

function setup(coverArt?: string) {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'library-1', name: '测试曲库' }]);
  vi.spyOn(api, 'artist').mockResolvedValue({ name: '测试歌手', coverArt, albums: [{ id: 'album-1', name: '第一张', artist: '测试歌手', coverArt: 'album-cover' }, { id: 'album-2', name: '第二张', artist: '测试歌手' }] });
  vi.spyOn(api, 'favorites').mockResolvedValue({ songs: [], artists: [], albums: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSession.getState().setSession(api);
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/artists/a']}><Link to="/artists/b">另一位歌手</Link><Routes><Route path="/artists/:id" element={<ArtistDetail />} /></Routes></MemoryRouter></QueryClientProvider>);
  return { api, client, ...view };
}

it('uses the artist banner first and falls back to a square album cover when it fails', async () => {
  const { api, client, container, unmount } = setup('artist-cover');
  await screen.findByRole('heading', { name: '测试歌手' });
  const image = container.querySelector('.artist-hero-image');
  expect(image).toBeInstanceOf(HTMLImageElement);
  if (!image) throw new Error('缺少歌手横幅');
  fireEvent.load(image);
  expect(container.querySelector('.artist-hero')).toHaveAttribute('data-has-art', 'true');
  fireEvent.error(image);
  expect(container.querySelector('.artist-hero')).toHaveAttribute('data-has-art', 'false');
  const fallback = container.querySelector('.artist-hero-image');
  if (!fallback) throw new Error('缺少专辑兜底');
  fireEvent.load(fallback);
  expect(container.querySelector('.artist-hero')).toHaveAttribute('data-artwork', 'album');
  expect(screen.getByAltText('专辑封面')).toBeInTheDocument();
  expect(screen.getByText('2 张专辑')).toBeInTheDocument();
  unmount(); client.clear(); api.dispose();
});

it('uses an album cover when the server has no artist image, then a gradient if every image fails', async () => {
  const { api, client, container, unmount } = setup();
  await screen.findByRole('heading', { name: '测试歌手' });
  const fallback = container.querySelector('.artist-hero-image');
  if (!fallback) throw new Error('缺少专辑兜底');
  fireEvent.load(fallback);
  expect(container.querySelector('.artist-hero')).toHaveAttribute('data-artwork', 'album');
  fireEvent.error(fallback);
  expect(container.querySelector('.artist-hero')).toHaveAttribute('data-has-art', 'false');
  expect(container.querySelector('.artist-hero-image')).toBeNull();
  expect(screen.queryByAltText('专辑封面')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看专辑 第一张' })).toBeInTheDocument();
  unmount(); client.clear(); api.dispose();
});

it('plays only the scoped albums and preserves repeated tracks across albums', async () => {
  const { api, client, unmount } = setup();
  const track = { id: 'same-song', title: '同一首歌', artist: '测试歌手' };
  const album = vi.spyOn(api, 'album').mockResolvedValue({ id: 'album-1', name: '专辑', artist: '测试歌手', songs: [track] });
  fireEvent.click(await screen.findByRole('button', { name: '播放 测试歌手' }));
  await waitFor(() => expect(player.replace).toHaveBeenCalledWith([track, track], 0));
  expect(album).toHaveBeenNthCalledWith(1, 'album-1', expect.any(AbortSignal));
  expect(album).toHaveBeenNthCalledWith(2, 'album-2', expect.any(AbortSignal));
  unmount(); client.clear(); api.dispose();
});

it('cancels pending playback when navigating to another artist', async () => {
  const { api, client, unmount } = setup();
  let complete: ((value: Awaited<ReturnType<MusicApi['album']>>) => void) | undefined;
  let signal: AbortSignal | undefined;
  vi.spyOn(api, 'album').mockImplementation((_id, requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => { complete = resolve; });
  });
  fireEvent.click(await screen.findByRole('button', { name: '播放 测试歌手' }));
  fireEvent.click(screen.getByRole('link', { name: '另一位歌手' }));
  expect(signal?.aborted).toBe(true);
  complete?.({ id: 'album-1', name: '专辑', artist: '测试歌手', songs: [{ id: 'old-song', title: '旧歌曲', artist: '测试歌手' }] });
  await screen.findByRole('heading', { name: '测试歌手' });
  expect(player.replace).not.toHaveBeenCalled();
  unmount(); client.clear(); api.dispose();
});

it('keeps the current queue when preparing an artist fails', async () => {
  const { api, client, unmount } = setup();
  vi.spyOn(api, 'album').mockResolvedValueOnce({ id: 'album-1', name: '专辑', artist: '测试歌手', songs: [{ id: 'song', title: '歌曲', artist: '测试歌手' }] }).mockRejectedValueOnce(new Error('专辑读取失败'));
  fireEvent.click(await screen.findByRole('button', { name: '播放 测试歌手' }));
  await waitFor(() => expect(useSession.getState().notice).toBe('专辑读取失败'));
  expect(player.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '播放 测试歌手' })).toBeEnabled();
  unmount(); client.clear(); api.dispose();
});

it('starts artist shuffle through the existing player', async () => {
  const { api, client, unmount } = setup();
  vi.spyOn(api, 'album').mockResolvedValue({ id: 'album-1', name: '专辑', artist: '测试歌手', songs: [{ id: 'song', title: '歌曲', artist: '测试歌手' }] });
  await screen.findByRole('heading', { name: '测试歌手' });
  fireEvent.click(screen.getByRole('button', { name: '随机播放歌手歌曲' }));
  await waitFor(() => expect(player.shuffle).toHaveBeenCalledTimes(1));
  expect(player.replace).toHaveBeenCalledTimes(1);
  unmount(); client.clear(); api.dispose();
});
