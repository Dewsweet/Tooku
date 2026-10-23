import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { emptyLibraryProfile, reparentFolder, removeFolder, useLibrary, playlistPlacement, libraryItems, moveLibraryItem, toggleFolderCollapsed } from '../src/state/library';
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
it('keeps promoted folder names unique within the library and within the editor length limit', () => {
  const name = '长'.repeat(80);
  const profile = { ...emptyLibraryProfile, folders: [
    { id: 'parent', name: '父目录', libraryId: '1', parentId: null },
    { id: 'existing', name, libraryId: '1', parentId: null },
    { id: 'child', name, libraryId: '1', parentId: 'parent' },
    { id: 'another-library', name: '保留', libraryId: '2', parentId: null },
    { id: 'another-child', name: '保留', libraryId: '1', parentId: 'parent' },
  ] };
  const after = removeFolder(profile, 'parent');
  expect(after.folders.find((folder) => folder.id === 'child')?.name).toBe(`${name.slice(0, 77)}（2）`);
  expect(after.folders.find((folder) => folder.id === 'another-child')?.name).toBe('保留');
  expect(after.folders.every((folder) => folder.name.length <= 80)).toBe(true);
});
it('persists folding by account and folder across browser rehydration and cleans deleted folders', async () => {
  const profile = { ...emptyLibraryProfile, folders: [
    { id: 'parent', name: '语言', libraryId: '1', parentId: null },
    { id: 'child', name: '华语', libraryId: '1', parentId: 'parent' },
    { id: 'other', name: '其他库', libraryId: '2', parentId: null },
  ] };
  expect(toggleFolderCollapsed(profile, 'missing')).toBe(profile);
  useLibrary.getState().change('a', () => toggleFolderCollapsed(toggleFolderCollapsed(profile, 'parent'), 'child'));
  useLibrary.getState().change('b', () => profile);
  const cached = localStorage.getItem('tooku-library-organization')!;
  useLibrary.setState({ profiles: {} }); localStorage.setItem('tooku-library-organization', cached);
  await useLibrary.persist.rehydrate();
  expect(useLibrary.getState().profiles.a.collapsedFolders).toEqual(['child', 'parent']);
  expect(useLibrary.getState().profiles.b.collapsedFolders).toBeUndefined();
  const removed = removeFolder(useLibrary.getState().profiles.a, 'parent');
  expect(removed.collapsedFolders).toEqual(['child']);
  expect(removed.folders.find((f) => f.id === 'child')?.parentId).toBeNull();
  const opened = toggleFolderCollapsed(removed, 'child');
  expect(opened).not.toHaveProperty('collapsedFolders');
  expect(toggleFolderCollapsed(opened, 'other').collapsedFolders).toEqual(['other']);
});
it('orders folders and playlists together and preserves other library boundaries', () => {
  const lists = [{ id: 'p', name: '歌曲' }, { id: 'q', name: '其他曲库' }];
  const original = { ...emptyLibraryProfile, folders: [{ id: 'f', name: '文件夹', libraryId: '1', parentId: null }], placements: { q: { libraryId: '2', folderId: null } } };
  const reordered = moveLibraryItem(original, lists, 'playlist:p', '1', null, 'folder:f', '1');
  expect(libraryItems(reordered, lists, '1', null, '1').map((i) => i.key)).toEqual(['playlist:p', 'folder:f']);
  const nested = moveLibraryItem(reordered, lists, 'playlist:p', '1', 'f', null, '1');
  expect(libraryItems(nested, lists, '1', 'f', '1').map((i) => i.key)).toEqual(['playlist:p']);
  expect(nested.placements.q).toEqual({ libraryId: '2', folderId: null });
  expect(moveLibraryItem(nested, lists, 'playlist:q', '1', 'f', null, '1')).toBe(nested);
});
it('rejects a folder drop into its descendant, unknown folders, and duplicate sibling names', () => {
  const profile = { ...emptyLibraryProfile, folders: [
    { id: 'a', name: '流行', libraryId: '1', parentId: null }, { id: 'b', name: '子级', libraryId: '1', parentId: 'a' },
    { id: 'c', name: '流行', libraryId: '1', parentId: 'b' },
  ] };
  expect(moveLibraryItem(profile, [], 'folder:a', '1', 'b', null, '1')).toBe(profile);
  expect(moveLibraryItem(profile, [], 'folder:c', '1', null, null, '1')).toBe(profile);
  expect(moveLibraryItem(profile, [], 'folder:b', '1', 'missing', null, '1')).toBe(profile);
});
it('filters an artist with albums in multiple libraries using paged library boundaries', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({'subsonic-response':{status:'ok',artist:{name:'共享歌手',album:[{id:'a',name:'第一库专辑'},{id:'b',name:'第二库专辑'}]}}}))).mockResolvedValueOnce(new Response(JSON.stringify({'subsonic-response':{status:'ok',albumList2:{album:[{id:'b',name:'第二库专辑'}]}}})));
  vi.stubGlobal('fetch',fetch); const result = await new MusicApi('https://example.test','fixture','test').artist('artist',undefined,'2');
  expect(result.albums.map((a) => a.id)).toEqual(['b']); expect(new URL(fetch.mock.calls[1][0]).searchParams.get('musicFolderId')).toBe('2');
});
