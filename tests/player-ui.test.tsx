import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MusicApi } from '../src/api/client';
import { lyricsApi } from '../src/api/lyrics';
import { useLyricsProfiles } from '../src/state/lyrics';
import { useSession } from '../src/state/session';
import { usePreferences } from '../src/state/preferences';
import { player, usePlayer } from '../src/features/player/engine';
import { LyricsPlayer } from '../src/features/player/ExpandedPlayer';
import { PlayerBar, Progress } from '../src/features/player/PlayerUI';
import { Modal } from '../src/components/Modal';
import { Interactions } from '../src/components/Interactions';
import { ScrollingText } from '../src/features/player/ScrollingText';

it('does not start dismissing a busy modal and can close again after saving fails', () => {
  const close = vi.fn();
  const view = render(<Modal title="保存图片" busy onClose={close}><p>正在保存</p></Modal>);
  fireEvent(screen.getByRole('dialog', { name: '保存图片' }), new Event('cancel', { cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).not.toHaveClass('is-closing');
  view.rerender(<Modal title="保存图片" onClose={close}><p>保存失败</p></Modal>);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(close).toHaveBeenCalledTimes(1);
});

let api: MusicApi; let client: QueryClient;
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  api = new MusicApi('http://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'favorites').mockResolvedValue({ songs: [], albums: [], artists: [] });
  vi.spyOn(api, 'song').mockResolvedValue({ id: 'a', title: '当前曲目', artist: '测试歌手' });
  vi.spyOn(api, 'lyrics').mockResolvedValue({ synced: true, offsetMs: 0, lines: [{ startMs: 0, text: '第一句测试歌词' }, { startMs: 10000, text: '第二句测试歌词' }] });
  useSession.getState().setSession(api); usePreferences.setState({ reducedMotion: true });
  useSession.setState({ notice: '' });
  useLyricsProfiles.setState({ profiles: {}, refreshes: {} });
  document.documentElement.dataset.motion = 'reduced';
  usePlayer.setState({ ...usePlayer.getInitialState(), status: 'paused', position: 11, duration: 90, volume: 0.65, currentId: 'first', entries: [
    { entryId: 'first', source: { kind: 'playlist', id: 'playlist a' }, track: { id: 'a', title: '当前曲目', artist: '测试歌手', albumId: 'album a', artistId: 'artist a', duration: 90 } },
    { entryId: 'second', track: { id: 'b', title: '接下来的歌', artist: '另一位歌手', duration: 120 } },
  ] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null); usePlayer.setState(usePlayer.getInitialState()); usePreferences.setState({ reducedMotion: false });
  delete document.documentElement.dataset.motion;
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen'); Reflect.deleteProperty(document, 'exitFullscreen'); Reflect.deleteProperty(document, 'fullscreenElement');
  vi.useRealTimers(); vi.restoreAllMocks();
});
function RouteMarker() { const location = useLocation(); return <output data-testid="route-path">{location.pathname}</output>; }
const surface = (child: React.ReactNode) => render(<QueryClientProvider client={client}><MemoryRouter><Interactions>{child}<RouteMarker /></Interactions></MemoryRouter></QueryClientProvider>);
function dockTouch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', x: number, y = 30) {
  const point = { identifier: 1, clientX: x, clientY: y }; const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches: type === 'touchstart' || type === 'touchmove' ? [point] : [], changedTouches: [point] });
  fireEvent(target, event); return event;
}
it('uses the dock title to navigate to the current playback source and keeps playback intact', () => {
  surface(<PlayerBar openQueue={() => {}} openLyrics={() => {}} />);
  fireEvent.click(screen.getByRole('link', { name: '当前曲目' }));
  expect(screen.getByTestId('route-path')).toHaveTextContent('/playlists/playlist%20a');
  expect(usePlayer.getState()).toMatchObject({ currentId: 'first', position: 11, status: 'paused' });
});
it('uses deliberate horizontal swipes on mobile track information for previous and next', () => {
  vi.useFakeTimers(); usePreferences.setState({ reducedMotion: false }); delete document.documentElement.dataset.motion;
  usePlayer.setState({ position: 0 });
  const next = vi.spyOn(player, 'next').mockImplementation(() => usePlayer.setState({ currentId: 'second' }));
  const previous = vi.spyOn(player, 'previous').mockImplementation(() => usePlayer.setState({ currentId: 'first' }));
  const open = vi.fn(); const view = surface(<PlayerBar mobile openQueue={() => {}} openLyrics={open} />);
  const track = view.container.querySelector<HTMLElement>('.dock-track')!;
  Object.defineProperty(track, 'clientWidth', { configurable: true, value: 200 });
  expect(track.querySelector('.dock-swipe-preview.is-next')).toHaveTextContent('接下来的歌另一位歌手');
  dockTouch(track, 'touchstart', 250); const move = dockTouch(track, 'touchmove', 170);
  expect(track).toHaveAttribute('data-swipe-direction', 'next');
  expect(track.style.getPropertyValue('--dock-swipe-x')).toBe('-80px'); expect(track.style.getPropertyValue('--dock-swipe-progress')).toBe('0.4');
  dockTouch(track, 'touchend', 160);
  expect(track).toHaveAttribute('data-swipe-settling', 'true'); expect(track.style.getPropertyValue('--dock-swipe-x')).toBe('-200px');
  expect(move.defaultPrevented).toBe(true); expect(next).not.toHaveBeenCalled(); expect(previous).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(190)); expect(next).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '展开播放器：接下来的歌' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开播放器：接下来的歌' }), { detail: 1 }); expect(open).not.toHaveBeenCalled();
  dockTouch(track, 'touchstart', 110); dockTouch(track, 'touchmove', 180);
  expect(track).toHaveAttribute('data-swipe-direction', 'previous'); expect(track.querySelector('.dock-swipe-preview.is-previous')).toHaveTextContent('当前曲目测试歌手');
  dockTouch(track, 'touchend', 190);
  act(() => vi.advanceTimersByTime(190)); expect(previous).toHaveBeenCalledOnce();
  dockTouch(track, 'touchstart', 200, 20); dockTouch(track, 'touchmove', 204, 100); dockTouch(track, 'touchend', 204, 100);
  expect(next).toHaveBeenCalledOnce(); expect(previous).toHaveBeenCalledOnce();
  const scrolling = view.container.querySelector('.scrolling-text')!;
  scrolling.setAttribute('data-overflow', 'true'); scrolling.setAttribute('data-animate', 'false');
  dockTouch(scrolling, 'touchstart', 250); dockTouch(scrolling, 'touchmove', 150); dockTouch(scrolling, 'touchend', 140);
  expect(next).toHaveBeenCalledOnce(); expect(previous).toHaveBeenCalledOnce();
});
it('scrolls overflowing metadata only, updates on resize, and honors reduced motion', () => {
  let resize = () => {}; const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  try {
    const text = 'THE IDOLM＠STER、中村繪里子、今井麻美、仁後真耶子、落合祐里香';
    const view = render(<ScrollingText text={text} />);
    const content = screen.getByText(text); const viewport = content.parentElement!;
    let width = 260;
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, get: () => width });
    Object.defineProperty(content, 'scrollWidth', { configurable: true, value: 900 });
    act(() => resize());
    expect(viewport).toHaveAttribute('data-overflow', 'true'); expect(viewport).toHaveAttribute('tabindex', '0');
    expect(viewport).toHaveAttribute('data-animate', 'false');
    act(() => usePreferences.setState({ reducedMotion: false })); expect(viewport).toHaveAttribute('data-animate', 'true');
    expect(viewport.style.getPropertyValue('--text-distance')).toBe('-640px');
    width = 1000; act(() => resize());
    expect(viewport).toHaveAttribute('data-overflow', 'false'); expect(viewport).toHaveAttribute('data-animate', 'false');
    expect(viewport).toHaveAttribute('tabindex', '-1');
    view.unmount(); expect(disconnect).toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
function fullscreenFixture() {
  let element: Element | null = null;
  const set = (next: Element | null) => { element = next; document.dispatchEvent(new Event('fullscreenchange')); };
  const request = vi.fn(async () => set(document.documentElement)); const exit = vi.fn(async () => set(null));
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  return { request, exit, set };
}

it('enters and exits native fullscreen, including Escape changes, without closing or resetting the player', async () => {
  const fullscreen = fullscreenFixture(); const close = vi.fn();
  surface(<LyricsPlayer onClose={close} addToPlaylist={() => {}} />);
  await screen.findByRole('button', { name: '第一句测试歌词' });
  fireEvent.click(screen.getByRole('button', { name: '进入全屏' }));
  await screen.findByRole('button', { name: '退出全屏' }); expect(fullscreen.request).toHaveBeenCalledOnce();
  expect(screen.getByRole('dialog', { name: '正在播放' })).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: '退出全屏' }));
  await screen.findByRole('button', { name: '进入全屏' }); expect(fullscreen.exit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '进入全屏' })); await screen.findByRole('button', { name: '退出全屏' });
  act(() => fullscreen.set(null)); await screen.findByRole('button', { name: '进入全屏' });
  expect(close).not.toHaveBeenCalled(); expect(usePlayer.getState().currentId).toBe('first'); expect(usePlayer.getState().position).toBe(11);
});
it('uses the dock fullscreen button to open the player within the same user action', async () => {
  const fullscreen = fullscreenFixture(); const open = vi.fn();
  surface(<PlayerBar openQueue={() => {}} openLyrics={open} />);
  fireEvent.click(screen.getByRole('button', { name: '进入全屏' }));
  await screen.findByRole('button', { name: '退出全屏' });
  expect(fullscreen.request).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce(); expect(usePlayer.getState().position).toBe(11);
});
it('reports fullscreen rejection without affecting audio and disables the control when unsupported', async () => {
  const fullscreen = fullscreenFixture(); fullscreen.request.mockRejectedValue(new Error('denied'));
  const view = surface(<PlayerBar openQueue={() => {}} openLyrics={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '进入全屏' }));
  await waitFor(() => expect(useSession.getState().notice).toBe('无法切换全屏，请重试'));
  expect(usePlayer.getState().position).toBe(11); view.unmount();
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
  surface(<PlayerBar openQueue={() => {}} openLyrics={() => {}} />); expect(screen.getByRole('button', { name: '进入全屏' })).toBeDisabled();
});

