import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { MusicApi } from '../src/api/client';
import { player, usePlayer } from '../src/features/player/engine';
import { defaultPanelSections, usePreferences } from '../src/state/preferences';
import { useLibrary } from '../src/state/library';
import { useSession } from '../src/state/session';

let api: MusicApi; let client: QueryClient;
beforeEach(() => {
  api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'library', name: '测试曲库' }]);
  vi.spyOn(api, 'playlists').mockResolvedValue([]);
  vi.spyOn(api, 'favorites').mockResolvedValue({ songs: [], albums: [], artists: [] });
  vi.spyOn(player, 'connectedTo').mockReturnValue(true);
  useSession.getState().setSession(api);
  usePreferences.setState({ ...usePreferences.getInitialState(), panelSections: defaultPanelSections.map((section) => ({ ...section, enabled: section.id !== 'lyrics' })) });
  usePlayer.setState({ ...usePlayer.getInitialState(), status: 'playing', position: 42, currentId: 'one', entries: [
    { entryId: 'one', track: { id: 'a', title: '当前歌曲', artist: '歌手', artistId: 'artist', albumId: 'album' } },
    { entryId: 'two', track: { id: 'b', title: '下一首', artist: '歌手', artistId: 'artist' } },
  ] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null);
  usePreferences.setState(usePreferences.getInitialState()); useLibrary.setState({ profiles: {} }); usePlayer.setState(usePlayer.getInitialState());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function setup(compact = false, reduced = false) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 1199px)' ? compact : query === '(prefers-reduced-motion: reduce)' && reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/history']}><App /></MemoryRouter></QueryClientProvider>);
  await screen.findByRole('button', { name: '播放队列，2 首' });
  await waitFor(() => expect(api.libraries).toHaveBeenCalled());
  return view;
}
it('covers the existing sidebar, preserves its scroll position and restores it on close', async () => {
  const { container } = await setup();
  const sidebar = screen.getByRole('complementary', { name: '播放侧栏' });
  const base = container.querySelector('.now-panel-base')!;
  const viewport = base.querySelector('.now-panel-scroll')!;
  viewport.scrollTop = 135;
  const trigger = screen.getByRole('button', { name: '播放队列，2 首' }); trigger.focus();
  const replace = vi.spyOn(player, 'replace'); const attach = vi.spyOn(player, 'attach');
  fireEvent.click(trigger);
  const queue = screen.getByRole('region', { name: '播放队列' });
  expect(queue.closest('aside')).toBe(sidebar);
  expect(base).toHaveAttribute('inert'); expect(base).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('group', { name: '播放侧栏视图' })).not.toBeInTheDocument();
  expect(within(queue).getByRole('button', { name: '关闭播放队列' })).toHaveFocus();
  fireEvent.click(within(queue).getByRole('button', { name: '关闭播放队列' }));
  expect(base).not.toHaveAttribute('inert');
  expect(container.querySelector('.now-panel-scroll')).toBe(viewport); expect(viewport.scrollTop).toBe(135);
  expect(usePreferences.getState().sidePanel).toBe(true);
  expect(screen.getByRole('heading', { name: '正在播放' })).toBeInTheDocument(); expect(trigger).toHaveFocus();
  expect(queue.querySelector('.integrated-queue')).not.toBeNull();
  await waitFor(() => expect(queue.querySelector('.integrated-queue')).toBeNull());
  expect(usePlayer.getState()).toMatchObject({ currentId: 'one', status: 'playing', position: 42 });
  expect(replace).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled();
});
it('lets the dock toggle or Escape close the queue while keeping the sidebar open', async () => {
  await setup();
  const trigger = screen.getByRole('button', { name: '播放队列，2 首' });
  fireEvent.click(trigger); fireEvent.click(trigger);
  expect(screen.queryByRole('region', { name: '播放队列' })).not.toBeInTheDocument();
  expect(usePreferences.getState().sidePanel).toBe(true);
  fireEvent.click(trigger); fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: '播放队列' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '正在播放' })).toBeInTheDocument();
});
it('keeps the compact sidebar visible after closing the queue and dismisses it on the next Escape', async () => {
  const { container } = await setup(true);
  const trigger = screen.getByRole('button', { name: '播放队列，2 首' }); trigger.focus(); fireEvent.click(trigger);
  expect(container.querySelector('.workspace-shell')).toHaveClass('panel-overlay-open');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: '播放队列' })).not.toBeInTheDocument();
  expect(container.querySelector('.workspace-shell')).toHaveClass('panel-overlay-open');
  expect(screen.getByRole('button', { name: '调整侧栏版块' })).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(container.querySelector('.workspace-shell')).not.toHaveClass('panel-overlay-open');
});
it('skips the exit delay for reduced motion and safely reopens during an ordinary exit', async () => {
  const { unmount } = await setup(false, true);
  const trigger = screen.getByRole('button', { name: '播放队列，2 首' }); fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: '关闭播放队列' }));
  expect(document.querySelector('.now-panel-queue-layer .integrated-queue')).toBeNull();
  unmount();
  await setup();
  const dock = screen.getByRole('button', { name: '播放队列，2 首' }); fireEvent.click(dock);
  fireEvent.click(screen.getByRole('button', { name: '关闭播放队列' })); fireEvent.click(dock);
  await new Promise((resolve) => setTimeout(resolve, 260));
  expect(screen.getByRole('region', { name: '播放队列' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '关闭播放队列' })).toHaveFocus();
});
