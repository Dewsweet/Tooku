import type { CSSProperties, ReactNode } from 'react';
import { Select } from './Select';
import { gridColumnOptions, useDisplayPreferences } from '../state/display';
import './grid-density.css';

export type GridKind = 'albums' | 'artists';
export function GridDensitySelect({ kind }: { kind: GridKind }) {
  const columns = useDisplayPreferences((state) => state.gridColumns[kind]);
  const setColumns = useDisplayPreferences((state) => state.setGridColumns);
  return <Select aria-label={`${kind === 'albums' ? '专辑' : '歌手'}每行数量`} value={String(columns)} onChange={(value) => setColumns(kind, Number(value))}>
    {gridColumnOptions.map((count) => <option key={count} value={count}>每行 {count} 个</option>)}
  </Select>;
}
export function DensityGrid({ kind, children }: { kind: GridKind; children: ReactNode }) {
  const columns = useDisplayPreferences((state) => state.gridColumns[kind]);
  return <div className="density-grid-container" style={{ '--grid-columns': columns } as CSSProperties}>{children}</div>;
}
