import { afterEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { playlistPermissions } from '../src/domain/playlistPermissions';

afterEach(() => vi.restoreAllMocks());
it('honors explicit writable responses, compares legacy owner names and separates server-managed tracks', () => {
  expect(playlistPermissions({ id: 'p', name: '歌单', owner: 'other' }, 'fixture')).toEqual({ canEdit: false, canReorder: false });
  expect(playlistPermissions({ id: 'p', name: '歌单', owner: 'FIXTURE' }, 'fixture')).toEqual({ canEdit: true, canReorder: true });
  expect(playlistPermissions({ id: 'p', name: '歌单', owner: 'other', readonly: false }, 'fixture')).toEqual({ canEdit: true, canReorder: true });
  expect(playlistPermissions({ id: 'p', name: '歌单', owner: 'fixture', readonly: true }, 'fixture')).toEqual({ canEdit: true, canReorder: false });
});

it('preserves the server readonly flag and refuses a track write after a readonly preflight read', async () => {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  const request = vi.spyOn(api, 'request').mockResolvedValue({ playlist: { id: 'p', name: '同步歌单', owner: 'fixture', changed: 'v1', readonly: true, entry: [{ id: 'a' }] } });
  expect((await api.playlist('p')).readonly).toBe(true);
  request.mockClear();
  await expect(api.savePlaylist('p', '同步歌单', ['a'], 'v1')).rejects.toMatchObject({ code: 50 });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('getPlaylist', { id: 'p' }, undefined);
  api.dispose();
});
