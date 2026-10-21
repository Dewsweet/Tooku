import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicApi } from '../src/api/client';
import type { Lyrics, Track } from '../src/domain/models';
import type { LyricDocument } from '../src/domain/lyrics/types';
import { lyricHash } from '../src/domain/lyrics/normalize';
import { currentLyricLines, lyricTiming } from '../src/domain/lyrics/timing';
import { DesktopLyricsButton } from '../src/features/player/DesktopLyrics';
import { player, usePlayer } from '../src/features/player/engine';
import { useLyrics } from '../src/features/lyrics/useLyrics';
import { updateLyricChoice, useLyricsProfiles } from '../src/state/lyrics';
import { usePreferences } from '../src/state/preferences';
import { useSession } from '../src/state/session';

const track: Track = { id: 'a', title: 'Test song', artist: 'Test artist', duration: 90 };
const documentFixture: LyricDocument = { version: 1, source: 'local', recordId: 'a', tracks: [
  { role: 'original', text: '[00:01]First phrase\n[00:10]Second phrase' },
  { role: 'translation', text: '[00:01]第一句译文\n[00:10]第二句译文' },
] };
let api: MusicApi; let client: QueryClient;
const frames: HTMLIFrameElement[] = [];
beforeEach(() => {
  api = new MusicApi('http://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'lyrics').mockResolvedValue({ synced: true, offsetMs: 0, lines: [], document: documentFixture });
  useSession.getState().setSession(api);
  useLyricsProfiles.setState({ profiles: { [api.identity]: { enabled: false, order: ['netease', 'qq'], tracks: {} } }, refreshes: {} });
  usePreferences.setState({ lyricDelay: 0 });
  usePlayer.setState({ ...usePlayer.getInitialState(), currentId: 'first', entries: [{ entryId: 'first', track }], position: 11, status: 'paused' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(() => {
  cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null);
  usePlayer.setState(usePlayer.getInitialState()); usePreferences.setState({ lyricDelay: 0 });
  useLyricsProfiles.setState({ profiles: {}, refreshes: {} });
  frames.splice(0).forEach((frame) => frame.remove());
  Reflect.deleteProperty(window, 'documentPictureInPicture');
  document.documentElement.style.removeProperty('--accent');
  vi.restoreAllMocks();
});
function fakePip() {
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const pip = frame.contentWindow!;
  const close = vi.spyOn(pip, 'close').mockImplementation(() => { pip.dispatchEvent(new Event('pagehide')); });
  const requestWindow = vi.fn(async () => pip);
  Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow } });
  return { pip, close, requestWindow, content: within(pip.document.body) };
}
function ExistingLyricView() { useLyrics(track); return null; }
function surface(current: Track | undefined = track, shared = false) {
  return render(<QueryClientProvider client={client}>{shared && <ExistingLyricView />}<DesktopLyricsButton track={current} /></QueryClientProvider>);
}

it('uses one timing rule for seconds, all delays, preludes and simultaneous lines', () => {
  const lyrics: Lyrics = { synced: true, offsetMs: 200, lines: [
    { startMs: 1000, text: 'one' }, { startMs: 2000, text: 'two' }, { startMs: 2000, text: 'same timestamp' },
  ] };
  expect(lyricTiming(lyrics, 2.5, 400, { layout: 'auto', hash: '', delayMs: 300 })).toEqual({ delayMs: 900, index: 0 });
  expect(lyricTiming(lyrics, .5, 0).index).toBe(-1);
  expect(currentLyricLines(lyrics, -1)).toEqual([]);
  expect(currentLyricLines(lyrics, 2).map((line) => line.text)).toEqual(['two', 'same timestamp']);
  expect(currentLyricLines({ ...lyrics, synced: false }, -1)).toEqual(lyrics.lines);
});

it('explains unsupported browsers and waits for a user action before reading lyrics', () => {
  const view = surface();
  expect(api.lyrics).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  expect(useSession.getState().notice).toContain('当前浏览器不支持');
  view.rerender(<QueryClientProvider client={client}><DesktopLyricsButton /></QueryClientProvider>);
  expect(screen.getByRole('button', { name: '桌面歌词' })).toBeDisabled();
});

it('shares bilingual lyrics and updates offset/settings without changing playback', async () => {
  const { pip, content, requestWindow } = fakePip();
  const attach = vi.spyOn(player, 'attach'); const load = vi.spyOn(player, 'load');
  surface(track, true);
  fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  expect(requestWindow).toHaveBeenCalledWith({ width: 480, height: 180 });
  await content.findByText('Second phrase'); expect(content.getByText('第二句译文')).toBeInTheDocument();
  expect(api.lyrics).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '关闭桌面歌词' })).toHaveAttribute('aria-pressed', 'true');
  expect(pip.document.title).toBe('Test song · Tooku 桌面歌词');
  act(() => usePreferences.setState({ lyricDelay: 2000 }));
  await content.findByText('First phrase'); expect(content.getByText('第一句译文')).toBeInTheDocument();
  act(() => updateLyricChoice(api.identity, track.id, { mode: 'local', edits: { local: { layout: 'auto', hash: lyricHash(documentFixture), showTranslation: false, delayMs: -2000 } } }));
  await content.findByText('Second phrase'); expect(content.queryByText('第二句译文')).not.toBeInTheDocument();
  act(() => usePlayer.setState({ position: .2 }));
  expect(content.getByText('♪')).toBeInTheDocument();
  expect(attach).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  expect(usePlayer.getState().currentId).toBe('first');
  act(() => document.documentElement.style.setProperty('--accent', '#123456'));
  await waitFor(() => expect(pip.document.documentElement.style.getPropertyValue('--accent')).toBe('#123456'));
});

