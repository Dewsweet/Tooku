import { useEffect, useRef } from 'react';
import type { LyricLine } from '../../domain/models';
import { lyricWordProgress } from '../../domain/lyrics/words';
import { player, usePlayer } from './engine';
import { useReducedMotion } from './playback-hooks';
import './lyric-words.css';

export function LyricText({ line, active, delayMs, nextLineMs }: { line: LyricLine; active: boolean; delayMs: number; nextLineMs?: number }) {
  if (!active || !line.words?.length) return <>{line.text || '♪'}</>;
  return <TimedLyricText line={line} delayMs={delayMs} nextLineMs={nextLineMs} />;
}

function TimedLyricText({ line, delayMs, nextLineMs }: { line: LyricLine; delayMs: number; nextLineMs?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const position = usePlayer((state) => state.position); const status = usePlayer((state) => state.status);
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = ref.current; const words = line.words;
    if (!element || !words?.length) return;
    const spans = [...element.querySelectorAll<HTMLElement>('.lyric-word')];
    const paint = (seconds: number) => spans.forEach((span, index) => {
      const progress = lyricWordProgress(words[index], seconds * 1000 - delayMs, nextLineMs);
      span.style.setProperty('--word-progress', `${(reduced ? progress > 0 ? 1 : 0 : progress) * 100}%`);
    });
    paint(position);
    const view = element.ownerDocument.defaultView;
    if (!view || status !== 'playing' || reduced) return;
    let frame = 0;
    const tick = () => { paint(player.currentTime()); frame = view.requestAnimationFrame(tick); };
    frame = view.requestAnimationFrame(tick);
    return () => view.cancelAnimationFrame(frame);
  }, [line, position, status, reduced, delayMs, nextLineMs]);
  return <span ref={ref} className="lyric-words" data-active="true">{line.words?.map((word, index) => <span className="lyric-word" key={index}>{word.text}</span>)}</span>;
}
