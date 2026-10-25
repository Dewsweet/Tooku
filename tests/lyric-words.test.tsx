import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LyricText } from '../src/features/player/LyricText';
import { usePreferences } from '../src/state/preferences';
import { player, usePlayer } from '../src/features/player/engine';

const line = { text: '你好', startMs: 1000, words: [{ text: '你', startMs: 1000, endMs: 2000 }, { text: '好', startMs: 2000, endMs: 3000 }] };
afterEach(() => { usePreferences.setState(usePreferences.getInitialState()); usePlayer.setState(usePlayer.getInitialState()); vi.restoreAllMocks(); });

it('paints word progress with the shared offset and updates immediately on paused seeking', () => {
  usePreferences.setState({ reducedMotion: false }); usePlayer.setState({ status: 'paused', position: 1.75 });
  const view = render(<LyricText line={line} active delayMs={250} />);
  const words = view.container.querySelectorAll<HTMLElement>('.lyric-word');
  expect(words[0].style.getPropertyValue('--word-progress')).toBe('50%'); expect(words[1].style.getPropertyValue('--word-progress')).toBe('0%');
  act(() => usePlayer.setState({ position: 2.75 }));
  expect(words[0].style.getPropertyValue('--word-progress')).toBe('100%'); expect(words[1].style.getPropertyValue('--word-progress')).toBe('50%');
  expect(view.container.textContent).toBe('你好');
});

it('uses the audio clock for smooth words and cancels frames when the line is inactive or unmounted', () => {
  let callback: FrameRequestCallback | undefined;
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((next) => { callback = next; return 17; });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame'); vi.spyOn(player, 'currentTime').mockReturnValue(1.5);
  usePreferences.setState({ reducedMotion: false }); usePlayer.setState({ status: 'playing', position: 1 });
  const view = render(<LyricText line={line} active delayMs={0} />);
  act(() => callback?.(0));
  expect(view.container.querySelector<HTMLElement>('.lyric-word')?.style.getPropertyValue('--word-progress')).toBe('50%');
  view.rerender(<LyricText line={line} active={false} delayMs={0} />);
  expect(cancel).toHaveBeenCalledWith(17); expect(view.container.querySelector('.lyric-word')).toBeNull();
  const count = request.mock.calls.length; act(() => usePlayer.setState({ position: 2 })); expect(request).toHaveBeenCalledTimes(count);
  view.rerender(<LyricText line={line} active delayMs={0} />); view.unmount(); expect(cancel).toHaveBeenCalledWith(17);
});

it('uses discrete word highlighting with reduced motion and leaves plain lines alone', () => {
  const request = vi.spyOn(window, 'requestAnimationFrame');
  usePreferences.setState({ reducedMotion: true }); usePlayer.setState({ status: 'playing', position: 1.5 });
  const view = render(<LyricText line={line} active delayMs={0} />);
  expect(view.container.querySelector<HTMLElement>('.lyric-word')?.style.getPropertyValue('--word-progress')).toBe('100%'); expect(request).not.toHaveBeenCalled();
  view.rerender(<LyricText line={{ text: '普通歌词' }} active delayMs={0} />); expect(view.container.textContent).toBe('普通歌词');
});
