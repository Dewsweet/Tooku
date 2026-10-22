import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { mobileLayoutQuery, useMediaQuery } from '../../components/useMediaQuery';
import { useReducedMotion } from './playback-hooks';
import './player-pages.css';

type Page = 'controls' | 'lyrics';
interface Gesture {
  id: number; x: number; y: number; width: number; height: number; scroll: number; page: Page;
  mouse: boolean; kind: 'pending' | 'horizontal' | 'dismiss'; locked: boolean;
  dialog: HTMLDialogElement; pointer: HTMLElement;
}
const interactive = 'button:not(.room-lyric), a, input, select, textarea, [role="slider"], [role="scrollbar"], [contenteditable="true"], .scrolling-text';

export function PlayerPages({ controls, lyrics, onDismiss }: { controls: ReactNode; lyrics: ReactNode; onDismiss: () => void }) {
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
    if (!touch.current) body.current?.removeAttribute('data-paging');
  };
  const reset = (keepDismiss = false) => {
    const current = gesture.current;
    if (current) {
      if (!keepDismiss) current.dialog.style.removeProperty('--player-dismiss-y');
      current.dialog.removeAttribute('data-player-dragging');
      body.current?.removeAttribute('data-dragging');
      gesture.current = null;
      if (current.pointer.hasPointerCapture?.(current.id)) current.pointer.releasePointerCapture(current.id);
    }
  };
  const show = (next: Page) => {
    clearTimeout(settle.current); stopAnimation(); setPage(next);
    const root = body.current;
    if (!root) return;
    const left = next === 'lyrics' ? root.clientWidth : 0;
    const start = root.scrollLeft; const distance = left - start;
    if (reduced || Math.abs(distance) < 1) { root.scrollTo({ left, behavior: 'instant' }); return; }
    root.dataset.paging = 'true';
    // Cancel native momentum; keep the release animation short without a long braking tail.
    root.scrollTo({ left: start, behavior: 'instant' });
    const began = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - began) / 160));
      root.scrollTo({ left: start + distance * (1 - (1 - progress) ** 2), behavior: 'instant' });
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else { frame.current = undefined; root.removeAttribute('data-paging'); }
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    const cancel = () => {
      clearTimeout(settle.current); touch.current = null; stopAnimation(); reset(); suppressClick.current = false;
      const root = body.current;
      if (root?.dataset.mobilePage) root.scrollTo({ left: root.dataset.mobilePage === 'lyrics' ? root.clientWidth : 0, behavior: 'instant' });
    };
    window.addEventListener('resize', cancel); window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('resize', cancel); window.removeEventListener('blur', cancel); };
  }, []);
  useEffect(() => {
    clearTimeout(settle.current); touch.current = null; stopAnimation(); reset(); suppressClick.current = false;
    const root = body.current;
    root?.scrollTo({ left: mobile && root.dataset.mobilePage === 'lyrics' ? root.clientWidth : 0, behavior: 'instant' });
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
    const dx = event.clientX - current.x; const dy = event.clientY - current.y;
    suppressClick.current = current.locked && !cancel;
    if (current.kind === 'horizontal') {
      reset();
      const threshold = Math.max(40, Math.min(72, current.width * .15));
      const next = !cancel && current.locked && Math.abs(dx) >= threshold ? (dx < 0 ? 'lyrics' : 'controls') : current.page;
      show(next);
    } else if (!cancel && current.locked && current.kind === 'dismiss' && dy >= Math.max(48, Math.min(80, current.height * .1))) {
      // Modal shares its close animation and focus restoration with the collapse button.
      onDismiss(); reset(true);
    } else reset();
  };
  return <div ref={body} className="room-body" data-mobile-page={mobile ? page : undefined} tabIndex={mobile ? 0 : undefined} aria-label={mobile ? '播放器页面' : undefined}
    onScroll={(event) => {
      if (!mobile || event.target !== event.currentTarget || gesture.current?.locked || touch.current || frame.current !== undefined) return;
      clearTimeout(settle.current); const root = event.currentTarget;
      // Let native touch scrolling finish before changing the active page and focus.
      settle.current = setTimeout(() => { if (root.isConnected && root.clientWidth) setPage(root.scrollLeft >= root.clientWidth / 2 ? 'lyrics' : 'controls'); }, 60);
    }}
    onTouchStart={(event) => {
      if (mobile && event.touches.length !== 1) { touch.current = null; stopAnimation(); reset(); return; }
      if (!mobile || !(event.target instanceof Element) || event.target.closest(interactive) || event.target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      clearTimeout(settle.current); stopAnimation();
      const point = event.touches[0];
      touch.current = { id: point.identifier, x: point.clientX, y: point.clientY, page: event.currentTarget.scrollLeft >= event.currentTarget.clientWidth / 2 ? 'lyrics' : 'controls' };
      event.currentTarget.dataset.paging = 'true';
    }}
    onTouchEnd={(event) => {
      const current = touch.current;
      if (!current) return;
      const point = Array.from(event.changedTouches).find((item) => item.identifier === current.id);
      if (!point) return;
      touch.current = null;
      const dx = point.clientX - current.x; const dy = point.clientY - current.y;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        suppressClick.current = true;
        const threshold = Math.max(40, Math.min(72, event.currentTarget.clientWidth * .15));
        show(Math.abs(dx) >= threshold ? (dx < 0 ? 'lyrics' : 'controls') : current.page);
      } else event.currentTarget.removeAttribute('data-paging');
    }}
    onTouchCancel={() => { if (touch.current) { const previous = touch.current.page; touch.current = null; show(previous); } }}
    onKeyDown={(event) => {
      if (!mobile || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof Element) || event.target.closest('input, textarea, select, [role="slider"], [contenteditable="true"], .scrolling-text')) return;
      if (event.target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); show(event.key === 'ArrowRight' ? 'lyrics' : 'controls'); }
    }}
    onDragStart={(event) => { if (mobile) event.preventDefault(); }}
    onPointerDown={(event) => {
      const target = event.target;
      if (mobile) { suppressClick.current = false; stopAnimation(); }
      if (!mobile || event.button !== 0 || event.isPrimary === false || !(target instanceof Element)) return;
      if (gesture.current) return;
      if (target.closest(interactive) || target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      const dialog = event.currentTarget.closest('dialog'); if (!dialog || dialog.classList.contains('is-closing')) return;
      const mouse = event.pointerType === 'mouse';
      // Touch dragging stays native; vertical cover gestures and mouse dragging use pointer events.
      if (!mouse && (page !== 'controls' || event.currentTarget.scrollLeft > 1)) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: event.currentTarget.clientWidth || window.innerWidth, height: event.currentTarget.clientHeight || window.innerHeight, scroll: event.currentTarget.scrollLeft, page, mouse, kind: 'pending', locked: false, dialog, pointer: event.currentTarget };
    }}
    onPointerMove={(event) => {
      const current = gesture.current; if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x; const dy = event.clientY - current.y;
      if (!current.locked) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.15 && current.mouse) current.kind = 'horizontal';
        else if (dy > Math.abs(dx) * 1.15 && current.page === 'controls' && current.scroll < 1) current.kind = 'dismiss';
        else { reset(); return; }
        current.locked = true; current.pointer.setPointerCapture?.(current.id);
        body.current?.setAttribute('data-dragging', 'true'); current.dialog.dataset.playerDragging = 'true';
      }
      event.preventDefault();
      if (current.kind === 'horizontal') current.pointer.scrollLeft = current.scroll - dx;
      else current.dialog.style.setProperty('--player-dismiss-y', `${Math.max(0, dy) * .9}px`);
    }}
    onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={() => { if (gesture.current) { const previous = gesture.current.page; reset(); show(previous); } }}
    onClickCapture={(event) => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    <div className="room-pages-track">
      <section ref={record} className="room-record" aria-label="当前歌曲" tabIndex={-1} inert={mobile && page !== 'controls'} aria-hidden={mobile && page !== 'controls' || undefined}>
        {controls}
      </section>
      <section ref={reader} className="room-content" aria-label="歌词" tabIndex={-1} inert={mobile && page !== 'lyrics'} aria-hidden={mobile && page !== 'lyrics' || undefined}>
        {lyrics}
      </section>
    </div>
  </div>;
}
