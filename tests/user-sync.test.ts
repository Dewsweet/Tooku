import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { UserDataApi, UserDataError } from '../src/api/userData';
import { usePreferences } from '../src/state/preferences';
import { useLibrary } from '../src/state/library';
import { useProfiles } from '../src/state/profile';
import { chooseUserData, connectUserSync, disconnectUserSync, localUserData, refreshUserSync, useUserSync } from '../src/storage/userSync';
import type { UserDocument } from '../src/domain/userData';

const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/storage/local', () => ({
  readProfile: vi.fn(async (identity: string, kind: string) => structuredClone(memory.get(`${identity}|${kind}`))),
  writeLocalData: vi.fn(async (identity: string, kind: string, data: unknown) => { memory.set(`${identity}|${kind}`, structuredClone(data)); return true; }),
  onProfileSave: vi.fn(() => () => {}),
}));
let remote: UserDocument;
let api: MusicApi;
let client: UserDataApi;
beforeEach(() => {
  vi.useFakeTimers(); memory.clear(); localStorage.clear();
  usePreferences.setState(usePreferences.getInitialState(), true);
  useLibrary.setState(useLibrary.getInitialState(), true); useProfiles.setState(useProfiles.getInitialState(), true);
  remote = { revision: 0, updatedAt: 0, data: null };
  api = new MusicApi(`${window.location.origin}/nd`, 'sample-user', crypto.randomUUID());
  client = new UserDataApi(); client.owner = 'verified-sample-owner';
  vi.spyOn(client, 'dispose').mockImplementation(() => {});
  vi.spyOn(api, 'userData').mockResolvedValue(client);
  vi.spyOn(client, 'read').mockImplementation(async () => structuredClone(remote));
  vi.spyOn(client, 'write').mockImplementation(async (revision, data) => {
    if (revision !== remote.revision) throw new UserDataError('conflict', 409);
    remote = { revision: revision + 1, updatedAt: Date.now(), data: structuredClone(data) }; return structuredClone(remote);
  });
});
afterEach(() => { disconnectUserSync(); api.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('user data migration and sync', () => {
  it('previews legacy data without uploading, retains consent across restarts, and preserves pre-import copies', async () => {
    useLibrary.getState().change(api.identity, () => ({ folders: [{ id: 'one', name: '旧目录', libraryId: 'music', parentId: null }], placements: {}, views: {} }));
    await connectUserSync(api); expect(useUserSync.getState().status).toBe('review');
    await vi.advanceTimersByTimeAsync(1000); expect(client.write).not.toHaveBeenCalled();
    disconnectUserSync(); await connectUserSync(api); await vi.advanceTimersByTimeAsync(1000);
    expect(useUserSync.getState().status).toBe('review'); expect(client.write).not.toHaveBeenCalled();
    await chooseUserData('local'); expect(remote.data?.organization.folders[0].name).toBe('旧目录');
    expect(memory.has(`${api.identity}|before-import`)).toBe(true); expect(useUserSync.getState().status).toBe('ready');
    disconnectUserSync(); await connectUserSync(api); expect(useUserSync.getState().status).toBe('ready');
  });
  it('stops on conflicts and resolves unknown writes by reading without replaying', async () => {
    await connectUserSync(api); await chooseUserData('local');
    remote = { ...remote, revision: remote.revision + 1 };
    usePreferences.getState().update({ theme: 'dark' }); await vi.advanceTimersByTimeAsync(900);
    expect(useUserSync.getState().status).toBe('conflict'); const writes = vi.mocked(client.write).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000); expect(client.write).toHaveBeenCalledTimes(writes);
    await refreshUserSync(); expect(useUserSync.getState().status).toBe('review');
    await chooseUserData('local'); expect(remote.data?.preferences.theme).toBe('dark');
    vi.mocked(client.write).mockImplementationOnce(async (revision, data) => { remote = { revision: revision + 1, updatedAt: Date.now(), data: structuredClone(data) }; throw new UserDataError('unknown result'); });
    usePreferences.getState().update({ lyricDelay: 100 }); await vi.advanceTimersByTimeAsync(900);
    expect(useUserSync.getState().status).toBe('offline'); const count = vi.mocked(client.write).mock.calls.length;
    await refreshUserSync(); expect(useUserSync.getState().status).toBe('ready'); expect(client.write).toHaveBeenCalledTimes(count);
  });
  it('keeps offline changes and isolates account preferences', async () => {
    await connectUserSync(api); await chooseUserData('local');
    usePreferences.getState().update({ theme: 'dark' }); await vi.advanceTimersByTimeAsync(900); disconnectUserSync();
    expect(usePreferences.getState().theme).toBe('light');
    vi.mocked(api.userData).mockRejectedValueOnce(new Error('offline'));
    await connectUserSync(api); expect(useUserSync.getState().status).toBe('offline'); expect(usePreferences.getState().theme).toBe('dark');
    usePreferences.getState().update({ lyricDelay: 500 }); disconnectUserSync(); await connectUserSync(api);
    await vi.advanceTimersByTimeAsync(900); expect(remote.data?.preferences.lyricDelay).toBe(500);
    disconnectUserSync();
    const other = new MusicApi(`${window.location.origin}/nd`, 'other-user', crypto.randomUUID()); vi.spyOn(other, 'userData').mockResolvedValue(null);
    await connectUserSync(other); expect(localUserData()?.preferences.theme).toBe('light'); expect(localUserData()?.preferences.lyricDelay).toBe(0); other.dispose();
  });
  it('does not apply stale server previews and preserves queue occurrences in restored snapshots', async () => {
    await connectUserSync(api); const local = localUserData()!;
    const track = { id: 'same-song', title: '重复歌曲', artist: '歌手' };
    remote = { revision: 1, updatedAt: Date.now(), data: { ...local, queue: { version: 1, entries: [{ entryId: 'one', track }, { entryId: 'two', track }], currentId: 'two', position: 12, repeat: 'all', volume: .5 } } };
    await refreshUserSync(); remote = { ...remote, revision: 2 };
    await expect(chooseUserData('server')).rejects.toThrow('重新预览');
    expect(localUserData()?.queue).toBeNull();
    await chooseUserData('server'); expect(memory.get(`${api.identity}|queue`)).toEqual(remote.data?.queue);
    expect(localUserData()?.queue?.entries).toHaveLength(2);
  });
  it('keeps visible local data when a backup restore is rejected or its result is unknown', async () => {
    await connectUserSync(api); await chooseUserData('local');
    const before = structuredClone(localUserData()!);
    const backup = { ...before, preferences: { ...before.preferences, theme: 'dark' as const } };
    vi.mocked(client.write).mockRejectedValueOnce(new UserDataError('conflict', 409));
    await expect(chooseUserData('local', backup)).rejects.toThrow('conflict');
    expect(localUserData()).toEqual(before);
    await refreshUserSync();
    vi.mocked(client.write).mockRejectedValueOnce(new UserDataError('unknown result'));
    await expect(chooseUserData('local', backup)).rejects.toThrow('unknown result');
    expect(localUserData()).toEqual(before);
  });
});
