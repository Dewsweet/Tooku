import { useId, useRef, type ReactNode } from 'react';
import { ContentScrollbar } from './ContentScrollbar';

export function ScrollArea({ children, className = '', scope = '', label }: { children: ReactNode; className?: string; scope?: string; label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const id = useId();
  return <div className="overlay-scroll-frame"><div id={id} ref={viewport} className={`overlay-scroll-viewport ${className}`}>{children}</div><ContentScrollbar viewport={viewport} scope={scope} controls={id} label={label} /></div>;
}
