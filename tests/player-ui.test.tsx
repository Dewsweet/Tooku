import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicApi } from '../src/api/client';
import { useSession } from '../src/state/session';
import { usePreferences } from '../src/state/preferences';
import { player, usePlayer } from '../src/features/player/engine';
import { LyricsPlayer, PlayerBar, Progress } from '../src/features/player/PlayerUI';
import { Modal } from '../src/components/Modal';

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
    { entryId: 'first', track: { id: 'a', title: '当前曲目', artist: '测试歌手', duration: 90 } },
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
const surface = (child: React.ReactNode) => render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);

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
it('switches lyrics and queue without changing the current song or playback position', async () => {
  surface(<LyricsPlayer onClose={() => {}} />);
  const dialog = within(screen.getByRole('dialog', { name: '正在播放' }));
  await dialog.findByRole('button', { name: '第一句测试歌词' });
  fireEvent.click(dialog.getByRole('tab', { name: /队列\s*2/ }));
  expect(dialog.getByRole('button', { name: '播放队列第 2 首：接下来的歌' })).toBeInTheDocument();
  expect(usePlayer.getState().currentId).toBe('first'); expect(usePlayer.getState().position).toBe(11);
  fireEvent.click(dialog.getByRole('tab', { name: '歌词' }));
  expect(await dialog.findByRole('button', { name: '第二句测试歌词' })).toHaveAttribute('aria-current', 'true');
});
it('uses lyric timestamps for click-to-seek and keeps the source offset separate', async () => {
  const seek = vi.spyOn(player, 'seek').mockImplementation(() => {}); usePreferences.setState({ lyricDelay: 500 });
  surface(<LyricsPlayer onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: '第二句测试歌词' })); expect(seek).toHaveBeenCalledWith(10.5);
  usePreferences.setState({ lyricDelay: 0 });
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
