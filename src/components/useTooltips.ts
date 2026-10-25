import { useEffect, useRef, useState } from 'react';

const navigationKeys = new Set(['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
export function useTooltips(scope: string) {
  const [hint, setHint] = useState<{ text: string; target: HTMLElement } | null>(null);
  const menuOpen = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLElement | null = null;
    let touch: { id: number; x: number; y: number } | null = null;
    let held: HTMLElement | null = null;
    document.documentElement.dataset.focusInput ??= 'pointer';
    const hide = () => { clearTimeout(timer); target = null; touch = null; setHint(null); };
    const find = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tooltip]') : null;
    const schedule = (element: HTMLElement | null, delay: number) => {
      hide();
      if (!element?.dataset.tooltip || element.closest('[role="menu"]')) return;
      target = element;
      timer = setTimeout(() => {
        if (element.isConnected && !menuOpen.current && (!element.closest('dialog') || element.closest('dialog')?.open)) {
          setHint({ text: element.dataset.tooltip!, target: element });
          if (touch) held = element;
        }
      }, delay);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
      const element = find(event); if (element !== target) schedule(element, 450);
    };
    const focus = (event: FocusEvent) => {
      if (document.documentElement.dataset.focusInput === 'keyboard') schedule(find(event), 200);
    };
    const down = (event: PointerEvent) => {
      document.documentElement.dataset.focusInput = 'pointer';
      clearTimeout(clickTimer); held = null; hide();
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      schedule(find(event), 550);
      if (target) touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (touch?.id === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) hide();
    };
    const up = () => { hide(); clickTimer = setTimeout(() => { held = null; }, 400); };
    const leave = (event: PointerEvent) => { if (!(event.relatedTarget instanceof Node) || !target?.contains(event.relatedTarget)) hide(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
      if (navigationKeys.has(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) document.documentElement.dataset.focusInput = 'keyboard';
    };
    const click = (event: MouseEvent) => {
      if (held && event.target instanceof Node && held.contains(event.target)) { event.preventDefault(); event.stopPropagation(); held = null; }
    };
    const context = (event: MouseEvent) => {
      if (touch && target && event.target instanceof Node && target.contains(event.target)) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('pointerover', over); document.addEventListener('focusin', focus);
    document.addEventListener('pointerdown', down, true); document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up); document.addEventListener('pointercancel', hide);
    document.addEventListener('pointerout', leave); document.addEventListener('focusout', hide);
    document.addEventListener('keydown', key, true); document.addEventListener('click', click, true); document.addEventListener('contextmenu', context, true);
    document.addEventListener('scroll', hide, true); window.addEventListener('blur', hide); window.addEventListener('resize', hide);
    return () => {
      clearTimeout(timer); clearTimeout(clickTimer);
      document.removeEventListener('pointerover', over); document.removeEventListener('focusin', focus);
      document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', hide);
      document.removeEventListener('pointerout', leave); document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', key, true); document.removeEventListener('click', click, true); document.removeEventListener('contextmenu', context, true);
      document.removeEventListener('scroll', hide, true); window.removeEventListener('blur', hide); window.removeEventListener('resize', hide);
    };
  }, [scope]);
  useEffect(() => { setHint(null); }, [scope]);
  return { hint, setHint, menuOpen };
}
