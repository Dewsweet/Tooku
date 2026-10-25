import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { UserDataApi } from '../src/api/userData';
import { player, usePlayer } from '../src/features/player/engine';
import { chooseUserData, connectUserSync, disconnectUserSync, exportUserBackup, localUserData, refreshUserSync } from '../src/storage/userSync';
import { readProfile, saveProfile } from '../src/storage/local';
import { usePreferences } from '../src/state/preferences';
import { removeFolder, useLibrary } from '../src/state/library';
import { useProfiles } from '../src/state/profile';
import { isUserData, type UserDocument } from '../src/domain/userData';
import type { PlayerSnapshot } from '../src/domain/models';

const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb', () => ({ openDB: async () => ({ get: async (_store: string, key: string) => structuredClone(memory.get(key)), put: async (_store: string, value: unknown, key: string) => { memory.set(key, structuredClone(value)); } }) }));
class AudioFixture extends EventTarget {
  static current: AudioFixture;
  src = ''; currentSrc = ''; currentTime = 0; duration = 180; volume = .7; paused = true; seeking = false; ended = false;
  constructor() { super(); AudioFixture.current = this; }
  getAttribute() { return this.src; } removeAttribute() { this.src = ''; this.currentSrc = ''; } load() { this.currentSrc = this.src; }
  async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  tick(value: number) { this.currentTime = value; this.dispatchEvent(new Event('timeupdate')); }
}
let api: MusicApi;
let remote: UserDocument;
beforeEach(() => {
  vi.useFakeTimers(); memory.clear(); localStorage.clear();
  vi.stubGlobal('Audio', AudioFixture); vi.stubGlobal('BroadcastChannel', undefined);
  usePreferences.setState(usePreferences.getInitialState(), true); useLibrary.setState(useLibrary.getInitialState(), true); useProfiles.setState(useProfiles.getInitialState(), true);
  api = new MusicApi(`${window.location.origin}/nd`, 'synthetic-user', 'synthetic-password');
  const client = new UserDataApi(); client.owner = 'synthetic-owner';
  remote = { revision: 0, updatedAt: 0, data: null };
  vi.spyOn(api, 'userData').mockResolvedValue(client); vi.spyOn(api, 'scrobble').mockResolvedValue({});
  vi.spyOn(client, 'read').mockImplementation(async () => structuredClone(remote));
  vi.spyOn(client, 'write').mockImplementation(async (revision, data) => { remote = { revision: revision + 1, updatedAt: Date.now(), data: structuredClone(data) }; return structuredClone(remote); });
});
afterEach(() => { player.logout(); disconnectUserSync(); api.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['backup', 'server'] as const)('preserves a restored %s queue and history through pause, periodic saves, scrobbling and the next login', async (source) => {
  await connectUserSync(api); await player.attach(api);
  player.replace([{ id: 'old', title: '旧歌曲', artist: '歌手', duration: 180 }]);
  await vi.advanceTimersByTimeAsync(900);
  const restored = structuredClone(localUserData()!);
  restored.queue = { version: 1, entries: [{ entryId: 'restored-one', track: { id: 'new', title: '恢复歌曲', artist: '歌手' } }, { entryId: 'restored-two', track: { id: 'new', title: '恢复歌曲', artist: '歌手' } }], currentId: 'restored-two', position: 42, repeat: 'all', volume: .5 };
  restored.history = [{ occurrenceId: 'restored-history', track: restored.queue.entries[0].track, listenedAt: 1000, submitted: true }];
  if (source === 'server') { remote = { revision: remote.revision + 1, updatedAt: Date.now(), data: restored }; await refreshUserSync(); await chooseUserData('server'); }
  else await chooseUserData('local', restored);
  expect(usePlayer.getState().entries[0].track.id).toBe('old');
  for (let second = 1; second <= 100; second++) AudioFixture.current.tick(second);
  player.pause(); await vi.advanceTimersByTimeAsync(6000);
  expect((await readProfile<PlayerSnapshot>(api.identity, 'queue'))?.entries).toEqual(restored.queue.entries);
  expect(localUserData()?.queue).toEqual(restored.queue); expect(remote.data?.queue).toEqual(restored.queue);
  expect(remote.data?.history).toEqual(restored.history);
  disconnectUserSync(); player.logout(); await connectUserSync(api); await player.attach(api);
  expect(usePlayer.getState().entries).toEqual(restored.queue.entries); expect(usePlayer.getState().position).toBe(42); expect(usePlayer.getState().status).toBe('paused');
  player.persist(); await vi.advanceTimersByTimeAsync(900); expect(remote.data?.queue?.entries).toEqual(restored.queue.entries);
});

it('exports and restores direct-connection data without a Tooku session and isolates snapshot holds by account', async () => {
  api.dispose(); api = new MusicApi('https://direct.example.test', 'synthetic-user', 'synthetic-password');
  vi.spyOn(api, 'userData').mockResolvedValue(null);
  await connectUserSync(api);
  const backup = await exportUserBackup(); expect(backup.owner).toBe(`local:${api.identity}`);
  const restored = { ...backup.data, queue: { version: 1 as const, entries: [{ entryId: 'new', track: { id: 'song', title: '恢复歌曲', artist: '歌手' } }], currentId: 'new', position: 4, repeat: 'off' as const, volume: .7 } };
  await chooseUserData('local', restored);
  await saveProfile(api.identity, 'queue', { ...restored.queue, entries: [], currentId: null });
  await saveProfile('other-account', 'queue', restored.queue);
  expect((await exportUserBackup()).data.queue).toEqual(restored.queue);
  expect(await readProfile('other-account', 'queue')).toEqual(restored.queue);
  disconnectUserSync(); await connectUserSync(api);
  expect(localUserData()?.queue).toEqual(restored.queue);
});

it('renames colliding promoted folders deterministically and keeps the entire account schema valid', async () => {
  await connectUserSync(api);
  const profile = { folders: [
    { id: 'parent', name: '父目录', libraryId: 'music', parentId: null },
    { id: 'root', name: '同名', libraryId: 'music', parentId: null },
    { id: 'root-two', name: '同名（2）', libraryId: 'music', parentId: null },
    { id: 'child', name: '同名', libraryId: 'music', parentId: 'parent' },
    { id: 'grandchild', name: '保留', libraryId: 'music', parentId: 'child' },
  ], placements: { playlist: { libraryId: 'music', folderId: 'parent' } }, views: {}, collapsedFolders: ['parent', 'child'] };
  const next = removeFolder(profile, 'parent');
  expect(next.folders.find((folder) => folder.id === 'child')).toMatchObject({ name: '同名（3）', parentId: null });
  expect(next.folders.find((folder) => folder.id === 'grandchild')?.parentId).toBe('child');
  expect(next.placements.playlist.folderId).toBeNull(); expect(next.collapsedFolders).toEqual(['child']);
  expect(isUserData({ ...localUserData(), organization: next })).toBe(true);
  useLibrary.getState().change(api.identity, () => next); await vi.advanceTimersByTimeAsync(900);
  expect(remote.data?.organization).toEqual(next);
});
