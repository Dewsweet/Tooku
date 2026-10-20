import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { useSession } from '../src/state/session';
import { useLibrary } from '../src/state/library';
import { Home } from '../src/pages/Home';

afterEach(() => { useSession.getState().setSession(null); useLibrary.setState({ profiles: {} }); vi.restoreAllMocks(); });

function renderHome(artists: { id: string; name: string; albumCount?: number }[]) {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'home-library', name: 'Music Library' }]);
  vi.spyOn(api, 'albums').mockResolvedValue([]);
  vi.spyOn(api, 'playlists').mockResolvedValue([]);
  const artistQuery = vi.spyOn(api, 'artists').mockResolvedValue(artists);
  vi.spyOn(api, 'libraryOverview').mockResolvedValue({ albums: 0, songs: 0, duration: 0 });
  const songs = vi.spyOn(api, 'songs').mockResolvedValue([]);
  useLibrary.getState().change(api.identity, (profile) => ({ ...profile, activeId: 'home-library', views: { 'home-library': 'songs' } }));
  useSession.getState().setSession(api);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter><Home /></MemoryRouter></QueryClientProvider>);
  return { ...view, api, client, songs, artistQuery };
}

it('replaces the home song filter with library-scoped artists and links to their pages', async () => {
  const { api, client, songs, artistQuery, container, unmount } = renderHome([{ id: 'artist/1', name: '测试歌手', albumCount: 2 }]);
  const filters = within(screen.getByRole('group', { name: '主页内容' }));
  expect(filters.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  expect(filters.queryByRole('button', { name: '歌曲' })).not.toBeInTheDocument();
  fireEvent.click(filters.getByRole('button', { name: '歌手' }));
  expect(await screen.findByRole('link', { name: '测试歌手 2 张专辑' })).toHaveAttribute('href', '/artists/artist%2F1');
  expect(screen.getByRole('link', { name: '查看全部' })).toHaveAttribute('href', '/artists');
  expect(artistQuery).toHaveBeenCalledWith(expect.any(AbortSignal), 'home-library');
  expect(songs).not.toHaveBeenCalled();
  expect(container.querySelector('.home-footer')).toBeNull();
  expect(screen.queryByText('浏览所有歌曲')).not.toBeInTheDocument();
  unmount(); client.clear(); api.dispose();
});

it('shows an empty state for a library without artists', async () => {
  const { api, client, unmount } = renderHome([]);
  fireEvent.click(screen.getByRole('button', { name: '歌手' }));
  await waitFor(() => expect(screen.getByText('这个音乐库还没有歌手')).toBeInTheDocument());
  unmount(); client.clear(); api.dispose();
});
