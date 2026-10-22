import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { mobileLayoutQuery, useMediaQuery } from '../../components/useMediaQuery';
import { useReducedMotion } from './playback-hooks';
import './player-pages.css';

type Page = 'controls' | 'lyrics';
interface Gesture {
  kind: 'touch' | 'mouse'; id: number; x: number; y: number; start: number; width: number; page: Page;
  lastX: number; lastAt: number; velocity: number; locked: boolean; pointer: HTMLElement;
}
const interactive = 'button:not(.room-lyric), a, input, select, textarea, [role="slider"], [role="scrollbar"], [contenteditable="true"], .scrolling-text';
const clamp = (value: number, width: number) => Math.max(0, Math.min(width, value));
const pageAt = (value: number, width: number): Page => value >= width / 2 ? 'lyrics' : 'controls';

export function PlayerPages({ controls, lyrics }: { controls: ReactNode; lyrics: ReactNode }) {
  const mobile = useMediaQuery(mobileLayoutQuery); const reduced = useReducedMotion();
  const [page, setPage] = useState<Page>('controls');
  const body = useRef<HTMLDivElement>(null); const record = useRef<HTMLElement>(null); const reader = useRef<HTMLElement>(null);
  const active = useRef<Page>('controls'); const target = useRef<Page | null>(null); const previousPage = useRef(page);
  const width = useRef(0); const position = useRef(0); const frame = useRef<number | undefined>(undefined);
  const gesture = useRef<Gesture | null>(null); const suppressClick = useRef(false);
  const paint = (value: number) => {
    position.current = clamp(value, width.current);
    body.current?.style.setProperty('--player-page-x', `${-position.current}px`);
  };
  const stopAnimation = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined; target.current = null; body.current?.removeAttribute('data-paging');
  };
  const reset = () => {
    const current = gesture.current; gesture.current = null; body.current?.removeAttribute('data-dragging');
    if (current?.kind === 'mouse' && current.pointer.hasPointerCapture?.(current.id)) current.pointer.releasePointerCapture(current.id);
  };
  const commit = (next: Page) => { active.current = next; setPage(next); };
  const show = (next: Page) => {
    stopAnimation();
    const left = next === 'lyrics' ? width.current : 0;
    const start = position.current; const distance = left - start;
    if (reduced || Math.abs(distance) < .5) { paint(left); commit(next); return; }
    target.current = next; body.current?.setAttribute('data-paging', 'true');
    const began = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - began) / 160));
      paint(start + distance * (1 - (1 - progress) ** 2));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else { stopAnimation(); commit(next); }
    };
    frame.current = requestAnimationFrame(tick);
  };
  const begin = (kind: Gesture['kind'], id: number, x: number, y: number, root: HTMLDivElement) => {
    stopAnimation(); suppressClick.current = false;
    width.current = root.clientWidth || window.innerWidth;
    gesture.current = { kind, id, x, y, start: position.current, width: width.current, page: pageAt(position.current, width.current), lastX: x, lastAt: performance.now(), velocity: 0, locked: false, pointer: root };
  };
  const move = (current: Gesture, x: number, y: number) => {
    const dx = x - current.x; const dy = y - current.y;
    if (!current.locked) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return false;
      if (Math.abs(dy) > Math.abs(dx) * 1.15) { reset(); show(current.page); return false; }
      if (Math.abs(dx) <= Math.abs(dy) * 1.15) return false;
      current.locked = true;
      if (current.kind === 'mouse') current.pointer.setPointerCapture?.(current.id);
      body.current?.setAttribute('data-dragging', 'true');
    }
    const now = performance.now();
    current.velocity = (current.lastX - x) / Math.max(1, now - current.lastAt);
    current.lastX = x; current.lastAt = now;
    paint(current.start - dx);
    return true;
  };
  const finish = (cancel = false) => {
    const current = gesture.current; if (!current) return;
    const distance = position.current - current.start;
    const flick = Math.abs(distance) >= 12 && performance.now() - current.lastAt < 80 && Math.abs(current.velocity) >= .45 && Math.sign(current.velocity) === Math.sign(distance);
    const crossed = Math.abs(distance) >= Math.max(28, Math.min(48, current.width * .1));
    const next = !cancel && current.locked && (crossed || flick) ? (distance > 0 ? 'lyrics' : 'controls') : current.page;
    suppressClick.current = current.locked && !cancel; reset(); show(next);
  };
  const moveTouch = useEffectEvent((event: TouchEvent) => {
    const current = gesture.current; if (current?.kind !== 'touch') return;
    if (event.touches.length !== 1) { finish(true); return; }
    const point = Array.from(event.touches).find((item) => item.identifier === current.id);
    if (!point) return;
    if (!event.cancelable) { finish(true); return; }
    if (move(current, point.clientX, point.clientY)) event.preventDefault();
  });
  useEffect(() => {
    if (!mobile) return;
    const root = body.current; if (!root) return;
    // A non-passive listener owns horizontal movement before the browser can scroll.
    // Vertical lyrics and excluded controls retain their native touch behavior.
    const touchMove = (event: TouchEvent) => moveTouch(event);
    root.addEventListener('touchmove', touchMove, { passive: false });
    return () => root.removeEventListener('touchmove', touchMove);
  }, [mobile]);
  useEffect(() => {
    const root = body.current;
    const resize = () => {
      if (!root?.dataset.mobilePage || !root.clientWidth || root.clientWidth === width.current) return;
      const next = pageAt(position.current, width.current);
      stopAnimation(); reset(); width.current = root.clientWidth; paint(next === 'lyrics' ? width.current : 0); commit(next);
    };
    const blur = () => { if (root?.dataset.mobilePage) { stopAnimation(); reset(); paint(active.current === 'lyrics' ? width.current : 0); } };
    window.addEventListener('resize', resize); window.addEventListener('blur', blur);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    if (root) observer?.observe(root);
    return () => { stopAnimation(); reset(); observer?.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('blur', blur); };
  }, []);
  useLayoutEffect(() => {
    const next = mobile ? target.current ?? active.current : 'controls';
    stopAnimation(); reset(); suppressClick.current = false;
    width.current = body.current?.clientWidth || window.innerWidth;
    if (mobile) paint(next === 'lyrics' ? width.current : 0);
    else body.current?.style.removeProperty('--player-page-x');
    commit(next);
  }, [mobile, reduced]);
  useLayoutEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    if (mobile) (page === 'controls' ? record.current : reader.current)?.focus({ preventScroll: true });
  }, [mobile, page]);
  const allowed = (element: EventTarget, root: HTMLDivElement) => element instanceof Element && !element.closest(interactive) && element.closest('dialog') === root.closest('dialog') && !root.closest('dialog')?.classList.contains('is-closing');
  return <div ref={body} className="room-body" data-mobile-page={mobile ? page : undefined} tabIndex={mobile ? 0 : undefined} aria-label={mobile ? '播放器页面' : undefined}
    onTouchStart={(event) => {
      if (!mobile) return; suppressClick.current = false;
      if (event.touches.length !== 1) { finish(true); return; }
      if (gesture.current || !allowed(event.target, event.currentTarget)) return;
      const point = event.touches[0]; begin('touch', point.identifier, point.clientX, point.clientY, event.currentTarget);
    }}
    onTouchEnd={(event) => { const current = gesture.current; if (current?.kind === 'touch' && Array.from(event.changedTouches).some((point) => point.identifier === current.id)) finish(); }}
    onTouchCancel={() => { if (gesture.current?.kind === 'touch') finish(true); }}
    onKeyDown={(event) => {
      if (!mobile || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof Element) || event.target.closest('input, textarea, select, [role="slider"], [contenteditable="true"], .scrolling-text')) return;
      if (event.target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); reset(); show(event.key === 'ArrowRight' ? 'lyrics' : 'controls'); }
    }}
    onDragStart={(event) => { if (mobile) event.preventDefault(); }}
    onPointerDown={(event) => {
      if (mobile) suppressClick.current = false;
      if (!mobile || event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false || gesture.current || !allowed(event.target, event.currentTarget)) return;
      begin('mouse', event.pointerId, event.clientX, event.clientY, event.currentTarget);
    }}
    onPointerMove={(event) => { const current = gesture.current; if (current?.kind === 'mouse' && current.id === event.pointerId && move(current, event.clientX, event.clientY)) event.preventDefault(); }}
    onPointerUp={(event) => { const current = gesture.current; if (current?.kind === 'mouse' && current.id === event.pointerId) finish(); }}
    onPointerCancel={(event) => { const current = gesture.current; if (current?.kind === 'mouse' && current.id === event.pointerId) finish(true); }}
    onLostPointerCapture={() => { if (gesture.current?.kind === 'mouse') finish(true); }}
    onClickCapture={(event) => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    <div className="room-pages-track">
      <section ref={record} className="room-record" aria-label="当前歌曲" tabIndex={-1} inert={mobile && page !== 'controls'} aria-hidden={mobile && page !== 'controls' || undefined}>{controls}</section>
      <section ref={reader} className="room-content" aria-label="歌词" tabIndex={-1} inert={mobile && page !== 'lyrics'} aria-hidden={mobile && page !== 'lyrics' || undefined}>{lyrics}</section>
    </div>
  </div>;
}