it('previews a seek and commits once on pointer release', () => {
  const seek = vi.spyOn(player, 'seek').mockImplementation(() => {});
  surface(<Progress />); const slider = screen.getByRole('slider', { name: '播放进度' });
  fireEvent.change(slider, { target: { value: '35' } }); expect(seek).not.toHaveBeenCalled();
  expect(slider).toHaveAttribute('aria-valuetext', '0:35，共 1:30');
  fireEvent.pointerUp(slider); fireEvent.blur(slider); expect(seek).toHaveBeenCalledExactlyOnceWith(35);
});
it('does not apply a seek preview from the previous song to a newly selected song', () => {
  const seek = vi.spyOn(player, 'seek').mockImplementation(() => {});
  surface(<Progress />); const slider = screen.getByRole('slider', { name: '播放进度' });
  fireEvent.change(slider, { target: { value: '35' } });
  usePlayer.setState({ currentId: 'second', position: 0 });
  fireEvent.pointerUp(slider); expect(seek).not.toHaveBeenCalled();
});
it('keeps the expanded player focused on lyrics and closes without changing playback', async () => {
  const close = vi.fn();
  surface(<LyricsPlayer onClose={close} addToPlaylist={() => {}} />);
  const dialog = within(screen.getByRole('dialog', { name: '正在播放' }));
  await dialog.findByRole('button', { name: '第一句测试歌词' });
  expect(dialog.queryByRole('tablist')).not.toBeInTheDocument();
  expect(dialog.queryByRole('slider', { name: '音量' })).not.toBeInTheDocument();
  expect(dialog.queryByRole('button', { name: '歌词显示设置' })).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: '收起播放器' }));
  expect(close).toHaveBeenCalledOnce();
  expect(usePlayer.getState().currentId).toBe('first'); expect(usePlayer.getState().position).toBe(11);
});
it('places lyric controls, fullscreen and collapse in the same player header', async () => {
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('button', { name: '第一句测试歌词' });
  const heading = screen.getByRole('button', { name: '收起播放器' }).closest('header')!;
  expect(within(heading).getByRole('button', { name: '歌词来源：本地' })).toBeInTheDocument();
  expect(within(heading).getByRole('button', { name: '歌词设置' })).toBeInTheDocument();
  expect(heading.querySelectorAll('button')).toHaveLength(4);
  expect(within(heading).getByRole('button', { name: '进入全屏' })).toBeInTheDocument();
  fireEvent.click(within(heading).getByRole('button', { name: '歌词来源：本地' }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['本地', '网易云', 'QQ 音乐']);
  expect(within(menu).queryByText(/自动/)).not.toBeInTheDocument();
});
it('edits translation and offset together, retains playback and closes only the settings dialog', async () => {
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('button', { name: '第一句测试歌词' });
  fireEvent.click(screen.getByRole('button', { name: '歌词设置' }));
  const dialog = within(screen.getByRole('dialog', { name: '歌词设置' }));
  expect(dialog.getByRole('heading', { name: '歌词设置' })).toBeInTheDocument();
  expect(dialog.queryByLabelText('歌词显示预览')).not.toBeInTheDocument();
  expect(dialog.getByRole('combobox', { name: '双语格式' })).toHaveTextContent('自动识别');
  const actions = dialog.getByRole('group', { name: '歌词显示操作' });
  expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['重置显示', '刷新歌词']);
  expect(dialog.getByRole('button', { name: '保存' }).parentElement).toBe(actions.parentElement);
  expect(dialog.getByRole('button', { name: '关闭' }).closest('header')?.parentElement).toBe(screen.getByRole('dialog', { name: '歌词设置' }));
  fireEvent.change(dialog.getByRole('spinbutton', { name: '歌词偏移秒数' }), { target: { value: '0.4' } });
  fireEvent.click(dialog.getByRole('checkbox', { name: '显示译文' }));
  fireEvent.click(dialog.getByRole('button', { name: '保存' }));
  expect(screen.queryByRole('dialog', { name: '歌词设置' })).not.toBeInTheDocument();
  expect(useLyricsProfiles.getState().profiles[api.identity].tracks.a.edits?.local).toMatchObject({ delayMs: 400, showTranslation: false });
  expect(usePlayer.getState().position).toBe(11); expect(screen.getByRole('dialog', { name: '正在播放' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '歌词设置' })).toHaveFocus();
});
it('opens version search in the same settings panel and binds a manually selected alternative', async () => {
  vi.spyOn(lyricsApi, 'search').mockResolvedValue({ version: 1, candidates: [{ provider: 'netease', id: '456', title: '另一个版本', artists: ['测试歌手'], durationMs: 90000 }], errors: [] });
  vi.spyOn(lyricsApi, 'lyrics').mockResolvedValue({ version: 1, document: { version: 1, source: 'netease', recordId: '456', tracks: [{ role: 'original', text: '[00:01]网络歌词' }] }, cached: false, stale: false });
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('button', { name: '第一句测试歌词' }); fireEvent.click(screen.getByRole('button', { name: '歌词设置' }));
  const dialog = within(screen.getByRole('dialog', { name: '歌词设置' }));
  fireEvent.click(dialog.getByRole('tab', { name: '版本' }));
  fireEvent.click(await dialog.findByRole('button', { name: /另一个版本/ }));
  await screen.findByRole('button', { name: '网络歌词' });
  expect(useLyricsProfiles.getState().profiles[api.identity].tracks.a.bindings).toEqual({ netease: '456' });
  expect(usePlayer.getState().currentId).toBe('first'); expect(usePlayer.getState().position).toBe(11);
});
it('searches with separate edited title and artist fields only after submitting', async () => {
  vi.spyOn(lyricsApi, 'search').mockResolvedValue({ version: 1, candidates: [], errors: [] });
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('button', { name: '第一句测试歌词' }); fireEvent.click(screen.getByRole('button', { name: '歌词设置' }));
  const dialog = within(screen.getByRole('dialog', { name: '歌词设置' })); fireEvent.click(dialog.getByRole('tab', { name: '版本' }));
  await dialog.findByText('没有找到歌词版本');
  expect(dialog.getByRole('textbox', { name: '歌词歌曲标题' })).toHaveValue('当前曲目');
  expect(dialog.getByRole('textbox', { name: '歌词歌手' })).toHaveValue('测试歌手');
  expect(dialog.queryByRole('button', { name: '刷新歌词' })).not.toBeInTheDocument();
  const fields = dialog.getByRole('textbox', { name: '歌词歌曲标题' }).closest('.lyric-search-fields');
  expect(fields?.nextElementSibling).toContainElement(dialog.getByRole('button', { name: '搜索' }));
  vi.mocked(lyricsApi.search).mockClear();
  fireEvent.change(dialog.getByRole('textbox', { name: '歌词歌曲标题' }), { target: { value: ' 新标题 ' } });
  fireEvent.change(dialog.getByRole('textbox', { name: '歌词歌手' }), { target: { value: '新歌手' } });
  expect(lyricsApi.search).not.toHaveBeenCalled(); fireEvent.click(dialog.getByRole('button', { name: '搜索' }));
  await waitFor(() => expect(lyricsApi.search).toHaveBeenCalledOnce());
  expect(lyricsApi.search).toHaveBeenLastCalledWith(expect.objectContaining({ title: '新标题', artists: ['新歌手'] }), ['netease'], expect.any(AbortSignal), true, '新标题 新歌手');
});
it.each(['歌词内容', '当前歌曲'])('uses the song action menu when right-clicking the expanded %s region', async (label) => {
  const add = vi.fn(); surface(<LyricsPlayer onClose={() => {}} addToPlaylist={add} />);
  await screen.findByRole('button', { name: '第一句测试歌词' }); fireEvent.contextMenu(screen.getByLabelText(label));
  const menu = within(screen.getByRole('menu'));
  expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['查看专辑', '查看歌手', '查看歌单', '添加到歌单']);
  expect(menu.queryByRole('menuitem', { name: '主页' })).not.toBeInTheDocument();
  fireEvent.click(menu.getByRole('menuitem', { name: '添加到歌单' }));
  await waitFor(() => expect(add).toHaveBeenCalledOnce()); expect(usePlayer.getState().position).toBe(11);
});
it('keeps field editing menus inside the nested lyrics settings dialog', async () => {
  vi.spyOn(lyricsApi, 'search').mockResolvedValue({ version: 1, candidates: [], errors: [] });
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('button', { name: '第一句测试歌词' }); fireEvent.click(screen.getByRole('button', { name: '歌词设置' }));
  const dialog = within(screen.getByRole('dialog', { name: '歌词设置' })); fireEvent.click(dialog.getByRole('tab', { name: '版本' }));
  fireEvent.contextMenu(dialog.getByRole('textbox', { name: '歌词歌曲标题' }));
  expect(screen.getByRole('menuitem', { name: '全选' })).toBeInTheDocument(); expect(screen.queryByRole('menuitem', { name: '查看专辑' })).not.toBeInTheDocument();
});
it.each([false, true])('shows the same simple text for empty lyrics and instrumental music (%s)', async (instrumental) => {
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [], instrumental });
  vi.spyOn(lyricsApi, 'search').mockResolvedValue({ version: 1, candidates: [], errors: [] });
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  const empty = await screen.findByRole('heading', { name: '该音乐没有歌词，请欣赏' });
  expect(empty.parentElement?.querySelector('svg')).toBeNull(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not display provider errors as a player failure when no network lyrics can be read', async () => {
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [] });
  vi.spyOn(lyricsApi, 'search').mockRejectedValue(new Error('来源暂不可用'));
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('heading', { name: '该音乐没有歌词，请欣赏' }); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(lyricsApi.search).toHaveBeenCalledTimes(2);
});
it.each([
  ['查看专辑', '/albums/album%20a'],
  ['查看歌手', '/artists/artist%20a'],
  ['查看歌单', '/playlists/playlist%20a'],
])('opens %s from the song menu without interrupting playback', async (label, path) => {
  const close = vi.fn();
  surface(<LyricsPlayer onClose={close} addToPlaylist={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '当前歌曲更多选项' }));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
  await waitFor(() => expect(screen.getByTestId('route-path')).toHaveTextContent(path));
  expect(close).toHaveBeenCalledOnce();
  expect(usePlayer.getState().currentId).toBe('first'); expect(usePlayer.getState().position).toBe(11);
});
it('adds the current song through the existing playlist flow and keeps the player open', async () => {
  const add = vi.fn(); const close = vi.fn();
  surface(<LyricsPlayer onClose={close} addToPlaylist={add} />);
  fireEvent.click(screen.getByRole('button', { name: '当前歌曲更多选项' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '添加到歌单' }));
  await waitFor(() => expect(add).toHaveBeenCalledExactlyOnceWith(usePlayer.getState().entries[0].track));
  expect(close).not.toHaveBeenCalled(); expect(usePlayer.getState().position).toBe(11);
});
it('disables unavailable album and artist destinations and restores focus after dismissing the menu', async () => {
  usePlayer.setState({ entries: [{ entryId: 'first', track: { id: 'a', title: '当前曲目', artist: '测试歌手' } }] });
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('button', { name: '第一句测试歌词' });
  const more = screen.getByRole('button', { name: '当前歌曲更多选项' }); more.focus(); fireEvent.click(more);
  expect(screen.getByRole('menuitem', { name: '查看专辑' })).toBeDisabled();
  expect(screen.getByRole('menuitem', { name: '查看歌手' })).toBeDisabled();
  expect(screen.getByRole('menuitem', { name: '查看歌单' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(more).toHaveFocus();
});
it('uses lyric timestamps for click-to-seek and keeps the source offset separate', async () => {
  const seek = vi.spyOn(player, 'seek').mockImplementation(() => {}); usePreferences.setState({ lyricDelay: 500 });
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: '第二句测试歌词' })); expect(seek).toHaveBeenCalledWith(10.5);
  usePreferences.setState({ lyricDelay: 0 });
});
it('centers lyrics using viewport geometry and resumes sync after manual scrolling is idle', async () => {
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />); const line = await screen.findByRole('button', { name: '第二句测试歌词' });
  const viewport = screen.getByLabelText('歌词内容'); Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 300 }); viewport.scrollTop = 50;
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 300 } as DOMRect); vi.spyOn(line, 'getBoundingClientRect').mockReturnValue({ top: 500, height: 40 } as DOMRect);
  vi.useFakeTimers(); fireEvent.wheel(viewport); expect(screen.getByRole('button', { name: '同步' })).toHaveAttribute('aria-pressed', 'false');
  act(() => vi.advanceTimersByTime(5000)); expect(screen.queryByRole('button', { name: '同步' })).not.toBeInTheDocument();
  expect(viewport.scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'instant' });
});
it('remeasures the reading anchor and first/last line space when the lyric viewport resizes', async () => {
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  try {
    surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
    const line = await screen.findByRole('button', { name: '第二句测试歌词' });
    const viewport = screen.getByLabelText('歌词内容');
    viewport.style.setProperty('--lyric-anchor', '.42'); viewport.scrollTop = 200;
    let height = 0; let lineHeight = 0;
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => height });
    vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => ({ top: 120, height }) as DOMRect);
    vi.spyOn(line, 'getBoundingClientRect').mockImplementation(() => ({ top: 800, height: lineHeight }) as DOMRect);
    vi.useFakeTimers();
    for (const [nextHeight, nextLineHeight] of [[690, 96], [920, 144], [1160, 200]]) {
      height = nextHeight; lineHeight = nextLineHeight;
      act(() => { resize(); vi.advanceTimersByTime(32); });
      const top = vi.mocked(viewport.scrollTo).mock.lastCall?.[0] as ScrollToOptions;
      const resultingLineCenter = 800 + lineHeight / 2 - (top.top! - viewport.scrollTop);
      expect(resultingLineCenter).toBeCloseTo(120 + height * .42);
      // Both ends need enough space for a short first/last line to reach this anchor.
      expect(Number.parseFloat(viewport.style.getPropertyValue('--lyric-before'))).toBeCloseTo(height * .42);
      expect(Number.parseFloat(viewport.style.getPropertyValue('--lyric-after'))).toBeCloseTo(height * .58);
    }
    expect(usePlayer.getState().position).toBe(11);
  } finally { vi.unstubAllGlobals(); }
});
it('restores the previous volume after unmuting', async () => {
  const volume = vi.spyOn(player, 'volume').mockImplementation((value) => usePlayer.setState({ volume: value }));
  surface(<PlayerBar openQueue={() => {}} openLyrics={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '静音' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消静音' }));
  expect(volume.mock.calls.map(([value]) => value)).toEqual([0, 0.65]);
  await waitFor(() => expect(screen.getByRole('slider', { name: '音量' })).toHaveValue('0.65'));
});
it('honors reduced motion and closes using the latest callback', () => {
  const first = vi.fn(); const latest = vi.fn();
  const view = render(<Modal title="测试面板" onClose={first}><p>内容</p></Modal>);
  view.rerender(<Modal title="测试面板" onClose={latest}><p>内容</p></Modal>);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
});
it('retains the dialog for its exit animation before closing', () => {
  document.documentElement.dataset.motion = 'full'; vi.useFakeTimers(); const close = vi.fn();
  render(<Modal title="测试面板" onClose={close}><p>内容</p></Modal>);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.getByRole('dialog')).toHaveClass('is-closing'); expect(close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(190); expect(close).toHaveBeenCalledOnce();
});
