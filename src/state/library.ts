import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useQuery } from '@tanstack/react-query';
import { useSession } from './session';
import { useEffect } from 'react';
import type { MusicLibrary } from '../domain/models';
const noLibraries: MusicLibrary[] = [];

export interface PlaylistFolder { id: string; name: string; libraryId: string; parentId: string | null }
export interface Placement { libraryId: string; folderId: string | null }
export interface LibraryProfile {
  activeId?: string; defaultId?: string; folders: PlaylistFolder[]; placements: Record<string, Placement>;
  views: Record<string, 'playlists' | 'songs' | 'albums'>;
}
export const emptyLibraryProfile: LibraryProfile = { folders: [], placements: {}, views: {} };
export function descendants(folders: PlaylistFolder[], id: string): Set<string> {
  const result = new Set([id]); let changed = true;
  while (changed) { changed = false; for (const folder of folders) if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) { result.add(folder.id); changed = true; } }
  return result;
}
export function reparentFolder(profile: LibraryProfile, id: string, parentId: string | null): LibraryProfile {
  const folder = profile.folders.find((f) => f.id === id); const parent = profile.folders.find((f) => f.id === parentId);
  if (!folder || parentId && (!parent || parent.libraryId !== folder.libraryId || descendants(profile.folders, id).has(parentId))) return profile;
  return { ...profile, folders: profile.folders.map((f) => f.id === id ? { ...f, parentId } : f) };
}
export function removeFolder(profile: LibraryProfile, id: string): LibraryProfile {
  const folder = profile.folders.find((f) => f.id === id); if (!folder) return profile;
  return { ...profile, folders: profile.folders.filter((f) => f.id !== id).map((f) => f.parentId === id ? { ...f, parentId: folder.parentId } : f),
    placements: Object.fromEntries(Object.entries(profile.placements).map(([key, value]) => [key, value.folderId === id ? { ...value, folderId: folder.parentId } : value])) };
}
interface LibraryState {
  profiles: Record<string, LibraryProfile>;
  change: (identity: string, transform: (profile: LibraryProfile) => LibraryProfile) => void;
  place: (identity: string, playlistId: string, libraryId: string, folderId: string | null) => void;
}
export const useLibrary = create<LibraryState>()(persist((set) => ({
  profiles: {},
  change: (identity, transform) => set((state) => ({ profiles: { ...state.profiles, [identity]: transform(state.profiles[identity] ?? emptyLibraryProfile) } })),
  place: (identity, playlistId, libraryId, folderId) => set((state) => {
    const profile = state.profiles[identity] ?? emptyLibraryProfile;
    const valid = folderId === null || profile.folders.some((f) => f.id === folderId && f.libraryId === libraryId);
    if (!valid) return state;
    return { profiles: { ...state.profiles, [identity]: { ...profile, placements: { ...profile.placements, [playlistId]: { libraryId, folderId } } } } };
  }),
}), { name: 'tooku-library-organization', version: 1 }));

export function useMusicLibrary() {
  const api = useSession((s) => s.api);
  const profile = useLibrary((s) => api ? s.profiles[api.identity] ?? emptyLibraryProfile : emptyLibraryProfile);
  const query = useQuery({ queryKey: [api?.identity, 'libraries'], enabled: Boolean(api), queryFn: ({ signal }) => api!.libraries(signal) });
  const libraries = query.data ?? noLibraries;
  const active = libraries.find((l) => l.id === profile.activeId) ?? libraries[0];
  useEffect(() => {
    if (api && libraries.length && !profile.defaultId) useLibrary.getState().change(api.identity, (p) => p.defaultId ? p : { ...p, defaultId: libraries[0].id });
  }, [api, libraries, profile.defaultId]);
  return { ...query, libraries, active, libraryId: active?.id, defaultId: profile.defaultId ?? libraries[0]?.id, profile };
}
export function playlistPlacement(profile: LibraryProfile, playlistId: string, defaultId: string): Placement {
  return profile.placements[playlistId] ?? { libraryId: defaultId, folderId: null };
}
