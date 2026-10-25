import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Modal } from '../../components/Modal';
import { ScrollArea } from '../../components/ScrollArea';
import { QueuePanel } from './QueuePanel';
import './mobile-queue.css';

export function MobileQueueSheet({ onClose }: { onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const gesture = useRef<{ pointerId: number; startY: number; height: number; viewport: number; dialog: HTMLDialogElement } | null>(null);
  const suppressClick = useRef(false);
  const reset = () => {
    const current = gesture.current;
    current?.dialog.style.removeProperty('--queue-sheet-height');
    current?.dialog.removeAttribute('data-dragging');
    gesture.current = null;
  };
  useEffect(() => () => {
    gesture.current?.dialog.style.removeProperty('--queue-sheet-height');
    gesture.current?.dialog.removeAttribute('data-dragging');
  }, []);
  const finish = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = current.startY - event.clientY;
    suppressClick.current = !cancel && Math.abs(distance) > 8;
    if (!cancel && Math.abs(distance) > 32) setExpanded(distance > 0);
    reset();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <Modal title="播放队列" variant="mobile-queue" className={`mobile-queue-sheet ${expanded ? 'is-expanded' : ''}`} onClose={onClose} headerActions={
    <button type="button" className="queue-sheet-handle" aria-label={expanded ? '收起队列' : '展开队列'} aria-expanded={expanded}
      onClick={(event) => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; } suppressClick.current = false; setExpanded((value) => !value); }}
      onKeyDown={(event) => {
        if (['ArrowUp', 'Home', 'ArrowDown', 'End'].includes(event.key)) { event.preventDefault(); setExpanded(event.key === 'ArrowUp' || event.key === 'Home'); }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const dialog = event.currentTarget.closest('dialog');
        if (!dialog) return;
        suppressClick.current = false;
        gesture.current = { pointerId: event.pointerId, startY: event.clientY, height: dialog.getBoundingClientRect().height, viewport: window.visualViewport?.height ?? window.innerHeight, dialog };
        dialog.dataset.dragging = 'true';
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const height = Math.min(current.viewport, Math.max(current.viewport * .75, current.height + current.startY - event.clientY));
        current.dialog.style.setProperty('--queue-sheet-height', `${height}px`);
      }}
      onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={() => { if (gesture.current) { suppressClick.current = false; reset(); } }}>
      <span aria-hidden="true" />
    </button>
  }><ScrollArea className="mobile-queue-scroll" scope={expanded ? 'full' : 'partial'} label="播放队列滚动条"><QueuePanel compact /></ScrollArea></Modal>;
}
