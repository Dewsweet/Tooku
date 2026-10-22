import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { Interactions } from '../src/components/Interactions';
import { LyricsPlayer } from '../src/features/player/PlayerUI';
import { player, usePlayer } from '../src/features/player/engine';
import { usePreferences } from '../src/state/preferences';
import { useLyricsProfiles } from '../src/state/lyrics';
import { useSession } from '../src/state/session';

let api: MusicApi; let client: QueryClient; let mobile = true;
const listeners = new Set<() => void>();
beforeEach(() => {
  mobile = true; listeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({ get matches() { return query.includes('max-width') && mobile; }, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'favorites').mockResolvedValue({ songs: [], albums: [], artists: [] });
  vi.spyOn(api, 'lyrics').mockResolvedValue({ synced: true, offsetMs: 0, lines: [{ startMs: 0, text: '第一句测试歌词' }, { startMs: 10000, text: '第二句测试歌词' }] });
  useSession.getState().setSession(api); useLyricsProfiles.setState({ profiles: {}, refreshes: {} });
  usePreferences.setState({ reducedMotion: true }); document.documentElement.dataset.motion = 'reduced';
  usePlayer.setState({ ...usePlayer.getInitialState(), status: 'playing', position: 11, duration: 90, currentId: 'entry', entries: [{ entryId: 'entry', track: { id: 'a', title: '测试歌曲', artist: '测试歌手', artistId: 'artist', albumId: 'album' } }] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null); usePlayer.setState(usePlayer.getInitialState());
  usePreferences.setState(usePreferences.getInitialState()); useLyricsProfiles.setState({ profiles: {}, refreshes: {} });
  delete document.documentElement.dataset.motion;
  for (const [prototype, property] of [[HTMLDialogElement.prototype, 'showModal'], [HTMLDialogElement.prototype, 'close'], [HTMLElement.prototype, 'scrollTo']] as const) Reflect.deleteProperty(prototype, property);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
async function setup(close = vi.fn()) {
  render(<QueryClientProvider client={client}><MemoryRouter><Interactions><LyricsPlayer onClose={close} addToPlaylist={() => {}} /></Interactions></MemoryRouter></QueryClientProvider>);
  await screen.findByText('第一句测试歌词');
  const dialog = screen.getByRole('dialog', { name: '正在播放' });
  const body = dialog.querySelector<HTMLElement>('.room-body')!;
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 390 });
  return { close, dialog, body, cover: dialog.querySelector<HTMLElement>('.room-artwork-slot')! };
}
function pointer(target: Element, type: string, y: number, x = 100, extras = {}) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerType: 'touch', pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y, ...extras }); fireEvent(target, event);
}
function swipe(target: Element, start: number, end: number) { pointer(target, 'pointerdown', start); pointer(target, 'pointermove', end); pointer(target, 'pointerup', end); }
function drag(target: Element, start: number, end: number) {
  pointer(target, 'pointerdown', 200, start, { pointerType: 'mouse' });
  pointer(target, 'pointermove', 200, end, { pointerType: 'mouse' });
  pointer(target, 'pointerup', 200, end, { pointerType: 'mouse' });
}
function nativeScroll(body: HTMLElement, left: number) {
  body.scrollLeft = left; fireEvent.scroll(body); act(() => vi.advanceTimersByTime(60));
}
function touch(target: Element, type: 'touchStart' | 'touchEnd' | 'touchCancel', x: number, y = 300) {
  const point = { identifier: 1, clientX: x, clientY: y };
  fireEvent[type](target, { touches: type === 'touchStart' ? [point] : [], changedTouches: [point] });
}

