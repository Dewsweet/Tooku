import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { Albums, Artists } from '../src/pages/Library';
import { useLibrary } from '../src/state/library';
import { useSession } from '../src/state/session';
import { useDisplayPreferences } from '../src/state/display';

afterEach(() => { cleanup(); useSession.getState().setSession(null); useLibrary.setState({ profiles: {} }); useDisplayPreferences.setState({ gridColumns: { albums: 4, artists: 4 } }); vi.restoreAllMocks(); });
function setup() {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'library-1', name: '测试曲库' }]);
  vi.spyOn(api, 'artists').mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSession.getState().setSession(api);
  return { api, client, show: (artists = false) => render(<QueryClientProvider client={client}><MemoryRouter><main className="content">{artists ? <Artists /> : <Albums />}</main></MemoryRouter></QueryClientProvider>) };
}
it('loads every album batch without scrolling and displays the completed grid together', async () => {
  const { api, client, show } = setup();
  const page = Array.from({ length: 500 }, (_, index) => ({ id: `a-${index}`, name: `专辑 ${index}`, artist: '歌手' }));
  let finish!: (data: Record<string, unknown>) => void;
  const request = vi.spyOn(api, 'request').mockResolvedValueOnce({ albumList2: { album: page } }).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = show();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(view.container.querySelector('.album-card')).toBeNull();
  finish({ albumList2: { album: [{ id: 'last', name: '最后一张', artist: '歌手' }] } });
  await waitFor(() => expect(view.container.querySelector('.album-name[href="/albums/last"]')).toHaveTextContent('最后一张'));
  expect(view.container.querySelectorAll('.album-card')).toHaveLength(501);
  expect(request).toHaveBeenLastCalledWith('getAlbumList2', { type: 'newest', size: 500, offset: 500, musicFolderId: 'library-1' }, expect.any(AbortSignal));
  view.unmount(); client.clear(); api.dispose();
}, 10000);
it('shows a read error and allows an explicit retry', async () => {
  const { api, client, show } = setup();
  const albums = vi.spyOn(api, 'allAlbums').mockRejectedValueOnce(new Error('读取专辑失败')).mockResolvedValueOnce([{ id: 'a', name: '重试专辑', artist: '歌手' }]);
  const view = show();
  await screen.findByRole('alert');
  expect(albums).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('link', { name: '查看专辑 重试专辑' });
  expect(albums).toHaveBeenCalledTimes(2);
  view.unmount(); client.clear(); api.dispose();
});
it('keeps album and artist column choices separate and reuses them on remount', () => {
  const { api, client, show } = setup();
  vi.spyOn(api, 'allAlbums').mockResolvedValue([]);
  const view = show();
  fireEvent.click(screen.getByRole('combobox', { name: '专辑每行数量' }));
  fireEvent.click(screen.getByRole('option', { name: '每行 6 个' }));
  expect(useDisplayPreferences.getState().gridColumns).toEqual({ albums: 6, artists: 4 });
  view.unmount();
  const artists = show(true);
  expect(screen.getByRole('combobox', { name: '歌手每行数量' })).toHaveTextContent('每行 4 个');
  artists.unmount();
  const albums = show();
  expect(screen.getByRole('combobox', { name: '专辑每行数量' })).toHaveTextContent('每行 6 个');
  albums.unmount(); client.clear(); api.dispose();
});
