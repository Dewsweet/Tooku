import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AlbumGrid } from '../src/components/Common';
import { MusicApi } from '../src/api/client';
import { useSession } from '../src/state/session';
import { player } from '../src/features/player/engine';

vi.mock('../src/features/player/engine', () => ({ player: { replace: vi.fn() } }));
afterEach(() => { cleanup(); useSession.getState().setSession(null); vi.restoreAllMocks(); vi.mocked(player.replace).mockClear(); });
const item = { id: 'album-1', name: '雨夜', artist: '测试歌手' };
function Location() { return <output>{useLocation().pathname}</output>; }
it('plays a cover-button album without navigating away from browsing', async () => {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  const songs = [{ id: 'song', title: '序曲', artist: '测试歌手' }];
  vi.spyOn(api, 'album').mockResolvedValue({ ...item, songs }); useSession.getState().setSession(api);
  render(<MemoryRouter initialEntries={['/albums']}><AlbumGrid albums={[item]} /><Location /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '播放专辑 雨夜' }));
  await waitFor(() => expect(player.replace).toHaveBeenCalledWith(songs));
  expect(screen.getByText('/albums')).toBeInTheDocument(); expect(screen.getByRole('link', { name: '查看专辑 雨夜' })).toHaveAttribute('href', '/albums/album-1');
  api.dispose();
});
it('does not replace a playing queue with an empty album', async () => {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'album').mockResolvedValue({ ...item, songs: [] }); useSession.getState().setSession(api);
  render(<MemoryRouter><AlbumGrid albums={[item]} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '播放专辑 雨夜' }));
  await waitFor(() => expect(useSession.getState().notice).toContain('还没有可播放'));
  expect(player.replace).not.toHaveBeenCalled(); api.dispose(); useSession.getState().notify('');
});
