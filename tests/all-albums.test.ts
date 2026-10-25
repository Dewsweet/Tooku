import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';

const api = new MusicApi('https://example.test', 'fixture', 'not-real');
afterEach(() => { vi.restoreAllMocks(); });
const page = Array.from({ length: 500 }, (_, index) => ({ id: `a-${index}`, name: `专辑 ${index}`, artist: '歌手' }));
it('stops repeated pages and deduplicates the completed album list', async () => {
  const request = vi.spyOn(api, 'request').mockResolvedValue({ albumList2: { album: page } });
  expect(await api.allAlbums()).toHaveLength(500);
  expect(request).toHaveBeenCalledTimes(2);
});
it('enumerates a stable library before shuffling random discovery', async () => {
  const request = vi.spyOn(api, 'request').mockResolvedValueOnce({ albumList2: { album: page } }).mockResolvedValueOnce({ albumList2: { album: [page[0], { id: 'last', name: '最后一张' }] } });
  const result = await api.allAlbums('random', undefined, 'library');
  expect(result).toHaveLength(501);
  expect(new Set(result.map((album) => album.id)).size).toBe(501);
  expect(request).toHaveBeenNthCalledWith(2, 'getAlbumList2', { type: 'alphabeticalByName', size: 500, offset: 500, musicFolderId: 'library' }, undefined);
});
it('does not swallow a cancelled library read', async () => {
  const request = new AbortController(); request.abort();
  vi.spyOn(api, 'request').mockRejectedValue(new DOMException('Aborted', 'AbortError'));
  await expect(api.allAlbums('newest', request.signal, 'old-library')).rejects.toMatchObject({ name: 'AbortError' });
});
