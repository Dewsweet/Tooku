import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { MusicApi } from '../src/api/client';
import { Interactions } from '../src/components/Interactions';
import { player, usePlayer } from '../src/features/player/engine';
import { defaultPanelSections, usePreferences } from '../src/state/preferences';
import { useDisplayPreferences } from '../src/state/display';
import { useLibrary } from '../src/state/library';
import { useSession } from '../src/state/session';

let api: MusicApi; let client: QueryClient; let mobile: boolean;
const listeners = new Set<() => void>();
beforeEach(() => {
  mobile = true; listeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({ get matches() { return query.includes('max-width') && mobile; }, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'library', name: '测试曲库' }]);
  vi.spyOn(api, 'playlists').mockResolvedValue([]);
  vi.spyOn(api, 'favorites').mockResolvedValue({ songs: [], albums: [], artists: [] });
  vi.spyOn(api, 'allAlbums').mockResolvedValue([]);
  vi.spyOn(api, 'artists').mockResolvedValue([]);
  vi.spyOn(player, 'connectedTo').mockReturnValue(true);
  useSession.getState().setSession(api);
  usePreferences.setState({ ...usePreferences.getInitialState(), reducedMotion: true, panelSections: defaultPanelSections.map((section) => ({ ...section, enabled: section.id !== 'lyrics' })) });
  useDisplayPreferences.setState({ gridColumns: { albums: 6, artists: 8 } });
  usePlayer.setState({ ...usePlayer.getInitialState(), status: 'playing', position: 42, currentId: 'one', entries: [
    { entryId: 'one', track: { id: 'a', title: '重复歌曲', artist: '歌手', artistId: 'artist', albumId: 'album' } },
    { entryId: 'two', track: { id: 'b', title: '下一首', artist: '歌手', artistId: 'artist' } },
    { entryId: 'three', track: { id: 'a', title: '重复歌曲', artist: '歌手', artistId: 'artist', albumId: 'album' } },
  ] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null); usePlayer.setState(usePlayer.getInitialState()); useLibrary.setState({ profiles: {} });
  usePreferences.setState(usePreferences.getInitialState()); useDisplayPreferences.setState({ gridColumns: { albums: 4, artists: 4 } });
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function setup(path = '/albums') {
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Interactions><App /></Interactions></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  return view;
}
function openQueue() {
  const trigger = screen.getByRole('button', { name: '播放队列，3 首' }); trigger.focus(); fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: '播放队列' }) };
}
it('keeps only navigation, home, search and account in the mobile header', async () => {
  const { container } = await setup();
  const header = within(container.querySelector<HTMLElement>('.workspace-header')!);
  expect(header.getByRole('button', { name: '打开导航' })).toBeInTheDocument();
  expect(header.getByRole('link', { name: '主页' })).toBeInTheDocument();
  expect(header.getByRole('textbox', { name: '搜索音乐库' })).toBeInTheDocument();
  expect(header.getByRole('button', { name: '账户菜单' })).toBeInTheDocument();
  expect(header.queryByRole('link', { name: 'Tooku 主页' })).not.toBeInTheDocument();
  expect(header.queryByRole('button', { name: '后退' })).not.toBeInTheDocument();
  expect(header.queryByRole('button', { name: '前进' })).not.toBeInTheDocument();
  expect(header.queryByRole('button', { name: /播放侧栏/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: '播放侧栏' })).not.toBeInTheDocument();
});
it.each(['/albums', '/artists'])('hides density controls on %s without overwriting desktop preferences', async (path) => {
  await setup(path);
  expect(screen.queryByRole('combobox', { name: /每行数量/ })).not.toBeInTheDocument();
  expect(useDisplayPreferences.getState().gridColumns).toEqual({ albums: 6, artists: 8 });
  act(() => { mobile = false; listeners.forEach((listener) => listener()); });
  expect(screen.getByRole('combobox', { name: /每行数量/ })).toHaveTextContent(path === '/albums' ? '每行 6 个' : '每行 8 个');
});
it('renders a compact dock with only cover, metadata, queue, desktop lyrics and play/pause', async () => {
  await setup();
  const dock = within(screen.getByRole('contentinfo', { name: '音乐播放器' }));
  expect(dock.getAllByRole('button')).toHaveLength(4);
  expect(dock.getByRole('button', { name: '展开播放器：重复歌曲' })).toBeInTheDocument();
  expect(dock.getByRole('link', { name: '重复歌曲' })).toBeInTheDocument();
  expect(dock.getByRole('button', { name: '桌面歌词' })).toBeInTheDocument();
  expect(dock.queryByRole('slider')).not.toBeInTheDocument();
  expect(dock.queryByRole('button', { name: '下一首' })).not.toBeInTheDocument();
  const toggle = vi.spyOn(player, 'toggle').mockImplementation(() => {});
  fireEvent.click(dock.getByRole('button', { name: '暂停' })); expect(toggle).toHaveBeenCalledOnce();
});
it('opens a separate queue sheet and closes directly to the browser without changing sidebar preferences or audio', async () => {
  usePreferences.setState({ sidePanel: false });
  await setup();
  const attach = vi.spyOn(player, 'attach'); const replace = vi.spyOn(player, 'replace'); const select = vi.spyOn(player, 'select');
  const { trigger, dialog } = openQueue();
  expect(dialog).toHaveClass('mobile-queue-sheet'); expect(dialog).not.toHaveClass('is-expanded');
  expect(screen.queryByRole('complementary', { name: '播放侧栏' })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  expect(screen.queryByRole('complementary', { name: '播放侧栏' })).not.toBeInTheDocument();
  expect(usePreferences.getState().sidePanel).toBe(false);
  expect(usePlayer.getState()).toMatchObject({ currentId: 'one', status: 'playing', position: 42 });
  expect(attach).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});
it('closes the mobile sheet when returning to desktop without enabling the desktop sidebar or restarting audio', async () => {
  usePreferences.setState({ sidePanel: false });
  await setup(); openQueue();
  const attach = vi.spyOn(player, 'attach'); const replace = vi.spyOn(player, 'replace');
  act(() => { mobile = false; listeners.forEach((listener) => listener()); });
  expect(screen.queryByRole('dialog', { name: '播放队列' })).not.toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: '播放侧栏' })).not.toBeInTheDocument();
  expect(usePlayer.getState()).toMatchObject({ currentId: 'one', position: 42, status: 'playing' });
  expect(attach).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
});
it('expands and collapses the queue handle by click or keyboard while keeping the queue scroll viewport', async () => {
  await setup(); const { dialog } = openQueue(); const viewport = dialog.querySelector('.mobile-queue-scroll')!;
  viewport.scrollTop = 90;
  fireEvent.click(within(dialog).getByRole('button', { name: '展开队列' })); expect(dialog).toHaveClass('is-expanded');
  fireEvent.keyDown(within(dialog).getByRole('button', { name: '收起队列' }), { key: 'ArrowDown' }); expect(dialog).not.toHaveClass('is-expanded');
  expect(dialog.querySelector('.mobile-queue-scroll')).toBe(viewport); expect(viewport.scrollTop).toBe(90);
  fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
function pointer(target: HTMLElement, type: string, clientY: number) {
  const event = new Event(type, { bubbles: true }); Object.assign(event, { pointerId: 1, button: 0, clientY }); fireEvent(target, event);
}
it('snaps a handle swipe to full height, ignores scrolling gestures, and cancels an interrupted drag', async () => {
  await setup(); const { dialog } = openQueue();
  vi.stubGlobal('innerHeight', 1000);
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 750));
  const handle = within(dialog).getByRole('button', { name: '展开队列' });
  pointer(handle, 'pointerdown', 500); pointer(handle, 'pointermove', 350);
  expect(dialog.style.getPropertyValue('--queue-sheet-height')).toBe('900px');
  pointer(handle, 'pointerup', 350); expect(dialog).toHaveClass('is-expanded');
  fireEvent.click(handle, { detail: 1 }); expect(dialog).toHaveClass('is-expanded'); // Ignore the click emitted after a swipe.
  expect(dialog).not.toHaveAttribute('data-dragging');
  pointer(dialog.querySelector('.mobile-queue-scroll')!, 'pointerdown', 500); pointer(dialog, 'pointerup', 600);
  expect(dialog).toHaveClass('is-expanded');
  pointer(handle, 'pointerdown', 300); pointer(handle, 'pointermove', 450); pointer(handle, 'pointercancel', 450);
  expect(dialog).toHaveClass('is-expanded'); expect(dialog.style.getPropertyValue('--queue-sheet-height')).toBe('');
});
it('uses occurrence indices for mobile queue actions on duplicate songs', async () => {
  await setup(); const { dialog } = openQueue(); const move = vi.spyOn(player, 'move').mockImplementation(() => {});
  const nextDuplicate = within(dialog).getAllByRole('button', { name: '队列歌曲选项 重复歌曲' })[1];
  fireEvent.click(nextDuplicate); fireEvent.click(screen.getByRole('menuitem', { name: '上移' }));
  await waitFor(() => expect(move).toHaveBeenCalledWith(2, 1));
});
