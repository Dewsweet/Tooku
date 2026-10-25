import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { browserJsonStorage } from '../storage/browserStorage';

interface Profiles {
  avatars: Record<string, string>;
  playlistCovers: Record<string, Record<string, string>>;
  artistCovers: Record<string, Record<string, string>>;
  setAvatar: (identity: string, image?: string) => void;
  setPlaylistCover: (identity: string, id: string, image?: string) => void;
  setArtistCover: (identity: string, id: string, image?: string) => void;
}
export const useProfiles = create<Profiles>()(persist((set) => ({
  avatars: {}, playlistCovers: {}, artistCovers: {},
  setAvatar: (identity, image) => set((s) => {
    const avatars = { ...s.avatars }; if (image) avatars[identity] = image; else delete avatars[identity];
    return { avatars };
  }),
  setPlaylistCover: (identity, id, image) => set((s) => {
    const covers = { ...s.playlistCovers?.[identity] }; if (image) covers[id] = image; else delete covers[id];
    return { playlistCovers: { ...s.playlistCovers, [identity]: covers } };
  }),
  setArtistCover: (identity, id, image) => set((s) => {
    const covers = { ...s.artistCovers?.[identity] }; if (image) covers[id] = image; else delete covers[id];
    return { artistCovers: { ...s.artistCovers, [identity]: covers } };
  }),
}), { name: 'tooku-profiles', version: 1, storage: browserJsonStorage<Profiles>() }));
