import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Copy, Home, Search, ListMusic, Scissors, ClipboardPaste, TextSelect } from 'lucide-react';
import { useSession, errorMessage } from '../state/session';

export interface MenuItem { label: string; icon?: ReactNode; action: () => void | Promise<unknown>; href?: string; disabled?: boolean; danger?: boolean; divider?: boolean }
type OpenMenu = (event: Pick<MouseEvent, 'preventDefault' | 'stopPropagation' | 'clientX' | 'clientY' | 'currentTarget'> & { target?: EventTarget | null }, items: MenuItem[]) => { update: (items: MenuItem[]) => void };
const MenuContext = createContext<OpenMenu>(() => ({ update: () => {} }));
export const useContextMenu = () => useContext(MenuContext);

export function Interactions({ children }: { children: ReactNode }) {
  const navigate = useNavigate(); const [menu, setMenu] = useState<{ id: number; x: number; y: number; items: MenuItem[]; host: HTMLElement } | null>(null); const previousFocus = useRef<HTMLElement | null>(null);
  const sequence = useRef(0); const positioned = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null); const tooltip = useRef<HTMLDivElement>(null); const [hint, setHint] = useState<{ text: string; target: HTMLElement } | null>(null);
  const open = useCallback<OpenMenu>((event, items) => { event.preventDefault(); event.stopPropagation(); setHint(null); const element = event.currentTarget instanceof Element ? event.currentTarget : null; const source = event.target instanceof Element ? event.target : element; const bounds = element?.getBoundingClientRect(); previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; const id = ++sequence.current; setMenu({ id, x: event.clientX || bounds?.left || 12, y: event.clientY || bounds?.top || 12, items, host: source?.closest('dialog') ?? document.body }); return { update: (next) => setMenu((current) => current?.id === id ? { ...current, items: next } : current) }; }, []);
  const dismiss = useCallback(() => { setMenu(null); previousFocus.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    const node = ref.current; if (!menu || !node) { positioned.current = null; return; }
    if (positioned.current === menu.id) return; positioned.current = menu.id;
    node.showPopover?.();
    node.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - node.offsetHeight - 8))}px`;
    node.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !ref.current?.contains(e.target)) dismiss(); };
    const scroll = (e: Event) => { if (e.target instanceof Node && !ref.current?.contains(e.target)) dismiss(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('scroll', scroll, true); window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', dismiss); };
  }, [menu, dismiss]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined; let target: HTMLElement | null = null;
    const hide = () => { clearTimeout(timer); target = null; setHint(null); };
    const show = (e: Event) => {
      const element = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tooltip]') : null;
      if (element === target) return; hide(); if (!element || element.closest('[role="menu"]')) return;
      target = element; const text = element.dataset.tooltip; if (!text) return;
      timer = setTimeout(() => { if (element.isConnected && !ref.current) setHint({ text, target: element }); }, e.type === 'focusin' ? 200 : 450);
    };
    const leave = (e: Event) => { const related = (e as PointerEvent).relatedTarget; if (!target || !(related instanceof Node) || !target.contains(related)) hide(); };
    document.addEventListener('pointerover', show); document.addEventListener('focusin', show); document.addEventListener('pointerout', leave); document.addEventListener('focusout', hide); document.addEventListener('pointerdown', hide); document.addEventListener('scroll', hide, true);
    return () => { hide(); document.removeEventListener('pointerover', show); document.removeEventListener('focusin', show); document.removeEventListener('pointerout', leave); document.removeEventListener('focusout', hide); document.removeEventListener('pointerdown', hide); document.removeEventListener('scroll', hide, true); };
  }, []);
  useLayoutEffect(() => {
    if (!hint || !tooltip.current) return; const node = tooltip.current; node.showPopover?.(); const box = hint.target.getBoundingClientRect();
    node.style.left = `${Math.max(7, Math.min(box.left + box.width / 2 - node.offsetWidth / 2, window.innerWidth - node.offsetWidth - 7))}px`;
    node.style.top = `${box.top > node.offsetHeight + 12 ? box.top - node.offsetHeight - 9 : box.bottom + 9}px`; node.showPopover?.();
  }, [hint]);
  function globalMenu(event: MouseEvent) {
    const candidate = event.target instanceof Element ? event.target.closest('input, textarea') : null;
    const field = candidate instanceof HTMLTextAreaElement || candidate instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'email', 'password'].includes(candidate.type) ? candidate : null;
    const secret = field instanceof HTMLInputElement && field.type === 'password';
    const selected = field ? secret ? '' : field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? field.value.length) : window.getSelection()?.toString() ?? '';
    const copy = () => navigator.clipboard.writeText(selected);
    const replace = (text: string) => {
      if (!field) return; const start = field.selectionStart ?? field.value.length; const end = field.selectionEnd ?? field.value.length;
      const setter = Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
      setter?.call(field, field.value.slice(0, start) + text + field.value.slice(end)); field.dispatchEvent(new Event('input', { bubbles: true })); field.focus();
      if (field.selectionStart !== null) field.setSelectionRange(start + text.length, start + text.length);
    };
    const items: MenuItem[] = field ? [
      { label: '复制', icon: <Copy size={16} />, action: copy, disabled: !selected },
      { label: '剪切', icon: <Scissors size={16} />, disabled: !selected || field.readOnly || field.disabled, action: async () => { await copy(); replace(''); } },
      { label: '粘贴', icon: <ClipboardPaste size={16} />, disabled: field.readOnly || field.disabled, action: async () => replace(await navigator.clipboard.readText()) },
      { label: '全选', icon: <TextSelect size={16} />, action: () => { field.focus(); field.select(); } },
    ] : [
      { label: '返回', icon: <ArrowLeft size={16} />, action: () => navigate(-1) }, { label: '前进', icon: <ArrowRight size={16} />, action: () => navigate(1) },
      { label: '主页', icon: <Home size={16} />, divider: true, action: () => navigate('/') }, { label: '搜索音乐', icon: <Search size={16} />, action: () => { navigate('/search'); document.querySelector<HTMLInputElement>('[aria-label="搜索音乐库"]')?.focus(); } },
      { label: '我的歌单', icon: <ListMusic size={16} />, action: () => navigate('/playlists') },
      ...(selected ? [{ label: '复制选中文本', icon: <Copy size={16} />, divider: true, action: copy }] : []),
    ];
    open(event, items);
  }
  return <MenuContext value={open}><div className="interaction-root" onContextMenu={globalMenu}>{children}</div>{menu && createPortal(<div ref={ref} className="context-menu" role="menu" aria-label="快捷菜单" popover={typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined} onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => {
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); dismiss(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const buttons = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]; const index = buttons.indexOf(document.activeElement as HTMLElement); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }
  }}>{menu.items.map((item, index) => item.href && !item.disabled ? <a key={index} role="menuitem" href={item.href} target="_blank" rel="noreferrer" className={item.divider ? 'menu-divider' : ''} onClick={dismiss}>{item.icon ?? <span className="menu-icon-space" />}<span>{item.label}</span></a> : <button key={index} role="menuitem" type="button" className={`${item.divider ? 'menu-divider' : ''} ${item.danger ? 'menu-danger' : ''}`} disabled={item.disabled} onClick={() => { dismiss(); Promise.resolve().then(item.action).catch((e) => useSession.getState().notify(errorMessage(e))); }}>{item.icon ?? <span className="menu-icon-space" />}<span>{item.label}</span></button>)}</div>, menu.host)}{hint && createPortal(<div ref={tooltip} className="app-tooltip" role="tooltip" popover={typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined}>{hint.text}</div>, hint.target.closest('dialog') ?? document.body)}</MenuContext>;
}
