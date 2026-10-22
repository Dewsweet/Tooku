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

let api: MusicApi; let client: QueryClient; let mobile = true; let clock = 1000;
const listeners = new Set<() => void>();
beforeEach(() => {
  mobile = true; clock = 1000; listeners.clear();
  vi.stubGlobal('innerWidth', 390);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
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
  const dialog = screen.getByRole('dialog', { name: '正在播放' }); const body = dialog.querySelector<HTMLElement>('.room-body')!;
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 390 });
  return { close, dialog, body, cover: dialog.querySelector<HTMLElement>('.room-artwork-slot')! };
}
function pointer(target: Element, type: string, x: number, y = 200) {
  clock += 100;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y }); fireEvent(target, event); return event;
}
function touch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', x: number, y = 300, elapsed = 100) {
  clock += elapsed;
  const point = { identifier: 1, clientX: x, clientY: y }; const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches: type === 'touchstart' || type === 'touchmove' ? [point] : [], changedTouches: [point] }); fireEvent(target, event); return event;
}
function swipe(target: Element, from: number, to: number, elapsed = 100) { touch(target, 'touchstart', from); touch(target, 'touchmove', to, 300, elapsed); touch(target, 'touchend', to, 300, 10); }
const offset = (body: HTMLElement) => -Number.parseFloat(body.style.getPropertyValue('--player-page-x')) || 0;

