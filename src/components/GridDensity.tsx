import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Select } from './Select';
import { gridColumnOptions, useDisplayPreferences } from '../state/display';
import './grid-density.css';
import { mobileLayoutQuery, useMediaQuery } from './useMediaQuery';

export type GridKind = 'albums' | 'artists';
export function gridColumnLimit(width: number) {
  if (!Number.isFinite(width) || width <= 0) return 8;
  if (width <= 420) return 2;
  if (width <= 640) return 3;
  if (width <= 840) return 4;
  if (width <= 1040) return 5;
  if (width <= 1240) return 6;
  return 8;
}
export function GridDensitySelect({ kind }: { kind: GridKind }) {
  const columns = useDisplayPreferences((state) => state.gridColumns[kind]);
  const setColumns = useDisplayPreferences((state) => state.setGridColumns);
  const mobile = useMediaQuery(mobileLayoutQuery);
  const anchor = useRef<HTMLSpanElement>(null); const [limit, setLimit] = useState(8);
  useLayoutEffect(() => {
    if (mobile) return;
    const layout = anchor.current?.closest<HTMLElement>(`[data-density-layout="${kind}"]`);
    if (!layout) return;
    const measure = () => setLimit(gridColumnLimit(layout.getBoundingClientRect().width || layout.clientWidth));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(layout);
    return () => observer?.disconnect();
  }, [kind, mobile]);
  if (mobile) return null;
  const effective = Math.min(columns, limit); const constrained = effective !== columns;
  const options = limit < gridColumnOptions[0] ? [limit, ...gridColumnOptions] : gridColumnOptions;
  return <span className="grid-density-control" ref={anchor}><Select aria-label={`${kind === 'albums' ? '专辑' : '歌手'}每行数量`} value={String(effective)} disabled={limit <= gridColumnOptions[0]} onChange={(value) => setColumns(kind, Number(value))}>
    {options.map((count) => <option key={count} value={count} disabled={count > limit}>每行 {count} 个{constrained && count === effective ? '（当前宽度）' : ''}</option>)}
  </Select></span>;
}
export function DensityGrid({ kind, children }: { kind: GridKind; children: ReactNode }) {
  const columns = useDisplayPreferences((state) => state.gridColumns[kind]);
  return <div className="density-grid-container" data-grid-kind={kind} style={{ '--grid-columns': columns } as CSSProperties}>{children}</div>;
}
