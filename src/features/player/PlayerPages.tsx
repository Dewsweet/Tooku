import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowLeft, ChevronUp } from 'lucide-react';
import { IconButton } from '../../components/Common';
import { mobileLayoutQuery, useMediaQuery } from '../../components/useMediaQuery';
import './player-pages.css';

type Page = 'controls' | 'lyrics';
interface Gesture {
  id: number; x: number; y: number; height: number; page: Page; locked: boolean;
  dialog: HTMLDialogElement; pointer: HTMLElement;
}
const interactive = 'button, a, input, select, textarea, [role="slider"], [role="scrollbar"], [contenteditable="true"], .scrolling-text, .room-lyrics-lines';

export function PlayerPages({ controls, lyrics, onDismiss }: { controls: ReactNode; lyrics: ReactNode; onDismiss: () => void }) {
  const mobile = useMediaQuery(mobileLayoutQuery);
  const [page, setPage] = useState<Page>('controls');
  const body = useRef<HTMLDivElement>(null); const record = useRef<HTMLElement>(null); const reader = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null); const suppressClick = useRef(false); const previousPage = useRef(page);
  const reset = (keepDismiss = false) => {
    const current = gesture.current;
    if (current) {
      if (!keepDismiss) current.dialog.style.removeProperty('--player-dismiss-y');
      current.dialog.removeAttribute('data-player-dragging');
      body.current?.style.removeProperty('--player-page-drag');
      body.current?.removeAttribute('data-dragging');
      gesture.current = null;
      if (current.pointer.hasPointerCapture?.(current.id)) current.pointer.releasePointerCapture(current.id);
    }
  };
  useEffect(() => {
    const cancel = () => { reset(); suppressClick.current = false; };
    window.addEventListener('resize', cancel); window.addEventListener('blur', cancel);
    return () => { cancel(); window.removeEventListener('resize', cancel); window.removeEventListener('blur', cancel); };
  }, []);
  useEffect(() => { reset(); suppressClick.current = false; if (!mobile) setPage('controls'); }, [mobile]);
  useLayoutEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    if (mobile) (page === 'controls' ? record.current : reader.current)?.focus({ preventScroll: true });
  }, [mobile, page]);
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const distance = event.clientY - current.y;
    const threshold = Math.max(48, Math.min(96, current.height * .12));
    const commit = !cancel && current.locked && Math.abs(distance) >= threshold && (current.page === 'controls' || distance > 0);
    suppressClick.current = current.locked && !cancel;
    // Modal owns the same dismissal animation, focus restoration and reduced-motion path as its close button.
    if (commit && current.page === 'controls' && distance > 0) {
      onDismiss();
      reset(true);
    } else {
      if (commit) setPage(current.page === 'controls' ? 'lyrics' : 'controls');
      reset();
    }
  };
  return <div ref={body} className="room-body" data-mobile-page={mobile ? page : undefined}
    onPointerDown={(event) => {
      const target = event.target;
      if (mobile) suppressClick.current = false;
      if (!mobile || event.pointerType === 'mouse' || event.button !== 0 || event.isPrimary === false || !(target instanceof Element)) return;
      if (gesture.current) return;
      if (target.closest(interactive) || target.closest('dialog') !== event.currentTarget.closest('dialog')) return;
      if (page === 'lyrics' && !target.closest('.mobile-player-return-zone')) return;
      const dialog = event.currentTarget.closest('dialog'); if (!dialog || dialog.classList.contains('is-closing')) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, height: event.currentTarget.clientHeight || window.innerHeight, page, locked: false, dialog, pointer: event.currentTarget };
    }}
    onPointerMove={(event) => {
      const current = gesture.current; if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x; const dy = event.clientY - current.y;
      if (!current.locked) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dx) > Math.abs(dy)) { reset(); return; }
        current.locked = true; current.pointer.setPointerCapture?.(current.id);
        body.current?.setAttribute('data-dragging', 'true'); current.dialog.dataset.playerDragging = 'true';
      }
      const distance = current.page === 'lyrics' ? Math.max(0, Math.min(current.height, dy)) : Math.min(0, Math.max(-current.height, dy));
      body.current?.style.setProperty('--player-page-drag', `${distance}px`);
      current.dialog.style.setProperty('--player-dismiss-y', `${current.page === 'controls' ? Math.max(0, dy) * .8 : 0}px`);
    }}
    onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={() => { if (gesture.current) reset(); }}
    onClickCapture={(event) => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    <div className="room-pages-track">
      <section ref={record} className="room-record" aria-label="当前歌曲" tabIndex={-1} inert={mobile && page !== 'controls'} aria-hidden={mobile && page !== 'controls' || undefined}>
        {controls}
        {mobile && <button type="button" className="mobile-player-lyrics-link" onClick={() => setPage('lyrics')}><ChevronUp size={18} /><span>歌词</span></button>}
      </section>
      <section ref={reader} className="room-content" aria-label="歌词" tabIndex={-1} inert={mobile && page !== 'lyrics'} aria-hidden={mobile && page !== 'lyrics' || undefined}>
        {mobile && <div className="mobile-player-return-zone"><IconButton label="返回播放控制" onClick={() => setPage('controls')}><ArrowLeft size={23} /></IconButton></div>}
        {lyrics}
      </section>
    </div>
  </div>;
}