it('moves a single track without native horizontal scroll, retaining the lyrics reader and playback', async () => {
  const { body, cover, close } = await setup(); const reader = body.querySelector<HTMLElement>('.room-lyrics-lines')!;
  reader.scrollTop = 123; const scroll = vi.spyOn(body, 'scrollTo');
  const attach = vi.spyOn(player, 'attach'); const select = vi.spyOn(player, 'select'); const seek = vi.spyOn(player, 'seek');
  touch(cover, 'touchstart', 300); const moved = touch(cover, 'touchmove', 120);
  expect(moved.defaultPrevented).toBe(true); expect(offset(body)).toBe(180);
  touch(cover, 'touchend', 120, 300, 10);
  expect(offset(body)).toBe(390); expect(body).toHaveAttribute('data-mobile-page', 'lyrics');
  expect(body.querySelector('.room-record')).toHaveAttribute('inert'); expect(screen.getByRole('region', { name: '歌词' })).toHaveFocus();
  expect(body.querySelector('.room-lyrics-lines')).toBe(reader); expect(reader.scrollTop).toBe(123);
  expect(scroll.mock.contexts).not.toContain(body); expect(close).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled(); expect(seek).not.toHaveBeenCalled();
  expect(usePlayer.getState()).toMatchObject({ currentId: 'entry', position: 11, status: 'playing' });
  swipe(reader, 100, 300); expect(offset(body)).toBe(0); expect(body).toHaveAttribute('data-mobile-page', 'controls');
});
it.each([12, 378])('handles repeated short edge motions and inward swipes from x=%s without overshoot', async (x) => {
  const { body, cover } = await setup();
  for (let i = 0; i < 4; i++) {
    touch(cover, 'touchstart', x); touch(cover, 'touchmove', x + 15); expect(offset(body)).toBe(0);
    touch(cover, 'touchmove', x + 5); touch(cover, 'touchend', x + 5); expect(offset(body)).toBe(0);
  }
  swipe(cover, x, x - 60); expect(offset(body)).toBe(390);
  const reader = body.querySelector('.room-lyrics-lines')!;
  for (let i = 0; i < 4; i++) { swipe(reader, x, x - 20); expect(offset(body)).toBe(390); }
  swipe(reader, x, x + 60); expect(offset(body)).toBe(0);
});
it('supports a short deliberate flick at either edge and returns a slow short drag to its origin', async () => {
  const { body, cover } = await setup();
  swipe(cover, 378, 358, 120); expect(offset(body)).toBe(0);
  swipe(cover, 12, -8, 20); expect(offset(body)).toBe(390);
  swipe(body.querySelector('.room-lyrics-lines')!, 378, 398, 20); expect(offset(body)).toBe(0);
});
it('never rewrites horizontal scroll and remains fixed after the 160ms release, focus and resize events', async () => {
  const { body, cover } = await setup();
  act(() => { usePlayer.setState({ status: 'paused' }); usePreferences.setState({ reducedMotion: false }); });
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callbacks.set(++id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((key) => { callbacks.delete(key); });
  const scroll = vi.spyOn(body, 'scrollTo');
  touch(cover, 'touchstart', 300); touch(cover, 'touchmove', 200); touch(cover, 'touchend', 200, 300, 10);
  const began = clock; const values = [offset(body)];
  for (let ms = 16; ms <= 160; ms += 16) {
    clock = began + ms; const pending = [...callbacks.values()]; callbacks.clear(); act(() => pending.forEach((callback) => callback(clock))); values.push(offset(body));
  }
  expect(values.every((value, i) => value >= 0 && value <= 390 && (!i || value >= values[i - 1]))).toBe(true);
  expect(offset(body)).toBe(390); expect(body).toHaveAttribute('data-mobile-page', 'lyrics'); expect(callbacks.size).toBe(0);
  for (let i = 0; i < 20; i++) { body.scrollLeft = i * 4; fireEvent.scroll(body); fireEvent.resize(window); expect(offset(body)).toBe(390); }
  expect(callbacks.size).toBe(0); expect(scroll.mock.contexts).not.toContain(body); expect(body).not.toHaveAttribute('data-paging');
  // Reversing while settling starts from the actual visible transform, not the previous page.
  const reader = body.querySelector('.room-lyrics-lines')!;
  touch(reader, 'touchstart', 100); touch(reader, 'touchmove', 200); touch(reader, 'touchend', 200, 300, 10);
  clock += 80; const pending = [...callbacks.values()]; callbacks.clear(); act(() => pending.forEach((callback) => callback(clock)));
  const visible = offset(body); touch(reader, 'touchstart', 200); expect(offset(body)).toBe(visible);
  touch(reader, 'touchmove', 180); expect(offset(body)).toBe(visible + 20);
});
it('leaves vertical lyrics, seeking, buttons and metadata gestures native', async () => {
  const { body, close } = await setup();
  for (const element of [screen.getByRole('slider', { name: '播放进度' }), screen.getByRole('button', { name: '暂停' }), body.querySelector('.scrolling-text')!]) {
    touch(element, 'touchstart', 300); expect(touch(element, 'touchmove', 100).defaultPrevented).toBe(false); touch(element, 'touchend', 100); expect(offset(body)).toBe(0);
  }
  fireEvent.keyDown(body, { key: 'ArrowRight' }); const reader = body.querySelector('.room-lyrics-lines')!;
  touch(reader, 'touchstart', 100, 400); expect(touch(reader, 'touchmove', 103, 220).defaultPrevented).toBe(false); touch(reader, 'touchend', 103, 220);
  expect(offset(body)).toBe(390); expect(close).not.toHaveBeenCalled();
});
it('supports mouse dragging and keyboard navigation without adding page hints', async () => {
  const { body, cover } = await setup(); const seek = vi.spyOn(player, 'seek');
  pointer(cover, 'pointerdown', 300); pointer(cover, 'pointermove', 100); pointer(cover, 'pointerup', 100);
  expect(offset(body)).toBe(390); fireEvent.click(screen.getByRole('button', { name: '第一句测试歌词' }), { detail: 1 }); expect(seek).not.toHaveBeenCalled();
  fireEvent.keyDown(body, { key: 'ArrowLeft' }); expect(offset(body)).toBe(0); expect(screen.getByRole('region', { name: '当前歌曲' })).toHaveFocus();
  expect(screen.queryByRole('button', { name: '歌词' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '返回播放控制', hidden: true })).not.toBeInTheDocument();
  const toggle = vi.spyOn(player, 'toggle').mockImplementation(() => {}); const pause = screen.getByRole('button', { name: '暂停' });
  touch(pause, 'touchstart', 100); touch(pause, 'touchend', 100); fireEvent.click(pause, { detail: 1 }); expect(toggle).toHaveBeenCalledOnce();
});
it('handles cancellation, a second finger, capture loss and a real width change', async () => {
  const { body, cover } = await setup();
  touch(cover, 'touchstart', 300); touch(cover, 'touchmove', 100); touch(cover, 'touchcancel', 100); expect(offset(body)).toBe(0);
  touch(cover, 'touchstart', 300); touch(cover, 'touchmove', 150);
  fireEvent.touchStart(cover, { touches: [{ identifier: 1 }, { identifier: 2 }] }); expect(offset(body)).toBe(0);
  pointer(cover, 'pointerdown', 300); pointer(cover, 'pointermove', 150); fireEvent.lostPointerCapture(body); expect(offset(body)).toBe(0);
  fireEvent.keyDown(body, { key: 'ArrowRight' }); Object.defineProperty(body, 'clientWidth', { configurable: true, value: 320 }); fireEvent.resize(window);
  expect(offset(body)).toBe(320); expect(body).toHaveAttribute('data-mobile-page', 'lyrics'); expect(body).not.toHaveAttribute('data-dragging');
});
it('retains the reader across desktop breakpoints and ignores the nested settings dialog', async () => {
  const { body, cover } = await setup(); const reader = body.querySelector('.room-lyrics-lines');
  pointer(cover, 'pointerdown', 300); pointer(cover, 'pointermove', 200);
  act(() => { mobile = false; listeners.forEach((listener) => listener()); }); pointer(cover, 'pointerup', 200);
  expect(body).not.toHaveAttribute('data-mobile-page'); expect(body.style.getPropertyValue('--player-page-x')).toBe(''); expect(body.querySelector('.room-content')).not.toHaveAttribute('inert');
  act(() => { mobile = true; listeners.forEach((listener) => listener()); });
  fireEvent.click(screen.getByRole('button', { name: '歌词设置' })); const header = screen.getByRole('dialog', { name: '歌词设置' }).querySelector('header')!;
  swipe(header, 300, 100); fireEvent.keyDown(header, { key: 'ArrowRight' }); expect(offset(body)).toBe(0);
  expect(body.querySelector('.room-lyrics-lines')).toBe(reader); expect(usePlayer.getState().position).toBe(11);
});
it('keeps collapse-button animation and focus restoration while ignoring downward cover gestures', async () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return <><h1>主界面</h1><button onClick={() => setOpen(true)}>展开播放器</button>{open && <LyricsPlayer onClose={() => setOpen(false)} addToPlaylist={() => {}} />}</>;
  }
  render(<QueryClientProvider client={client}><MemoryRouter><Interactions><Host /></Interactions></MemoryRouter></QueryClientProvider>);
  const trigger = screen.getByRole('button', { name: '展开播放器' }); trigger.focus(); fireEvent.click(trigger); await screen.findByText('第一句测试歌词');
  const dialog = screen.getByRole('dialog'); const cover = dialog.querySelector('.room-artwork-slot')!;
  touch(cover, 'touchstart', 100, 100); touch(cover, 'touchmove', 100, 350); touch(cover, 'touchend', 100, 350);
  expect(dialog).toBeInTheDocument();
  vi.useFakeTimers(); act(() => usePreferences.setState({ reducedMotion: false })); document.documentElement.dataset.motion = 'full';
  fireEvent.click(screen.getByRole('button', { name: '收起播放器' })); expect(dialog).toHaveClass('is-closing');
  act(() => vi.advanceTimersByTime(190)); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus(); expect(usePlayer.getState().position).toBe(11);
});