it('settles native horizontal scrolling on the same lyrics reader without changing playback', async () => {
  const { body, cover, close } = await setup(); const reader = body.querySelector<HTMLElement>('.room-lyrics-lines')!;
  reader.scrollTop = 123;
  const attach = vi.spyOn(player, 'attach'); const select = vi.spyOn(player, 'select'); const seek = vi.spyOn(player, 'seek');
  expect(body).toHaveAttribute('data-mobile-page', 'controls');
  expect(body.querySelector('.room-content')).toHaveAttribute('inert');
  vi.useFakeTimers();
  pointer(cover, 'pointerdown', 300, 300); pointer(cover, 'pointermove', 300, 80);
  expect(body).not.toHaveAttribute('data-dragging');
  pointer(cover, 'pointercancel', 300, 80);
  body.scrollLeft = 390; fireEvent.scroll(body);
  act(() => vi.advanceTimersByTime(59)); expect(body).toHaveAttribute('data-mobile-page', 'controls');
  act(() => vi.advanceTimersByTime(1));
  expect(body).toHaveAttribute('data-mobile-page', 'lyrics'); expect(body.querySelector('.room-record')).toHaveAttribute('inert');
  expect(body.querySelector('.room-lyrics-lines')).toBe(reader); expect(reader.scrollTop).toBe(123);
  expect(screen.getByRole('region', { name: '歌词' })).toHaveFocus();
  // Scrolling the reader vertically must not flip the horizontal pager back.
  fireEvent.scroll(reader); act(() => vi.advanceTimersByTime(120));
  expect(body).toHaveAttribute('data-mobile-page', 'lyrics');
  expect(usePlayer.getState()).toMatchObject({ currentId: 'entry', position: 11, status: 'playing' });
  expect(close).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled(); expect(seek).not.toHaveBeenCalled();
  nativeScroll(body, 0); expect(body).toHaveAttribute('data-mobile-page', 'controls');
});
it('supports mouse swipes in both directions, suppressing the click generated after a drag', async () => {
  const { body, cover } = await setup(); const seek = vi.spyOn(player, 'seek');
  drag(cover, 300, 80); expect(body).toHaveAttribute('data-mobile-page', 'lyrics');
  expect(body.scrollTo).toHaveBeenCalledWith({ left: 390, behavior: 'instant' });
  const line = screen.getByRole('button', { name: '第一句测试歌词' });
  fireEvent.click(line, { detail: 1 }); expect(seek).not.toHaveBeenCalled();
  body.scrollLeft = 390;
  drag(line, 80, 300); expect(body).toHaveAttribute('data-mobile-page', 'controls');
  expect(body.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'instant' });
  expect(usePlayer.getState().position).toBe(11);
});
it('offers keyboard paging without a lyrics return button or bottom hint', async () => {
  const { body } = await setup();
  expect(screen.queryByRole('button', { name: '歌词' })).not.toBeInTheDocument();
  expect(body.querySelector('.mobile-player-lyrics-link')).toBeNull();
  expect(screen.queryByRole('button', { name: '返回播放控制', hidden: true })).not.toBeInTheDocument();
  fireEvent.keyDown(body, { key: 'ArrowRight' }); expect(body).toHaveAttribute('data-mobile-page', 'lyrics');
  fireEvent.keyDown(body, { key: 'ArrowLeft' }); expect(body).toHaveAttribute('data-mobile-page', 'controls');
  fireEvent.keyDown(body, { key: 'ArrowRight' });
  fireEvent.keyDown(body, { key: 'ArrowLeft' });
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(screen.getByRole('region', { name: '当前歌曲' })).toHaveFocus();
});
it('finishes native swipes in either direction and leaves vertical lyric scrolling alone', async () => {
  const { body, cover, close } = await setup();
  touch(cover, 'touchStart', 300); expect(body).toHaveAttribute('data-paging', 'true');
  body.scrollLeft = 160;
  touch(cover, 'touchEnd', 80); expect(body).toHaveAttribute('data-mobile-page', 'lyrics');
  expect(body.scrollTo).toHaveBeenLastCalledWith({ left: 390, behavior: 'instant' });
  const line = screen.getByRole('button', { name: '第一句测试歌词' });
  body.scrollLeft = 390;
  touch(line, 'touchStart', 80); touch(line, 'touchEnd', 300);
  expect(body).toHaveAttribute('data-mobile-page', 'controls');
  fireEvent.keyDown(body, { key: 'ArrowRight' }); body.scrollLeft = 390;
  touch(line, 'touchStart', 100, 400); touch(line, 'touchEnd', 100, 200);
  expect(body).toHaveAttribute('data-mobile-page', 'lyrics'); expect(body).not.toHaveAttribute('data-paging');
  expect(close).not.toHaveBeenCalled(); expect(usePlayer.getState().position).toBe(11);
});
it('completes a release in 160ms and cancels an unfinished animation on viewport changes', async () => {
  const { body, cover } = await setup();
  act(() => { usePlayer.setState({ status: 'paused' }); usePreferences.setState({ reducedMotion: false }); });
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.set(++id, callback); return id; });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((key) => { callbacks.delete(key); });
  vi.spyOn(performance, 'now').mockReturnValue(100);
  touch(cover, 'touchStart', 300); body.scrollLeft = 100; touch(cover, 'touchEnd', 80);
  expect(body).toHaveAttribute('data-paging', 'true');
  const step = (now: number) => { const pending = [...callbacks.values()]; callbacks.clear(); act(() => pending.forEach((callback) => callback(now))); };
  step(180); expect(body.scrollTo).toHaveBeenLastCalledWith({ left: 317.5, behavior: 'instant' });
  step(260); expect(body.scrollTo).toHaveBeenLastCalledWith({ left: 390, behavior: 'instant' });
  expect(body).not.toHaveAttribute('data-paging'); expect(callbacks.size).toBe(0);
  body.scrollLeft = 390; fireEvent.keyDown(body, { key: 'ArrowLeft' });
  expect(body).toHaveAttribute('data-paging', 'true'); fireEvent.resize(window);
  expect(cancel).toHaveBeenCalled(); expect(callbacks.size).toBe(0); expect(body).not.toHaveAttribute('data-paging');
  expect(body.scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'instant' });
});
it('returns short or cancelled touches to their page and abandons gestures when a second finger arrives', async () => {
  const { body, cover, close } = await setup();
  touch(cover, 'touchStart', 200); body.scrollLeft = 20; touch(cover, 'touchEnd', 180);
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(body).not.toHaveAttribute('data-paging');
  touch(cover, 'touchStart', 300); body.scrollLeft = 140; touch(cover, 'touchCancel', 160);
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(body).not.toHaveAttribute('data-paging');
  body.scrollLeft = 0;
  touch(cover, 'touchStart', 300);
  pointer(cover, 'pointerdown', 200); pointer(cover, 'pointermove', 230);
  expect(body).toHaveAttribute('data-dragging', 'true');
  fireEvent.touchStart(cover, { touches: [{ identifier: 1 }, { identifier: 2 }] });
  pointer(cover, 'pointerup', 400); touch(cover, 'touchEnd', 80);
  expect(body).not.toHaveAttribute('data-paging'); expect(body).not.toHaveAttribute('data-dragging');
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(close).not.toHaveBeenCalled();
});
it('closes a downward controls swipe through the Modal animation instead of a separate dismissal path', async () => {
  const { cover, dialog, close } = await setup();
  vi.useFakeTimers(); usePreferences.setState({ reducedMotion: false }); document.documentElement.dataset.motion = 'full';
  swipe(cover, 200, 360);
  expect(dialog).toHaveClass('is-closing'); expect(close).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(190)); expect(close).toHaveBeenCalledOnce();
  expect(usePlayer.getState().position).toBe(11);
});
it('returns to the underlying page and restores the dock trigger focus after swiping down', async () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return <><h1>主界面</h1><button onClick={() => setOpen(true)}>展开播放器</button>{open && <LyricsPlayer onClose={() => setOpen(false)} addToPlaylist={() => {}} />}</>;
  }
  render(<QueryClientProvider client={client}><MemoryRouter><Interactions><Host /></Interactions></MemoryRouter></QueryClientProvider>);
  const trigger = screen.getByRole('button', { name: '展开播放器' }); trigger.focus(); fireEvent.click(trigger);
  await screen.findByText('第一句测试歌词');
  swipe(screen.getByRole('dialog').querySelector('.room-artwork-slot')!, 200, 360);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus(); expect(screen.getByRole('heading', { name: '主界面' })).toBeInTheDocument();
  expect(usePlayer.getState()).toMatchObject({ currentId: 'entry', position: 11, status: 'playing' });
});
it('supports downward mouse dragging on cover-page blank space', async () => {
  const { body, close } = await setup(); const record = body.querySelector('.room-record')!;
  pointer(record, 'pointerdown', 200, 100, { pointerType: 'mouse' });
  pointer(record, 'pointermove', 300, 102, { pointerType: 'mouse' });
  pointer(record, 'pointerup', 300, 102, { pointerType: 'mouse' });
  expect(close).toHaveBeenCalledOnce();
});
it('does not capture lyrics scrolling, seeking, buttons or horizontal metadata gestures', async () => {
  const { body, close } = await setup();
  const progress = screen.getByRole('slider', { name: '播放进度' });
  for (const target of [progress, screen.getByRole('button', { name: '暂停' }), body.querySelector('.scrolling-text')!]) {
    swipe(target, 500, 200); drag(target, 300, 80);
  }
  fireEvent.keyDown(progress, { key: 'ArrowRight' });
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(body, { key: 'ArrowRight' });
  swipe(body.querySelector('.room-lyrics-lines')!, 100, 500);
  const line = screen.getByRole('button', { name: '第一句测试歌词' });
  pointer(line, 'pointerdown', 200, 100, { pointerType: 'mouse' });
  pointer(line, 'pointermove', 350, 100, { pointerType: 'mouse' });
  pointer(line, 'pointerup', 350, 100, { pointerType: 'mouse' });
  expect(body).toHaveAttribute('data-mobile-page', 'lyrics'); expect(close).not.toHaveBeenCalled();
});
it('snaps back on small drags, cancellation, capture loss and viewport changes', async () => {
  const { body, cover, close } = await setup();
  swipe(cover, 200, 230);
  drag(cover, 200, 180);
  body.scrollLeft = 0;
  for (const interrupt of [() => pointer(cover, 'pointercancel', 400), () => fireEvent.lostPointerCapture(body), () => fireEvent.resize(window), () => fireEvent.blur(window)]) {
    pointer(cover, 'pointerdown', 200); pointer(cover, 'pointermove', 400); interrupt(); pointer(cover, 'pointerup', 400);
    expect(body).not.toHaveAttribute('data-dragging'); expect(body.closest('dialog')?.style.getPropertyValue('--player-dismiss-y')).toBe('');
  }
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(body, { key: 'ArrowRight' });
  expect(body).toHaveAttribute('data-mobile-page', 'lyrics');
});
it('preserves the reader when resizing back to desktop and ignores swipes in nested settings', async () => {
  const { body, cover, close } = await setup(); const reader = body.querySelector('.room-lyrics-lines');
  pointer(cover, 'pointerdown', 200); pointer(cover, 'pointermove', 400);
  act(() => { mobile = false; listeners.forEach((listener) => listener()); });
  pointer(cover, 'pointerup', 400);
  expect(body).not.toHaveAttribute('data-dragging'); expect(close).not.toHaveBeenCalled();
  act(() => { mobile = true; listeners.forEach((listener) => listener()); });
  fireEvent.click(screen.getByRole('button', { name: '歌词设置' }));
  const settingsHeader = screen.getByRole('dialog', { name: '歌词设置' }).querySelector('header')!;
  swipe(settingsHeader, 100, 400); drag(settingsHeader, 300, 80);
  fireEvent.keyDown(settingsHeader, { key: 'ArrowRight' });
  expect(body).toHaveAttribute('data-mobile-page', 'controls');
  expect(close).not.toHaveBeenCalled();
  act(() => { mobile = false; listeners.forEach((listener) => listener()); });
  expect(body).not.toHaveAttribute('data-mobile-page'); expect(body.querySelector('.room-content')).not.toHaveAttribute('inert');
  expect(body.querySelector('.room-lyrics-lines')).toBe(reader); expect(screen.queryByRole('button', { name: '返回播放控制' })).not.toBeInTheDocument();
  expect(usePlayer.getState().position).toBe(11);
});
