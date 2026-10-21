import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultRecommendationSettings, emptyRecommendationCredentials, isRecommendationProfile, recommendationRecord, type RecommendationCredentials, type RecommendationProfile } from '../domain/recommendations';
import { useSession } from './session';

interface Profiles {
  profiles: Record<string, RecommendationProfile>;
  update: (identity: string, change: (profile: RecommendationProfile) => RecommendationProfile) => void;
  apply: (identity: string, profile?: RecommendationProfile) => void;
}
export const useRecommendationProfiles = create<Profiles>()(persist((set) => ({
  profiles: {},
  update: (identity, change) => set((s) => { const value = change(s.profiles[identity] ?? { settings: defaultRecommendationSettings }); return isRecommendationProfile(value) ? { profiles: { ...s.profiles, [identity]: value } } : {}; }),
  apply: (identity, profile) => set((s) => { const profiles = { ...s.profiles }; if (profile && isRecommendationProfile(profile)) profiles[identity] = profile; else delete profiles[identity]; return { profiles }; }),
}), { name: 'tooku-recommendations', version: 1, partialize: (s) => ({ profiles: s.profiles }), merge: (stored, current) => {
  const profiles: Record<string, RecommendationProfile> = {};
  if (recommendationRecord(stored) && recommendationRecord(stored.profiles)) for (const [key, value] of Object.entries(stored.profiles)) if (isRecommendationProfile(value)) profiles[key] = value;
  return { ...current, profiles };
} }));

interface Secrets { identity: string; credentials: RecommendationCredentials; revision: number; update: (identity: string, patch: Partial<RecommendationCredentials>) => void; clear: () => void }
// Deliberately separate from persist, sync, snapshots and query keys.
export const useRecommendationSecrets = create<Secrets>((set) => ({
  identity: '', credentials: { ...emptyRecommendationCredentials }, revision: 0,
  update: (identity, patch) => set((s) => ({ identity, credentials: { ...(s.identity === identity ? s.credentials : emptyRecommendationCredentials), ...patch }, revision: s.revision + 1 })),
  clear: () => set((s) => ({ identity: '', credentials: { ...emptyRecommendationCredentials }, revision: s.revision + 1 })),
}));
const unsubscribe = useSession.subscribe((next, previous) => { if (next.api !== previous.api) useRecommendationSecrets.getState().clear(); });
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
