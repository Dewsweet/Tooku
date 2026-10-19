import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Profiles {
  avatars: Record<string, string>;
  setAvatar: (identity: string, image?: string) => void;
}
export const useProfiles = create<Profiles>()(persist((set) => ({
  avatars: {},
  setAvatar: (identity, image) => set((s) => {
    const avatars = { ...s.avatars }; if (image) avatars[identity] = image; else delete avatars[identity];
    return { avatars };
  }),
}), { name: 'tooku-profiles', version: 1 }));
