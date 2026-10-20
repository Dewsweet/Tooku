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
it('places three distinct lyric/source/collapse controls in the same player header', async () => {
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('button', { name: '第一句测试歌词' });
  const heading = screen.getByRole('button', { name: '收起播放器' }).closest('header')!;
  expect(within(heading).getByRole('button', { name: '歌词来源：本地' })).toBeInTheDocument();
  expect(within(heading).getByRole('button', { name: '歌词设置' })).toBeInTheDocument();
  expect(heading.querySelectorAll('button')).toHaveLength(3);
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
it.each([false, true])('shows the same simple text for empty lyrics and instrumental music (%s)', async (instrumental) => {
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [], instrumental });
  vi.spyOn(lyricsApi, 'search').mockResolvedValue({ version: 1, candidates: [], errors: [] });
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  const empty = await screen.findByRole('heading', { name: '该音乐没有歌词' });
  expect(empty.parentElement?.querySelector('svg')).toBeNull(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not display provider errors as a player failure when no network lyrics can be read', async () => {
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [] });
  vi.spyOn(lyricsApi, 'search').mockRejectedValue(new Error('来源暂不可用'));
  surface(<LyricsPlayer onClose={() => {}} addToPlaylist={() => {}} />);
  await screen.findByRole('heading', { name: '该音乐没有歌词' }); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
