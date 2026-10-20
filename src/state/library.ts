import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useQuery } from '@tanstack/react-query';
import { useSession } from './session';
import { useEffect } from 'react';
import type { MusicLibrary, Playlist } from '../domain/models';
const noLibraries: MusicLibrary[] = [];

export interface PlaylistFolder { id: string; name: string; libraryId: string; parentId: string | null }
export interface Placement { libraryId: string; folderId: string | null }
export interface LibraryProfile {
  activeId?: string; defaultId?: string; folders: PlaylistFolder[]; placements: Record<string, Placement>;
  views: Record<string, 'playlists' | 'songs' | 'albums'>;
  order?: Record<string, string[]>;
  collapsedFolders?: string[];
}
export const emptyLibraryProfile: LibraryProfile = { folders: [], placements: {}, views: {} };
export function toggleFolderCollapsed(profile: LibraryProfile, id: string): LibraryProfile {
  if (!profile.folders.some((folder) => folder.id === id)) return profile;
  const closed = new Set(profile.collapsedFolders ?? []);
  if (closed.has(id)) closed.delete(id); else closed.add(id);
  const { collapsedFolders: previous, ...rest } = profile;
  return closed.size ? { ...rest, collapsedFolders: [...closed].sort() } : previous ? rest : profile;
}
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
  const { collapsedFolders, ...rest } = profile;
  const remaining = collapsedFolders?.filter((closed) => closed !== id);
  return { ...rest, ...(remaining?.length ? { collapsedFolders: remaining } : {}), folders: profile.folders.filter((f) => f.id !== id).map((f) => f.parentId === id ? { ...f, parentId: folder.parentId } : f),
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

export type LibraryItem = { key: string; kind: 'folder'; folder: PlaylistFolder } | { key: string; kind: 'playlist'; playlist: Playlist };
export const orderKey = (libraryId: string, parentId: string | null) => JSON.stringify([libraryId, parentId]);
export function libraryItems(profile: LibraryProfile, playlists: Playlist[], libraryId: string, parentId: string | null, defaultId: string): LibraryItem[] {
  const items: LibraryItem[] = [
    ...profile.folders.filter((f) => f.libraryId === libraryId && f.parentId === parentId).map((folder) => ({ key: `folder:${folder.id}`, kind: 'folder' as const, folder })),
    ...playlists.filter((p) => { const at = playlistPlacement(profile, p.id, defaultId); return at.libraryId === libraryId && at.folderId === parentId; }).map((playlist) => ({ key: `playlist:${playlist.id}`, kind: 'playlist' as const, playlist })),
  ];
  const order = profile.order?.[orderKey(libraryId, parentId)] ?? []; const rank = new Map(order.map((key, index) => [key, index]));
  return items.sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity));
}
export function moveLibraryItem(profile: LibraryProfile, playlists: Playlist[], key: string, libraryId: string, parentId: string | null, before: string | null, defaultId: string): LibraryProfile {
  if (before === key) return profile;
  if (parentId && !profile.folders.some((f) => f.id === parentId && f.libraryId === libraryId)) return profile;
  let next: LibraryProfile;
  if (key.startsWith('folder:')) {
    const id = key.slice(7); const folder = profile.folders.find((f) => f.id === id && f.libraryId === libraryId);
    if (!folder || parentId && descendants(profile.folders, id).has(parentId) || profile.folders.some((f) => f.id !== id && f.libraryId === libraryId && f.parentId === parentId && f.name === folder?.name)) return profile;
    next = reparentFolder(profile, id, parentId);
  } else if (key.startsWith('playlist:')) {
    const id = key.slice(9); if (!playlists.some((p) => p.id === id) || playlistPlacement(profile, id, defaultId).libraryId !== libraryId) return profile;
    next = { ...profile, placements: { ...profile.placements, [id]: { libraryId, folderId: parentId } } };
  } else return profile;
  const siblings = libraryItems(next, playlists, libraryId, parentId, defaultId).map((item) => item.key).filter((item) => item !== key);
  const index = before ? siblings.indexOf(before) : -1; siblings.splice(index < 0 ? siblings.length : index, 0, key);
  return { ...next, order: { ...next.order, [orderKey(libraryId, parentId)]: siblings } };
}
export function folderPath(folders: PlaylistFolder[], id: string): string {
  const parts: string[] = []; const visited = new Set(); let current = folders.find((f) => f.id === id);
  while (current && !visited.has(current.id)) { visited.add(current.id); parts.unshift(current.name); current = folders.find((f) => f.id === current!.parentId); }
  return parts.join(' / ');
}
