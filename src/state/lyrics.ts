import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultLyricsSettings, isLyricsSettings, type LyricChoice, type LyricsSettings } from '../domain/lyrics/types';
import { browserJsonStorage } from '../storage/browserStorage';

interface LyricsProfiles {
  profiles: Record<string, LyricsSettings>;
  refreshes: Record<string, number>;
  refresh: (identity: string, id: string) => void;
  update: (identity: string, change: (settings: LyricsSettings) => LyricsSettings) => void;
  apply: (identity: string, settings?: LyricsSettings) => void;
}
type PersistedLyricsProfiles = Pick<LyricsProfiles, 'profiles'>;
export const useLyricsProfiles = create<LyricsProfiles>()(persist((set) => ({
  profiles: {}, refreshes: {},
  refresh: (identity, id) => set((s) => { const key = JSON.stringify([identity, id]); return { refreshes: { ...s.refreshes, [key]: (s.refreshes[key] ?? 0) + 1 } }; }),
  update: (identity, change) => set((s) => { const settings = change(s.profiles[identity] ?? defaultLyricsSettings); return isLyricsSettings(settings) ? { profiles: { ...s.profiles, [identity]: settings } } : {}; }),
  apply: (identity, settings) => set((s) => { const profiles = { ...s.profiles }; if (settings && isLyricsSettings(settings)) profiles[identity] = settings; else delete profiles[identity]; return { profiles }; }),
}), { name: 'tooku-lyrics', version: 1, storage: browserJsonStorage<PersistedLyricsProfiles>(), partialize: (state) => ({ profiles: state.profiles }), merge: (stored, current) => {
  const profiles = stored && typeof stored === 'object' && 'profiles' in stored && stored.profiles && typeof stored.profiles === 'object' ? Object.fromEntries(Object.entries(stored.profiles).filter(([, v]) => isLyricsSettings(v))) : {};
  return { ...current, profiles };
} }));
export function updateLyricChoice(identity: string, id: string, patch: Partial<LyricChoice>) {
  useLyricsProfiles.getState().update(identity, (s) => ({ ...s, tracks: { ...s.tracks, [id]: { ...s.tracks[id], mode: s.tracks[id]?.mode ?? 'local', ...patch } } }));
}