it('handles browser close, reopen, button close and unmount without stale state', async () => {
  const { pip, close, requestWindow } = fakePip();
  const view = surface();
  fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  await screen.findByRole('button', { name: '关闭桌面歌词' });
  act(() => pip.dispatchEvent(new Event('pagehide')));
  expect(screen.getByRole('button', { name: '桌面歌词' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  await screen.findByRole('button', { name: '关闭桌面歌词' });
  fireEvent.click(screen.getByRole('button', { name: '关闭桌面歌词' }));
  expect(close).toHaveBeenCalledOnce(); expect(requestWindow).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  await screen.findByRole('button', { name: '关闭桌面歌词' });
  view.unmount(); expect(close).toHaveBeenCalledTimes(2);
});

it('switches songs without retaining old lyrics and leaves untimed lyrics browsable', async () => {
  const { content, close } = fakePip();
  const view = surface(); fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  await content.findByText('Second phrase');
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [], document: { version: 1, source: 'local', recordId: 'b', tracks: [
    { role: 'original', text: 'Untimed phrase\nAnother phrase' }, { role: 'translation', text: '静态译文\n另一句译文' },
  ] } });
  view.rerender(<QueryClientProvider client={client}><DesktopLyricsButton track={{ ...track, id: 'b' }} /></QueryClientProvider>);
  expect(content.queryByText('Second phrase')).not.toBeInTheDocument();
  await content.findByText('Untimed phrase'); expect(content.getByText('静态译文')).toBeInTheDocument();
  expect(content.getByText('Another phrase')).toBeInTheDocument();
  expect(content.getByLabelText('歌词内容，可滚动查看')).toHaveAttribute('tabindex', '0');
  expect(close).not.toHaveBeenCalled();
});

it('distinguishes local failures from empty lyrics and supports retry', async () => {
  const { content } = fakePip();
  vi.mocked(api.lyrics).mockRejectedValueOnce(new Error('fixture failure'));
  surface(); fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  await content.findByText('歌词读取失败'); expect(content.queryByText('该音乐没有歌词，请欣赏')).not.toBeInTheDocument();
  vi.mocked(api.lyrics).mockResolvedValue({ synced: false, offsetMs: 0, lines: [] });
  fireEvent.click(content.getByRole('button', { name: '重试' }));
  await content.findByText('该音乐没有歌词，请欣赏');
  expect(content.queryByText('Second phrase')).not.toBeInTheDocument();
});

it('reports rejected requests and closes a late window after unmount', async () => {
  const { pip, close, requestWindow } = fakePip();
  requestWindow.mockRejectedValueOnce(new Error('denied'));
  const view = surface(); fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  await waitFor(() => expect(useSession.getState().notice).toContain('无法打开桌面歌词'));
  let resolve!: (value: Window) => void;
  requestWindow.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  expect(screen.getByRole('button', { name: '桌面歌词' })).toBeDisabled();
  view.unmount(); await act(async () => resolve(pip));
  expect(close).toHaveBeenCalledOnce(); expect(pip.document.body).toBeEmptyDOMElement();
});

it('closes the window when the account changes', async () => {
  const { close } = fakePip();
  surface(); fireEvent.click(screen.getByRole('button', { name: '桌面歌词' }));
  await screen.findByRole('button', { name: '关闭桌面歌词' });
  const nextApi = new MusicApi('http://example.test', 'other-fixture', 'not-real');
  act(() => useSession.getState().setSession(nextApi));
  expect(close).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: '桌面歌词' })).toHaveAttribute('aria-pressed', 'false');
  nextApi.dispose();
});
