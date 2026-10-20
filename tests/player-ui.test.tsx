import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MusicApi } from '../src/api/client';
import { useSession } from '../src/state/session';
import { usePreferences } from '../src/state/preferences';
import { player, usePlayer } from '../src/features/player/engine';
import { LyricsPlayer, PlayerBar, Progress } from '../src/features/player/PlayerUI';
import { Modal } from '../src/components/Modal';
import { Interactions } from '../src/components/Interactions';

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
  document.documentElement.dataset.motion = 'reduced';
  usePlayer.setState({ ...usePlayer.getInitialState(), status: 'paused', position: 11, duration: 90, volume: 0.65, currentId: 'first', entries: [
    { entryId: 'first', track: { id: 'a', title: '当前曲目', artist: '测试歌手', albumId: 'album a', artistId: 'artist a', duration: 90 } },
    { entryId: 'second', track: { id: 'b', title: '接下来的歌', artist: '另一位歌手', duration: 120 } },
  ] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null); usePlayer.setState(usePlayer.getInitialState()); usePreferences.setState({ reducedMotion: false });
  delete document.documentElement.dataset.motion;
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  vi.useRealTimers(); vi.restoreAllMocks();
});
function RouteMarker() { const location = useLocation(); return <output data-testid="route-path">{location.pathname}</output>; }
const surface = (child: React.ReactNode) => render(<QueryClientProvider client={client}><MemoryRouter><Interactions>{child}<RouteMarker /></Interactions></MemoryRouter></QueryClientProvider>);

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
it.each([
  ['查看专辑', '/albums/album%20a'],
  ['查看歌手', '/artists/artist%20a'],
  ['查看歌单', '/playlists'],
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
