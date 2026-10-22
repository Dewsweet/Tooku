import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../../components/Common';
import { mobileLayoutQuery, useMediaQuery } from '../../components/useMediaQuery';
import { useReducedMotion } from './playback-hooks';
import './player-pages.css';

type Page = 'controls' | 'lyrics';
interface Gesture {
  id: number; x: number; y: number; width: number; height: number; scroll: number; page: Page;
  kind: 'mouse' | 'dismiss'; locked: boolean;
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
    clearTimeout(settle.current); setPage(next);
    const root = body.current;
    root?.scrollTo({ left: next === 'lyrics' ? root.clientWidth : 0, behavior: reduced ? 'instant' : 'smooth' });
  };
  useEffect(() => {
    const cancel = () => {
      clearTimeout(settle.current); reset(); suppressClick.current = false;
      const root = body.current;
      if (root?.dataset.mobilePage) root.scrollTo({ left: root.dataset.mobilePage === 'lyrics' ? root.clientWidth : 0, behavior: 'instant' });
    };
    window.addEventListener('resize', cancel); window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('resize', cancel); window.removeEventListener('blur', cancel); };
  }, []);
  useEffect(() => { clearTimeout(settle.current); reset(); suppressClick.current = false; if (!mobile) setPage('controls'); }, [mobile]);
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
    if (current.kind === 'mouse') {
      reset();
      const threshold = Math.max(40, Math.min(72, current.width * .15));
      const next = !cancel && current.locked && Math.abs(dx) >= threshold ? (dx < 0 ? 'lyrics' : 'controls') : current.page;
      show(next);
    } else if (!cancel && current.locked && dy >= Math.max(48, Math.min(96, current.height * .12))) {
      // Modal shares its close animation and focus restoration with the collapse button.
      onDismiss(); reset(true);
    } else reset();
  };
  return <div ref={body} className="room-body" data-mobile-page={mobile ? page : undefined} tabIndex={mobile ? 0 : undefined} aria-label={mobile ? '播放器页面' : undefined}
    onScroll={(event) => {
      if (!mobile || event.target !== event.currentTarget || gesture.current?.locked) return;
      clearTimeout(settle.current); const root = event.currentTarget;
      // Let native touch scrolling finish before changing the active page and focus.
      settle.current = setTimeout(() => { if (root.isConnected && root.clientWidth) setPage(root.scrollLeft >= root.clientWidth / 2 ? 'lyrics' : 'controls'); }, 120);
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
      if (!mobile || event.button !== 0 || event.isPrimary === false || !(target instanceof Element)) return;
      if (gesture.current) return;
      if (target.closest(interactive) || target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      const dialog = event.currentTarget.closest('dialog'); if (!dialog || dialog.classList.contains('is-closing')) return;
      const mouse = event.pointerType === 'mouse';
      // Touch paging is native, including swipes starting on lyric lines.
      if (!mouse && (page !== 'controls' || event.currentTarget.scrollLeft > 1)) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: event.currentTarget.clientWidth || window.innerWidth, height: event.currentTarget.clientHeight || window.innerHeight, scroll: event.currentTarget.scrollLeft, page, kind: mouse ? 'mouse' : 'dismiss', locked: false, dialog, pointer: event.currentTarget };
    }}
    onPointerMove={(event) => {
      const current = gesture.current; if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x; const dy = event.clientY - current.y;
      if (!current.locked) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (current.kind === 'mouse' ? Math.abs(dx) <= Math.abs(dy) : dy <= Math.abs(dx) * 1.25) { reset(); return; }
        current.locked = true; current.pointer.setPointerCapture?.(current.id);
        body.current?.setAttribute('data-dragging', 'true'); current.dialog.dataset.playerDragging = 'true';
      }
      if (current.kind === 'mouse') { event.preventDefault(); current.pointer.scrollLeft = current.scroll - dx; }
      else current.dialog.style.setProperty('--player-dismiss-y', `${Math.max(0, dy) * .8}px`);
    }}
    onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={() => { if (gesture.current) { const previous = gesture.current.page; reset(); show(previous); } }}
    onClickCapture={(event) => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    <div className="room-pages-track">
      <section ref={record} className="room-record" aria-label="当前歌曲" tabIndex={-1} inert={mobile && page !== 'controls'} aria-hidden={mobile && page !== 'controls' || undefined}>
        {controls}
      </section>
      <section ref={reader} className="room-content" aria-label="歌词" tabIndex={-1} inert={mobile && page !== 'lyrics'} aria-hidden={mobile && page !== 'lyrics' || undefined}>
        {mobile && <div className="mobile-player-return-zone"><IconButton label="返回播放控制" onClick={() => show('controls')}><ArrowLeft size={23} /></IconButton></div>}
        {lyrics}
      </section>
    </div>
  </div>;
}
