import { useEffect, useRef, useState, type RefObject } from 'react';
import './content-scrollbar.css';

export function scrollThumbGeometry(height: number, scrollHeight: number, scrollTop: number) {
  const track = Math.max(0, height);
  const range = Math.max(0, scrollHeight - height);
  const thumb = Math.min(track, Math.max(28, scrollHeight ? track * height / scrollHeight : track));
  const travel = Math.max(0, track - thumb);
  return { range, thumb, travel, top: range ? Math.min(range, Math.max(0, scrollTop)) / range * travel : 0, value: Math.round(scrollTop) };
}

export function ContentScrollbar({ viewport, scope, controls = 'workspace-content', label = '页面滚动条' }: { viewport: RefObject<HTMLElement | null>; scope: string; controls?: string; label?: string }) {
  const [metrics, setMetrics] = useState(() => scrollThumbGeometry(0, 0, 0));
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; y: number; scrollTop: number; range: number; travel: number } | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      frame = 0;
      const next = scrollThumbGeometry(element.clientHeight, element.scrollHeight, element.scrollTop);
      setMetrics((old) => Object.keys(next).every((key) => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onScroll = () => { schedule(); setActive(true); clearTimeout(idle); idle = setTimeout(() => setActive(false), 900); };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const observed = new Set<Element>();
    resize?.observe(element);
    const observe = () => {
      const children = new Set(element.children);
      for (const child of observed) if (!children.has(child)) { resize?.unobserve(child); observed.delete(child); }
      for (const child of children) if (!observed.has(child)) { resize?.observe(child); observed.add(child); }
      schedule();
    };
    const changes = new MutationObserver(observe);
    changes.observe(element, { childList: true, subtree: true });
    setActive(false); setDragging(false); measure(); observe();
    element.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule);
    const control = thumb.current;
    return () => {
      element.removeEventListener('scroll', onScroll); window.removeEventListener('resize', schedule);
      resize?.disconnect(); changes.disconnect(); cancelAnimationFrame(frame); clearTimeout(idle);
      if (drag.current && control?.hasPointerCapture?.(drag.current.pointer)) control.releasePointerCapture(drag.current.pointer);
      drag.current = null;
    };
  }, [viewport, scope]);

  return <div className={`content-scrollbar ${active || dragging ? 'is-active' : ''}`} data-overflow={metrics.range > 1} onPointerDown={(event) => {
    const element = viewport.current;
    if (event.target !== event.currentTarget || !element || !metrics.travel) return;
    event.preventDefault();
    element.scrollTop = (event.clientY - event.currentTarget.getBoundingClientRect().top - metrics.thumb / 2) / metrics.travel * metrics.range;
  }}>
    <div ref={thumb} role="scrollbar" aria-label={label} aria-controls={controls} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(metrics.range)} aria-valuenow={Math.min(Math.round(metrics.range), Math.max(0, metrics.value))} tabIndex={0} className="content-scrollbar-thumb" style={{ height: metrics.thumb, transform: `translateY(${metrics.top}px)` }} onKeyDown={(event) => {
      const element = viewport.current; if (!element) return;
      const step = event.key === 'ArrowDown' ? 40 : event.key === 'ArrowUp' ? -40 : event.key === 'PageDown' || event.key === ' ' && !event.shiftKey ? element.clientHeight : event.key === 'PageUp' || event.key === ' ' && event.shiftKey ? -element.clientHeight : null;
      if (event.key === 'Home' || event.key === 'End' || step !== null) {
        event.preventDefault(); element.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? metrics.range : element.scrollTop + (step ?? 0);
      }
    }} onPointerDown={(event) => {
      const element = viewport.current; if (!element || !metrics.travel || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, y: event.clientY, scrollTop: element.scrollTop, range: metrics.range, travel: metrics.travel };
      setDragging(true);
    }} onPointerMove={(event) => {
      const start = drag.current; const element = viewport.current;
      if (start && element && event.pointerId === start.pointer) element.scrollTop = start.scrollTop + (event.clientY - start.y) / start.travel * start.range;
    }} onPointerUp={(event) => {
      if (drag.current?.pointer !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      drag.current = null; setDragging(false);
    }} onPointerCancel={() => { drag.current = null; setDragging(false); }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }} />
  </div>;
}
