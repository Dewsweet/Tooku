import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultRecommendationSettings, emptyRecommendationCredentials, isRecommendationProfile, recommendationRecord, type RecommendationCredentials, type RecommendationProfile } from '../domain/recommendations';
import { useSession } from './session';
import type { CredentialStatus, SavedCredentials } from '../api/userData';
import type { MusicApi } from '../api/client';
import { browserJsonStorage } from '../storage/browserStorage';

interface Profiles {
  profiles: Record<string, RecommendationProfile>;
  update: (identity: string, change: (profile: RecommendationProfile) => RecommendationProfile) => void;
  apply: (identity: string, profile?: RecommendationProfile) => void;
}
type PersistedProfiles = Pick<Profiles, 'profiles'>;
export const useRecommendationProfiles = create<Profiles>()(persist((set) => ({
  profiles: {},
  update: (identity, change) => set((s) => { const value = change(s.profiles[identity] ?? { settings: defaultRecommendationSettings }); return isRecommendationProfile(value) ? { profiles: { ...s.profiles, [identity]: value } } : {}; }),
  apply: (identity, profile) => set((s) => { const profiles = { ...s.profiles }; if (profile && isRecommendationProfile(profile)) profiles[identity] = profile; else delete profiles[identity]; return { profiles }; }),
}), { name: 'tooku-recommendations', version: 1, storage: browserJsonStorage<PersistedProfiles>(), partialize: (s) => ({ profiles: s.profiles }), merge: (stored, current) => {
  const profiles: Record<string, RecommendationProfile> = {};
  if (recommendationRecord(stored) && recommendationRecord(stored.profiles)) for (const [key, value] of Object.entries(stored.profiles)) if (isRecommendationProfile(value)) profiles[key] = value;
  return { ...current, profiles };
} }));

const noSavedCredentials: SavedCredentials = { lastfmKey: false, aiKey: false, appleToken: false, spotifyClientId: false, spotifyClientSecret: false };
interface Secrets { identity: string; credentials: RecommendationCredentials; saved: SavedCredentials; savedRevision: number; revision: number; update: (identity: string, patch: Partial<RecommendationCredentials>) => void; acceptSaved: (identity: string, status: CredentialStatus, clearDraft?: boolean) => void; clear: () => void }
// Deliberately separate from persist, sync, snapshots and query keys.
export const useRecommendationSecrets = create<Secrets>((set) => ({
  identity: '', credentials: { ...emptyRecommendationCredentials }, saved: noSavedCredentials, savedRevision: 0, revision: 0,
  update: (identity, patch) => set((s) => ({ identity, credentials: { ...(s.identity === identity ? s.credentials : emptyRecommendationCredentials), ...patch }, ...(s.identity !== identity ? { saved: noSavedCredentials, savedRevision: 0 } : {}), revision: s.revision + 1 })),
  acceptSaved: (identity, status, clearDraft = false) => set((s) => s.identity === identity && status.revision < s.savedRevision ? {} : ({ identity, saved: status.saved, savedRevision: status.revision, credentials: !clearDraft && s.identity === identity ? s.credentials : { ...emptyRecommendationCredentials }, revision: s.revision + 1 })),
  clear: () => set((s) => ({ identity: '', credentials: { ...emptyRecommendationCredentials }, saved: noSavedCredentials, savedRevision: 0, revision: s.revision + 1 })),
}));
export async function loadSavedRecommendationCredentials(api: MusicApi) {
  if (!api.persistent) return;
  const client = await api.userData(); if (!client) return;
  const status = await client.credentials();
  if (useSession.getState().api === api) useRecommendationSecrets.getState().acceptSaved(api.identity, status);
}
const unsubscribe = useSession.subscribe((next, previous) => { if (next.api !== previous.api) useRecommendationSecrets.getState().clear(); });
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
