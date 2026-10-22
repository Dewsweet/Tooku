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
  return { close, dialog, body: dialog.querySelector<HTMLElement>('.room-body')!, cover: dialog.querySelector<HTMLElement>('.room-artwork-slot')! };
}
function pointer(target: Element, type: string, y: number, x = 100, extras = {}) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerType: 'touch', pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y, ...extras }); fireEvent(target, event);
}
function swipe(target: Element, start: number, end: number) { pointer(target, 'pointerdown', start); pointer(target, 'pointermove', end); pointer(target, 'pointerup', end); }

it('starts on full controls and slides to the same mounted lyrics reader without changing playback', async () => {
  const { body, cover, close } = await setup(); const reader = body.querySelector<HTMLElement>('.room-lyrics-lines')!;
  reader.scrollTop = 123;
  const attach = vi.spyOn(player, 'attach'); const select = vi.spyOn(player, 'select'); const seek = vi.spyOn(player, 'seek');
  expect(body).toHaveAttribute('data-mobile-page', 'controls');
  expect(body.querySelector('.room-content')).toHaveAttribute('inert');
  pointer(cover, 'pointerdown', 500); pointer(cover, 'pointermove', 350);
  expect(body.style.getPropertyValue('--player-page-drag')).toBe('-150px');
  pointer(cover, 'pointerup', 350);
  expect(body).toHaveAttribute('data-mobile-page', 'lyrics'); expect(body.querySelector('.room-record')).toHaveAttribute('inert');
  expect(body.querySelector('.room-lyrics-lines')).toBe(reader); expect(reader.scrollTop).toBe(123);
  expect(screen.getByRole('region', { name: '歌词' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '第一句测试歌词' }), { detail: 1 });
  expect(usePlayer.getState()).toMatchObject({ currentId: 'entry', position: 11, status: 'playing' });
  expect(close).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled(); expect(seek).not.toHaveBeenCalled();
});
it('provides keyboard-operable page buttons and returns from the lyric header by dragging down', async () => {
  const { body } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '歌词' }));
  const zone = body.querySelector('.mobile-player-return-zone')!;
  swipe(zone, 300, 150); expect(body).toHaveAttribute('data-mobile-page', 'lyrics');
  swipe(zone, 150, 300); expect(body).toHaveAttribute('data-mobile-page', 'controls');
  fireEvent.click(screen.getByRole('button', { name: '歌词' }));
  fireEvent.click(screen.getByRole('button', { name: '返回播放控制' }));
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(screen.getByRole('region', { name: '当前歌曲' })).toHaveFocus();
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
it('ignores lyrics scrolling, seeking, buttons and horizontal metadata gestures', async () => {
  const { body, close } = await setup();
  for (const target of [screen.getByRole('slider', { name: '播放进度' }), screen.getByRole('button', { name: '暂停' }), body.querySelector('.scrolling-text')!]) swipe(target, 500, 200);
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '歌词' }));
  swipe(body.querySelector('.room-lyrics-lines')!, 100, 500);
  expect(body).toHaveAttribute('data-mobile-page', 'lyrics'); expect(close).not.toHaveBeenCalled();
});
it('snaps back on small drags, horizontal gestures, cancellation, capture loss and viewport changes', async () => {
  const { body, cover, close } = await setup();
  swipe(cover, 200, 230);
  pointer(cover, 'pointerdown', 200); pointer(cover, 'pointermove', 220, 300); pointer(cover, 'pointerup', 220, 300);
  for (const interrupt of [() => pointer(cover, 'pointercancel', 400), () => fireEvent.lostPointerCapture(body), () => fireEvent.resize(window), () => fireEvent.blur(window)]) {
    pointer(cover, 'pointerdown', 200); pointer(cover, 'pointermove', 400); interrupt(); pointer(cover, 'pointerup', 400);
    expect(body).not.toHaveAttribute('data-dragging'); expect(body.style.getPropertyValue('--player-page-drag')).toBe('');
  }
  expect(body).toHaveAttribute('data-mobile-page', 'controls'); expect(close).not.toHaveBeenCalled();
  // A real tap after a cancelled/short drag must remain functional.
  const link = screen.getByRole('button', { name: '歌词' }); pointer(link, 'pointerdown', 100); pointer(link, 'pointerup', 100); fireEvent.click(link, { detail: 1 });
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
  swipe(screen.getByRole('dialog', { name: '歌词设置' }).querySelector('header')!, 100, 400);
  expect(close).not.toHaveBeenCalled();
  act(() => { mobile = false; listeners.forEach((listener) => listener()); });
  expect(body).not.toHaveAttribute('data-mobile-page'); expect(body.querySelector('.room-content')).not.toHaveAttribute('inert');
  expect(body.querySelector('.room-lyrics-lines')).toBe(reader); expect(screen.queryByRole('button', { name: '返回播放控制' })).not.toBeInTheDocument();
  expect(usePlayer.getState().position).toBe(11);
});
