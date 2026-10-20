import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { Interactions } from '../src/components/Interactions';
import { Favorites } from '../src/pages/Collection';
import { useLibrary } from '../src/state/library';
import { useSession } from '../src/state/session';

type FavoriteData = Awaited<ReturnType<MusicApi['favorites']>>;
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanup(); useSession.getState().setSession(null); useLibrary.setState({ profiles: {} });
  for (const dispose of cleanups.splice(0)) dispose();
  vi.restoreAllMocks();
});

function setup(data: FavoriteData = { songs: [], albums: [], artists: [] }) {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'favorites-library', name: '测试曲库' }]);
  const favorites = vi.spyOn(api, 'favorites').mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanups.push(() => { client.clear(); api.dispose(); });
  useSession.getState().setSession(api);
  const view = render(<QueryClientProvider client={client}><MemoryRouter><Interactions><Favorites addToPlaylist={vi.fn()} /></Interactions></MemoryRouter></QueryClientProvider>);
  return { ...view, api, favorites };
}

it.each(['歌曲', '专辑', '歌手'])('shows only the concise empty message for %s', async (label) => {
  const { container, favorites } = setup();
  const filters = within(screen.getByRole('group', { name: '收藏分类' }));
  fireEvent.click(filters.getByRole('button', { name: label }));
  expect(await screen.findByRole('heading', { name: `还没有收藏的${label}` })).toBeInTheDocument();
  expect(filters.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  expect(container.querySelector('.empty')?.textContent).toBe(`还没有收藏的${label}`);
  expect(container.querySelector('.empty p')).toBeNull();
  expect(favorites).toHaveBeenCalledWith(expect.any(AbortSignal), 'favorites-library');
});

it('renders saved artists as linked artwork cards and falls back when an image fails', async () => {
  const { api, container } = setup({ songs: [], albums: [], artists: [{ id: 'artist/1', name: '坂本龍一', coverArt: 'server-artist-cover' }] });
  fireEvent.click(screen.getByRole('button', { name: '歌手' }));
  const artist = await screen.findByRole('link', { name: '坂本龍一' });
  expect(artist).toHaveAttribute('href', '/artists/artist%2F1');
  expect(artist).toHaveClass('artist-card');
  const image = artist.querySelector('img');
  expect(image).toHaveAttribute('src', api.coverUrl('server-artist-cover', 500));
  expect(artist.querySelector('p')).toBeNull();
  if (!image) throw new Error('缺少歌手图片');
  fireEvent.error(image);
  const fallback = artist.querySelector('img');
  expect(fallback).toHaveAttribute('src', api.coverUrl('ar-artist/1', 500));
  if (!fallback) throw new Error('缺少图片回退');
  fireEvent.error(fallback);
  expect(artist.querySelector('.entity-initials')).toHaveTextContent('坂本');
  expect(container.querySelector('.artist-chips')).toBeNull();
});

it('preserves cover art supplied by the starred artist response', async () => {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  cleanups.push(() => api.dispose());
  const request = vi.spyOn(api, 'request').mockResolvedValue({ starred2: { artist: [{ id: 'artist-1', name: '收藏歌手', coverArt: 'artist-picture' }] } });
  expect((await api.favorites(undefined, 'library-1')).artists).toEqual([{ id: 'artist-1', name: '收藏歌手', coverArt: 'artist-picture' }]);
  expect(request).toHaveBeenCalledWith('getStarred2', { musicFolderId: 'library-1' }, undefined);
});
