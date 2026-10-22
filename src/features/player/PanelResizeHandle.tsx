import { useEffect, useRef } from 'react';
import { normalizePanelWidth, panelWidthCss, usePreferences } from '../../state/preferences';

export function PanelResizeHandle() {
  const width = usePreferences((s) => s.panelWidth); const start = useRef<{ x: number; width: number; value: number; root: HTMLElement; css: string } | null>(null);
  const finish = (save: boolean) => {
    const item = start.current; if (!item) return;
    if (save) { usePreferences.getState().update({ panelWidth: item.value }); item.root.style.setProperty('--panel-width', panelWidthCss(item.value)); }
    else item.root.style.setProperty('--panel-width', item.css);
    document.documentElement.classList.remove('is-resizing-panel'); start.current = null;
  };
  useEffect(() => () => { const item = start.current; if (item) item.root.style.setProperty('--panel-width', item.css); document.documentElement.classList.remove('is-resizing-panel'); }, []);
  return <div className="panel-resize-handle" role="separator" aria-label="调整播放侧栏宽度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={560} aria-valuenow={normalizePanelWidth(width)} tabIndex={0} onDoubleClick={() => usePreferences.getState().update({ panelWidth: 328 })} onPointerDown={(e) => {
    const root = e.currentTarget.closest<HTMLElement>('.workspace-shell'); const aside = root?.querySelector('.now-panel'); if (!aside || !root) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const current = aside.getBoundingClientRect().width;
    start.current = { x: e.clientX, width: current, value: current, root, css: root.style.getPropertyValue('--panel-width') }; document.documentElement.classList.add('is-resizing-panel');
  }} onPointerMove={(e) => { const item = start.current; if (!item) return; item.value = Math.min(normalizePanelWidth(item.width + item.x - e.clientX), Math.max(280, window.innerWidth - 782)); item.root.style.setProperty('--panel-width', `${item.value}px`); }} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onKeyDown={(e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); usePreferences.getState().update({ panelWidth: normalizePanelWidth(width + (e.key === 'ArrowLeft' ? 16 : -16)) }); }
    if (e.key === 'Home') { e.preventDefault(); usePreferences.getState().update({ panelWidth: 328 }); }
  }} />;
}
