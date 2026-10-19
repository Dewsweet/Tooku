import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const panelSectionNames = { cover: '封面', lyrics: '歌词', details: '歌曲详情', queue: '播放队列' } as const;
export type PanelSectionId = keyof typeof panelSectionNames;
export interface PanelSection { id: PanelSectionId; enabled: boolean }
export const normalizePanelWidth = (width: number) => Math.min(560, Math.max(280, Number.isFinite(width) ? width : 328));
export const panelWidthCss = (width: number) => `min(${normalizePanelWidth(width)}px, max(280px, calc(100vw - 782px)))`;
export const defaultPanelSections: PanelSection[] = [
  { id: 'cover', enabled: true }, { id: 'lyrics', enabled: true }, { id: 'details', enabled: true }, { id: 'queue', enabled: true },
];
export function normalizePanelSections(value: unknown): PanelSection[] {
  if (!Array.isArray(value)) return defaultPanelSections.map((s) => ({ ...s }));
  const seen = new Set<string>(); const sections: PanelSection[] = [];
  for (const item of value) {
    if (item && typeof item === 'object' && Object.hasOwn(panelSectionNames, item.id) && !seen.has(item.id)) {
      seen.add(item.id); sections.push({ id: item.id, enabled: item.enabled !== false });
    }
  }
  return [...sections, ...defaultPanelSections.filter((s) => !seen.has(s.id)).map((s) => ({ ...s }))];
}

interface Preferences {
  theme: 'light' | 'dark'; accent: string; sidePanel: boolean; panelWidth: number; panelSections: PanelSection[]; lyricSize: number; lyricDelay: number; reducedMotion: boolean; shortcuts: boolean;
  update: (patch: Partial<Omit<Preferences, 'update'>>) => void;
}
export const usePreferences = create<Preferences>()(persist((set) => ({
  theme: 'light', accent: '#c83e55', sidePanel: true, panelWidth: 328, panelSections: defaultPanelSections, lyricSize: 30, lyricDelay: 0, reducedMotion: false, shortcuts: true,
  update: (patch) => set(patch),
}), { name: 'tooku-preferences', version: 1 }));
