import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const baseFontSizes = [13, 14, 16, 18] as const;
export type BaseFontSize = typeof baseFontSizes[number];
export const normalizeBaseFontSize = (value: unknown): BaseFontSize => baseFontSizes.find((size) => size === value) ?? 14;

// Text size follows this browser/display; it is intentionally outside account sync and backups.
export const useDisplayPreferences = create<{ baseFontSize: BaseFontSize; setBaseFontSize: (value: number) => void }>()(persist((set) => ({
  baseFontSize: 14,
  setBaseFontSize: (value) => set({ baseFontSize: normalizeBaseFontSize(value) }),
}), {
  name: 'tooku-display', version: 1,
  partialize: ({ baseFontSize }) => ({ baseFontSize }),
  merge: (stored, current) => ({ ...current, baseFontSize: normalizeBaseFontSize(stored && typeof stored === 'object' && 'baseFontSize' in stored ? stored.baseFontSize : undefined) }),
}));
