import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'children'> & { value: string | number; onChange: (value: string) => void; children: ReactNode };
type Option = { value: string; label: ReactNode; disabled: boolean };
export function Select({ value, onChange, children, disabled, id, className = '', 'aria-label': label, 'aria-describedby': describedBy, title, ...rest }: Props) {
  const options: Option[] = Children.toArray(children).flatMap((child) => isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child) ? [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: Boolean(child.props.disabled) }] : []);
  const generated = useId(); const listId = `${generated}-options`; const button = useRef<HTMLButtonElement>(null); const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false); const [active, setActive] = useState(0); const [host, setHost] = useState<HTMLElement | null>(null); const [position, setPosition] = useState({ top: 0, left: 0, width: 180, maxHeight: 280 });
  const selected = options.findIndex((o) => o.value === String(value));
  const close = () => { setOpen(false); button.current?.focus(); };
  function choose(index: number) { const option = options[index]; if (option && !option.disabled) { onChange(option.value); close(); } }
  function show() { if (disabled || !options.length) return; setActive(Math.max(0, selected)); setHost(button.current?.closest('dialog') ?? document.body); setOpen(true); }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current!.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }
      const space = window.innerHeight - rect.bottom - 14; const above = space < 150 && rect.top > space;
      const maxHeight = Math.min(280, Math.max(90, above ? rect.top - 14 : space));
      setPosition({ top: above ? Math.max(7, rect.top - Math.min(options.length * 41 + 12, maxHeight) - 6) : rect.bottom + 6, left: Math.min(Math.max(7, rect.left), Math.max(7, window.innerWidth - Math.max(rect.width, 170) - 7)), width: Math.min(Math.max(rect.width, 170), window.innerWidth - 14), maxHeight });
    };
    place();
    if (popup.current?.showPopover) popup.current.showPopover();
    else popup.current?.removeAttribute('popover');
    const onScroll = (event: Event) => {
      // Internal list scrolling (including keyboard navigation) must not reposition it.
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      place();
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (button.current) observer?.observe(button.current);
    return () => { document.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', place); observer?.disconnect(); };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !button.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (open) popup.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [open, active]);
  return <><button type="button" id={id} ref={button} className={`styled-select ${className}`} role="combobox" aria-label={label} aria-describedby={describedBy} aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${generated}-${active}` : undefined} aria-haspopup="listbox" data-tooltip={title} disabled={disabled} onClick={() => open ? close() : show()} onBlur={(event) => { if (!popup.current?.contains(event.relatedTarget as Node)) setOpen(false); }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') setOpen(false);
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (open) choose(active); else show(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); if (!open) { show(); return; }
      const step = event.key === 'ArrowUp' ? -1 : 1; let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (active + step + options.length) % options.length;
      for (let i = 0; i < options.length && options[next]?.disabled; i++) next = (next + step + options.length) % options.length;
      setActive(next);
    }
  }}><span>{options[selected]?.label ?? options[0]?.label ?? '请选择'}</span><ChevronDown size={15} /></button>{rest.name && <input type="hidden" name={rest.name} value={value} />}
    {open && host && createPortal(<div ref={popup} id={listId} popover="manual" className="select-options" role="listbox" aria-label={label} style={position} onPointerDown={(e) => e.preventDefault()}>{options.map((option, index) => <div key={option.value} id={`${generated}-${index}`} role="option" aria-selected={option.value === String(value)} aria-disabled={option.disabled} data-option-index={index} className={`${active === index ? 'highlighted' : ''}`} onPointerMove={() => !option.disabled && setActive(index)} onClick={() => choose(index)}><span>{option.label}</span>{option.value === String(value) && <Check size={15} />}</div>)}</div>, host)}
  </>;
}
