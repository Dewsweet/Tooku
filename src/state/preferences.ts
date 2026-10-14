import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Preferences {
  theme: 'light' | 'dark'; accent: string; sidePanel: boolean; lyricSize: number; lyricDelay: number; reducedMotion: boolean; shortcuts: boolean;
  update: (patch: Partial<Omit<Preferences, 'update'>>) => void;
}
export const usePreferences = create<Preferences>()(persist((set) => ({
  theme: 'light', accent: '#c83e55', sidePanel: true, lyricSize: 30, lyricDelay: 0, reducedMotion: false, shortcuts: true,
  update: (patch) => set(patch),
}), { name: 'tooku-preferences', version: 1 }));
