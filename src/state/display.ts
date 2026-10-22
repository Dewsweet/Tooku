import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const baseFontSizes = [13, 14, 16, 18] as const;
export type BaseFontSize = typeof baseFontSizes[number];
export const normalizeBaseFontSize = (value: unknown): BaseFontSize => baseFontSizes.find((size) => size === value) ?? 14;
const systemSans = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Yu Gothic", sans-serif';
const systemSerif = 'ui-serif, "Songti SC", "Noto Serif CJK SC", SimSun, "Yu Mincho", "Times New Roman", serif';
export const fontFamilies = [
  { id: 'source-sans', name: '思源黑体', css: `'Tooku Source Han Sans', ${systemSans}` },
  { id: 'source-serif', name: '思源宋体', css: `'Tooku Source Han Serif', ${systemSerif}` },
  { id: 'system-sans', name: '系统黑体', css: systemSans },
  { id: 'system-serif', name: '系统宋体', css: systemSerif },
] as const;
export type FontFamily = typeof fontFamilies[number]['id'];
export const normalizeFontFamily = (value: unknown): FontFamily => fontFamilies.find((font) => font.id === value)?.id ?? 'source-sans';
export const fontFamilyCss = (value: unknown) => fontFamilies.find((font) => font.id === value)?.css ?? fontFamilies[0].css;
interface DisplayPreferences { baseFontSize: BaseFontSize; fontFamily: FontFamily; setBaseFontSize: (value: number) => void; setFontFamily: (value: string) => void }

// Text size follows this browser/display; it is intentionally outside account sync and backups.
export const useDisplayPreferences = create<DisplayPreferences>()(persist((set) => ({
  baseFontSize: 14,
  fontFamily: 'source-sans',
  setBaseFontSize: (value) => set({ baseFontSize: normalizeBaseFontSize(value) }),
  setFontFamily: (value) => set({ fontFamily: normalizeFontFamily(value) }),
}), {
  name: 'tooku-display', version: 1,
  partialize: ({ baseFontSize, fontFamily }) => ({ baseFontSize, fontFamily }),
  merge: (stored, current) => ({ ...current,
    baseFontSize: normalizeBaseFontSize(stored && typeof stored === 'object' && 'baseFontSize' in stored ? stored.baseFontSize : undefined),
    fontFamily: normalizeFontFamily(stored && typeof stored === 'object' && 'fontFamily' in stored ? stored.fontFamily : undefined),
  }),
}));
