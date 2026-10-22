import { useEffect, useRef, useState, type ReactNode, type MouseEventHandler } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { IconButton } from './Common';

export function Modal({ title, children, onClose, headerActions, onContextMenu, className = '', wide = false, variant = 'default', busy = false }: { title: string; children: ReactNode; onClose: () => void; headerActions?: ReactNode; onContextMenu?: MouseEventHandler<HTMLDialogElement>; className?: string; wide?: boolean; variant?: 'default' | 'player' | 'queue' | 'mobile-queue'; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const close = useRef(onClose);
  const pending = useRef(busy); pending.current = busy;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const requestClose = useRef(() => {});
  requestClose.current = () => {
    if (timer.current || pending.current) return;
    if (document.documentElement.dataset.motion === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { close.current(); return; }
    setClosing(true); timer.current = setTimeout(() => close.current(), 190);
  };
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; const dialog = ref.current!;
    dialog.showModal();
    const cancel = (e: Event) => { e.preventDefault(); requestClose.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => { clearTimeout(timer.current); timer.current = undefined; dialog.removeEventListener('cancel', cancel); dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''} modal-${variant} ${closing ? 'is-closing' : ''} ${className}`} aria-label={title} aria-busy={busy || undefined} onContextMenu={onContextMenu} onClick={(event) => {
    if (event.target !== event.currentTarget || variant === 'player') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose.current();
  }}>
    <header className="modal-heading"><h2>{title}</h2>{headerActions}<IconButton label={variant === 'player' ? '收起播放器' : '关闭'} disabled={busy} onClick={() => requestClose.current()}>{variant === 'player' ? <ChevronDown size={25} /> : <X size={22} />}</IconButton></header>{children}
  </dialog>;
}
