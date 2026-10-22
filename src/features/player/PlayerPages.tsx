import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { mobileLayoutQuery, useMediaQuery } from '../../components/useMediaQuery';
import { useReducedMotion } from './playback-hooks';
import './player-pages.css';

type Page = 'controls' | 'lyrics';
interface Gesture {
  id: number; x: number; y: number; width: number; scroll: number; page: Page; locked: boolean;
  pointer: HTMLElement;
}
const interactive = 'button:not(.room-lyric), a, input, select, textarea, [role="slider"], [role="scrollbar"], [contenteditable="true"], .scrolling-text';
const bounded = (root: HTMLElement) => Math.max(0, Math.min(root.clientWidth, root.scrollLeft));
const nearest = (root: HTMLElement): Page => bounded(root) >= root.clientWidth / 2 ? 'lyrics' : 'controls';
const destination = (page: Page, dx: number, width: number): Page => Math.abs(dx) >= Math.max(40, Math.min(72, width * .15)) ? (dx < 0 ? 'lyrics' : 'controls') : page;

export function PlayerPages({ controls, lyrics }: { controls: ReactNode; lyrics: ReactNode }) {
  const mobile = useMediaQuery(mobileLayoutQuery);
  const reduced = useReducedMotion();
  const [page, setPage] = useState<Page>('controls');
  const body = useRef<HTMLDivElement>(null); const record = useRef<HTMLElement>(null); const reader = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null); const suppressClick = useRef(false); const previousPage = useRef(page);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const touch = useRef<{ id: number; x: number; y: number; page: Page } | null>(null);
  const stopAnimation = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    // Keep snap disabled until the new gesture or animation has reached its destination.
  };
  const reset = () => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null; body.current?.removeAttribute('data-dragging');
    if (current.pointer.hasPointerCapture?.(current.id)) current.pointer.releasePointerCapture(current.id);
  };
  const settleNative = (root: HTMLDivElement) => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { if (root.isConnected && root.dataset.mobilePage && root.clientWidth) setPage(nearest(root)); }, 60);
  };
  const show = (next: Page) => {
    clearTimeout(settle.current); stopAnimation();
    const root = body.current;
    if (!root) return;
    root.dataset.paging = 'true';
    const left = next === 'lyrics' ? root.clientWidth : 0;
    const start = bounded(root); const distance = left - start;
    const complete = () => { frame.current = undefined; setPage(next); root.removeAttribute('data-paging'); };
    if (reduced || Math.abs(distance) < 1) { root.scrollTo({ left, behavior: 'instant' }); complete(); return; }
    root.scrollTo({ left: start, behavior: 'instant' });
    const began = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - began) / 160));
      root.scrollTo({ left: start + distance * (1 - (1 - progress) ** 2), behavior: 'instant' });
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else complete();
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    const cancel = () => {
      clearTimeout(settle.current); touch.current = null; stopAnimation(); reset(); suppressClick.current = false;
      const root = body.current;
      if (root?.dataset.mobilePage) {
        const next = nearest(root); root.scrollTo({ left: next === 'lyrics' ? root.clientWidth : 0, behavior: 'instant' }); setPage(next);
      }
      root?.removeAttribute('data-paging');
    };
    window.addEventListener('resize', cancel); window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('resize', cancel); window.removeEventListener('blur', cancel); };
  }, []);
  useEffect(() => {
    clearTimeout(settle.current); touch.current = null; stopAnimation(); reset(); suppressClick.current = false;
    const root = body.current;
    root?.scrollTo({ left: mobile && root.dataset.mobilePage === 'lyrics' ? root.clientWidth : 0, behavior: 'instant' });
    root?.removeAttribute('data-paging');
    if (!mobile) setPage('controls');
  }, [mobile, reduced]);
  useLayoutEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    if (mobile) (page === 'controls' ? record.current : reader.current)?.focus({ preventScroll: true });
  }, [mobile, page]);
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    suppressClick.current = current.locked && !cancel; reset();
    show(!cancel && current.locked ? destination(current.page, event.clientX - current.x, current.width) : current.page);
  };
  return <div ref={body} className="room-body" data-mobile-page={mobile ? page : undefined} tabIndex={mobile ? 0 : undefined} aria-label={mobile ? '播放器页面' : undefined}
    onScroll={(event) => {
      if (!mobile || event.target !== event.currentTarget || gesture.current || touch.current || frame.current !== undefined) return;
      settleNative(event.currentTarget);
    }}
    onTouchStart={(event) => {
      if (!mobile) return;
      suppressClick.current = false;
      if (event.touches.length !== 1) { touch.current = null; stopAnimation(); reset(); event.currentTarget.removeAttribute('data-paging'); return; }
      if (!(event.target instanceof Element) || event.target.closest(interactive) || event.target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      clearTimeout(settle.current); stopAnimation(); suppressClick.current = false;
      const point = event.touches[0]; const root = event.currentTarget;
      touch.current = { id: point.identifier, x: point.clientX, y: point.clientY, page: nearest(root) };
      root.dataset.paging = 'true';
    }}
    onTouchEnd={(event) => {
      const current = touch.current;
      if (!current) return;
      const point = Array.from(event.changedTouches).find((item) => item.identifier === current.id);
      if (!point) return;
      touch.current = null;
      const dx = point.clientX - current.x; const dy = point.clientY - current.y;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        suppressClick.current = true; show(destination(current.page, dx, event.currentTarget.clientWidth));
      } else { event.currentTarget.removeAttribute('data-paging'); settleNative(event.currentTarget); }
    }}
    onTouchCancel={(event) => {
      // Cancellation can be the browser taking over a scroll. Do not reverse it to the touch-start page.
      if (touch.current) { touch.current = null; stopAnimation(); event.currentTarget.removeAttribute('data-paging'); settleNative(event.currentTarget); }
    }}
    onKeyDown={(event) => {
      if (!mobile || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof Element) || event.target.closest('input, textarea, select, [role="slider"], [contenteditable="true"], .scrolling-text')) return;
      if (event.target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); show(event.key === 'ArrowRight' ? 'lyrics' : 'controls'); }
    }}
    onDragStart={(event) => { if (mobile) event.preventDefault(); }}
    onPointerDown={(event) => {
      const target = event.target;
      if (mobile) suppressClick.current = false;
      if (!mobile || event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false || !(target instanceof Element)) return;
      if (gesture.current || target.closest(interactive) || target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      if (event.currentTarget.closest('dialog')?.classList.contains('is-closing')) return;
      clearTimeout(settle.current); stopAnimation(); suppressClick.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: event.currentTarget.clientWidth || window.innerWidth, scroll: bounded(event.currentTarget), page: nearest(event.currentTarget), locked: false, pointer: event.currentTarget };
      event.currentTarget.dataset.paging = 'true';
    }}
    onPointerMove={(event) => {
      const current = gesture.current; if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x; const dy = event.clientY - current.y;
      if (!current.locked) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.15) { reset(); show(current.page); return; }
        current.locked = true; current.pointer.setPointerCapture?.(current.id);
        body.current?.setAttribute('data-dragging', 'true');
      }
      event.preventDefault(); current.pointer.scrollLeft = Math.max(0, Math.min(current.width, current.scroll - dx));
    }}
    onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={() => { if (gesture.current) { const previous = gesture.current.page; reset(); show(previous); } }}
    onClickCapture={(event) => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    <div className="room-pages-track">
      <section ref={record} className="room-record" aria-label="当前歌曲" tabIndex={-1} inert={mobile && page !== 'controls'} aria-hidden={mobile && page !== 'controls' || undefined}>{controls}</section>
      <section ref={reader} className="room-content" aria-label="歌词" tabIndex={-1} inert={mobile && page !== 'lyrics'} aria-hidden={mobile && page !== 'lyrics' || undefined}>{lyrics}</section>
    </div>
  </div>;
}
