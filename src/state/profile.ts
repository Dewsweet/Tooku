import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Profiles {
  avatars: Record<string, string>;
  playlistCovers: Record<string, Record<string, string>>;
  setAvatar: (identity: string, image?: string) => void;
  setPlaylistCover: (identity: string, id: string, image?: string) => void;
}
export const useProfiles = create<Profiles>()(persist((set) => ({
  avatars: {}, playlistCovers: {},
  setAvatar: (identity, image) => set((s) => {
    const avatars = { ...s.avatars }; if (image) avatars[identity] = image; else delete avatars[identity];
    return { avatars };
  }),
  setPlaylistCover: (identity, id, image) => set((s) => {
    const covers = { ...s.playlistCovers?.[identity] }; if (image) covers[id] = image; else delete covers[id];
    return { playlistCovers: { ...s.playlistCovers, [identity]: covers } };
  }),
}), { name: 'tooku-profiles', version: 1 }));
