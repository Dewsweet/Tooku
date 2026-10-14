import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { emptyLibraryProfile, reparentFolder, removeFolder, useLibrary, playlistPlacement } from '../src/state/library';
afterEach(() => { vi.unstubAllGlobals(); useLibrary.setState({ profiles: {} }); });
it('normalizes numeric library IDs and scopes browsing/search/favorites requests', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ 'subsonic-response': { status: 'ok', musicFolders: { musicFolder: [{ id: 1, name: '散歌' }, { id: 8, name: '专辑' }] } } }))));
  vi.stubGlobal('fetch', fetch); const api = new MusicApi('https://example.test', 'fixture', 'test');
  expect(await api.libraries()).toEqual([{ id: '1', name: '散歌' }, { id: '8', name: '专辑' }]);
  await api.albums('newest', 0, undefined, '8'); await api.artists(undefined, '8'); await api.search('song', 0, undefined, '8'); await api.favorites(undefined, '8');
  for (const [url] of fetch.mock.calls.slice(1)) expect(new URL(url).searchParams.get('musicFolderId')).toBe('8');
});
it('isolates playlist placements by account and library, and rejects folders in another library', () => {
  const store = useLibrary.getState(); store.change('a', () => ({ ...emptyLibraryProfile, folders: [{ id: 'f', name: '华语', libraryId: '1', parentId: null }] }));
  store.place('a', 'p', '1', 'f'); store.place('b', 'p', '2', null); store.place('a', 'bad', '2', 'f');
  expect(useLibrary.getState().profiles.a.placements.p.libraryId).toBe('1'); expect(useLibrary.getState().profiles.b.placements.p.libraryId).toBe('2');
  expect(useLibrary.getState().profiles.a.placements.bad).toBeUndefined();
  expect(playlistPlacement(emptyLibraryProfile, 'legacy', '1')).toEqual({ libraryId: '1', folderId: null });
});
it('prevents folder cycles and preserves children and playlist placements when removing a folder', () => {
  const profile = { ...emptyLibraryProfile, folders: [{ id: 'parent', name: '语言', libraryId: '1', parentId: null }, { id: 'child', name: '华语', libraryId: '1', parentId: 'parent' }], placements: { p: { libraryId: '1', folderId: 'parent' } } };
  expect(reparentFolder(profile, 'parent', 'child')).toBe(profile);
  const after = removeFolder(profile, 'parent'); expect(after.folders[0].parentId).toBeNull(); expect(after.placements.p).toEqual({ libraryId: '1', folderId: null });
});
