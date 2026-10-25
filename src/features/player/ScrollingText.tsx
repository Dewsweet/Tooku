import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useReducedMotion } from './playback-hooks';

export function ScrollingText({ text, children }: { text: string; children?: ReactNode }) {
  const viewport = useRef<HTMLSpanElement>(null); const content = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const frame = viewport.current; const line = content.current;
    if (!frame || !line) return;
    let active = true; frame.scrollLeft = 0;
    const measure = () => {
      if (!active) return;
      const distance = Math.max(0, line.scrollWidth - frame.clientWidth);
      frame.dataset.overflow = String(distance > 1);
      frame.dataset.animate = String(distance > 1 && !reduced);
      frame.tabIndex = distance > 1 ? 0 : -1;
      frame.style.setProperty('--text-distance', `${-distance}px`);
      frame.style.setProperty('--text-duration', `${Math.max(10, distance / 30 * 2 + 4)}s`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(frame); observer?.observe(line);
    void document.fonts?.ready.then(measure);
    return () => { active = false; observer?.disconnect(); };
  }, [text, reduced]);
  return <span className="scrolling-text" ref={viewport}><span ref={content}>{children ?? text}</span></span>;
}
