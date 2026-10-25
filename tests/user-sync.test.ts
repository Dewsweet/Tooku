import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { UserDataApi, UserDataError } from '../src/api/userData';
import { usePreferences } from '../src/state/preferences';
import { useDisplayPreferences } from '../src/state/display';
import { orderKey, libraryItems, useLibrary } from '../src/state/library';
import { useProfiles } from '../src/state/profile';
import { useLyricsProfiles, updateLyricChoice } from '../src/state/lyrics';
import { chooseUserData, connectUserSync, disconnectUserSync, exportUserBackup, localUserData, refreshUserSync, useUserSync } from '../src/storage/userSync';
import type { UserDocument } from '../src/domain/userData';
import { defaultRecommendationSettings } from '../src/domain/recommendations';
import { useRecommendationProfiles, useRecommendationSecrets } from '../src/state/recommendations';
import { player, usePlayer } from '../src/features/player/engine';

const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../src/storage/local', () => ({
  holdPlaybackSnapshots: vi.fn(),
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
  useLyricsProfiles.setState({ profiles: {}, refreshes: {} });
  useRecommendationProfiles.setState({ profiles: {} });
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
afterEach(() => { disconnectUserSync(); api.dispose(); useDisplayPreferences.setState(useDisplayPreferences.getInitialState()); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('user data migration and sync', () => {
  it('backs up fade preferences, restores old defaults and isolates other accounts without attaching audio', async () => {
    const attach = vi.spyOn(player, 'attach');
    await connectUserSync(api);
    usePreferences.getState().update({ fadeDurationMs: 500 }); await vi.advanceTimersByTimeAsync(900);
    const backup = await exportUserBackup(); expect(backup.data.preferences.fadeDurationMs).toBe(500);
    const legacy = structuredClone(backup.data); delete legacy.preferences.fadeDurationMs;
    await chooseUserData('local', legacy); expect(usePreferences.getState().fadeDurationMs).toBe(0);
    disconnectUserSync();
    const other = new MusicApi(`${window.location.origin}/nd`, 'other-user', 'synthetic'); vi.spyOn(other, 'userData').mockResolvedValue(null);
    await connectUserSync(other); expect(usePreferences.getState().fadeDurationMs).toBe(0);
    expect(attach).not.toHaveBeenCalled(); other.dispose();
  });
  it('keeps browser text size outside account sync, imports and backups', async () => {
    useDisplayPreferences.getState().setBaseFontSize(18);
    useDisplayPreferences.getState().setFontFamily('source-serif');
    await connectUserSync(api);
    const data = structuredClone(localUserData()!);
    await chooseUserData('local', data);
    const backup = await exportUserBackup();
    expect(JSON.stringify(backup)).not.toContain('baseFontSize');
    expect(JSON.stringify(backup)).not.toContain('fontFamily');
    expect(useDisplayPreferences.getState().baseFontSize).toBe(18);
    disconnectUserSync();
    expect(useDisplayPreferences.getState().baseFontSize).toBe(18);
    expect(useDisplayPreferences.getState().fontFamily).toBe('source-serif');
  });
  it('syncs recommendation preferences, excludes credentials from backups and restores legacy documents without touching playback', async () => {
    const attach = vi.spyOn(player, 'attach'); const before = usePlayer.getState();
    await connectUserSync(api); const legacy = structuredClone(localUserData()!);
    const secret = crypto.randomUUID(); useRecommendationSecrets.getState().update(api.identity, { aiKey: secret });
    useRecommendationProfiles.getState().update(api.identity, () => ({ settings: { ...defaultRecommendationSettings, model: 'fixture', resultCount: 20 }, seenIds: ['older-result'], recentSongs: [{ id: 'older-result', title: 'Song', artists: ['Artist'] }] }));
    await vi.advanceTimersByTimeAsync(900);
    expect(remote.data?.recommendations?.settings.model).toBe('fixture');
    const backup = await exportUserBackup(); expect(backup.data.recommendations?.settings.model).toBe('fixture'); expect(backup.data.recommendations?.settings.resultCount).toBe(20); expect(backup.data.recommendations?.seenIds).toEqual(['older-result']); expect(JSON.stringify(backup)).not.toContain(secret);
    expect(backup.data.recommendations?.recentSongs?.[0].title).toBe('Song');
    disconnectUserSync(); memory.clear(); useRecommendationProfiles.setState({ profiles: {} });
    await connectUserSync(api); expect(useRecommendationProfiles.getState().profiles[api.identity].settings.model).toBe('fixture'); expect(useRecommendationProfiles.getState().profiles[api.identity].seenIds).toEqual(['older-result']);
    useRecommendationProfiles.getState().update('other-account', () => ({ settings: defaultRecommendationSettings }));
    await chooseUserData('local', legacy);
    expect(useRecommendationProfiles.getState().profiles[api.identity]).toBeUndefined(); expect(useRecommendationProfiles.getState().profiles['other-account']).toBeDefined();
    expect(remote.data?.recommendations).toBeUndefined(); useRecommendationSecrets.getState().clear();
    expect(attach).not.toHaveBeenCalled(); expect(usePlayer.getState()).toBe(before);
  });
  it('syncs lyric bindings and corrections, restores old backups and isolates other accounts', async () => {
    await connectUserSync(api); const legacy = structuredClone(localUserData()!);
    updateLyricChoice(api.identity, 'song', { mode: 'qq', bindings: { qq: 'abc123' }, edits: { local: { layout: 'halves', hash: 'a', delayMs: 100 } } });
    await vi.advanceTimersByTimeAsync(900);
    expect(remote.data?.lyrics?.tracks.song.bindings).toEqual({ qq: 'abc123' });
    const backup = await exportUserBackup(); expect(backup.data.lyrics?.tracks.song.edits?.local?.layout).toBe('halves');
    disconnectUserSync(); memory.clear(); useLyricsProfiles.setState({ profiles: {} });
    await connectUserSync(api); expect(useLyricsProfiles.getState().profiles[api.identity].tracks.song.mode).toBe('qq');
    updateLyricChoice('other-account', 'song', { mode: 'local' });
    await chooseUserData('local', legacy);
    expect(useLyricsProfiles.getState().profiles[api.identity]).toBeUndefined();
    expect(useLyricsProfiles.getState().profiles['other-account'].tracks.song.mode).toBe('local');
    expect(remote.data?.lyrics).toBeUndefined();
  });
  it('syncs artist pictures across browsers, includes them in backups, and preserves explicit removal', async () => {
    const image = 'data:image/jpeg;base64,AA==';
    useProfiles.getState().setArtistCover(api.identity, 'artist-one', image);
    await connectUserSync(api);
    expect(remote.data?.profile.artistCovers).toEqual({ 'artist-one': image });
    const backup = await exportUserBackup();
    expect(backup.data.profile.artistCovers).toEqual({ 'artist-one': image });
    disconnectUserSync(); memory.clear();
    useProfiles.setState(useProfiles.getInitialState(), true);
    useLibrary.setState(useLibrary.getInitialState(), true);
    await connectUserSync(api);
    expect(useProfiles.getState().artistCovers[api.identity]).toEqual({ 'artist-one': image });
    const revision = remote.revision;
    useProfiles.getState().setArtistCover('another-account', 'artist-one', 'data:image/jpeg;base64,AQ==');
    await vi.advanceTimersByTimeAsync(900);
    expect(remote.revision).toBe(revision);
    useProfiles.getState().setArtistCover(api.identity, 'artist-one');
    await vi.advanceTimersByTimeAsync(900);
    expect(remote.data?.profile.artistCovers).toBeUndefined();
    disconnectUserSync(); await connectUserSync(api);
    expect(useProfiles.getState().artistCovers[api.identity]?.['artist-one']).toBeUndefined();
    await chooseUserData('local', backup.data);
    expect(useProfiles.getState().artistCovers[api.identity]?.['artist-one']).toBe(image);
  });

  it('restores a legacy backup without artist pictures or folding while retaining other accounts', async () => {
    await connectUserSync(api);
    const legacy = structuredClone(localUserData()!);
    expect(legacy.profile.artistCovers).toBeUndefined();
    useProfiles.getState().setArtistCover(api.identity, 'one', 'data:image/jpeg;base64,AA==');
    useProfiles.getState().setArtistCover('other-account', 'one', 'data:image/jpeg;base64,AQ==');
    const folderProfile = { folders: [{ id: 'one', name: '目录', libraryId: 'music', parentId: null }], placements: {}, views: {}, collapsedFolders: ['one'] };
    useLibrary.getState().change(api.identity, () => folderProfile);
    useLibrary.getState().change('other-account', () => folderProfile);
    await vi.advanceTimersByTimeAsync(900);
    await chooseUserData('local', legacy);
    expect(useProfiles.getState().artistCovers[api.identity]).toEqual({});
    expect(useProfiles.getState().artistCovers['other-account'].one).toBe('data:image/jpeg;base64,AQ==');
    expect(remote.data?.profile.artistCovers).toBeUndefined();
    expect(useLibrary.getState().profiles[api.identity].collapsedFolders).toBeUndefined();
    expect(useLibrary.getState().profiles['other-account'].collapsedFolders).toEqual(['one']);
  });

  it('automatically uploads the original browser and restores avatar, playlist order and folding in a fresh browser', async () => {
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz8AAAAASUVORK5CYII=';
    const order = { [orderKey('music', null)]: ['playlist:second', 'playlist:first'] };
    useProfiles.getState().setAvatar(api.identity, avatar);
    useLibrary.getState().change(api.identity, () => ({ defaultId: 'music', folders: [{ id: 'one', name: '旧目录', libraryId: 'music', parentId: null }], placements: {}, views: {}, order, collapsedFolders: ['one'] }));
    await connectUserSync(api);
    expect(remote.data?.profile.avatar).toBe(avatar);
    expect(remote.data?.organization.order).toEqual(order);
    expect(remote.data?.organization.collapsedFolders).toEqual(['one']);
    expect(memory.has(`${api.identity}|before-import`)).toBe(true); expect(useUserSync.getState().status).toBe('ready');
    // A different browser has neither localStorage stores nor IndexedDB sync history.
    disconnectUserSync(); memory.clear(); localStorage.clear();
    useProfiles.setState(useProfiles.getInitialState(), true); useLibrary.setState(useLibrary.getInitialState(), true);
    usePreferences.setState(usePreferences.getInitialState(), true); vi.mocked(client.write).mockClear();
    await connectUserSync(api);
    expect(useUserSync.getState().status).toBe('ready');
    expect(useProfiles.getState().avatars[api.identity]).toBe(avatar);
    const organization = useLibrary.getState().profiles[api.identity];
    expect(organization.collapsedFolders).toEqual(['one']);
    expect(libraryItems(organization, [{ id: 'first', name: '第一张' }, { id: 'second', name: '第二张' }], 'music', null, 'music').filter((i) => i.kind === 'playlist').map((i) => i.key)).toEqual(order[orderKey('music', null)]);
    expect(client.write).not.toHaveBeenCalled();
  });
  it('requires a choice when both sides have different data, including after reconnecting', async () => {
    await connectUserSync(api); await chooseUserData('local');
    remote = { ...remote, data: { ...remote.data!, profile: { avatar: 'data:image/png;base64,AA==', playlistCovers: {} } } };
    disconnectUserSync(); memory.clear();
    useLibrary.getState().change(api.identity, () => ({ folders: [{ id: 'one', name: '本地目录', libraryId: 'music', parentId: null }], placements: {}, views: {} }));
    vi.mocked(client.write).mockClear();
    await connectUserSync(api); expect(useUserSync.getState().status).toBe('review');
    disconnectUserSync(); await connectUserSync(api); await vi.advanceTimersByTimeAsync(1000);
    expect(useUserSync.getState().status).toBe('review'); expect(client.write).not.toHaveBeenCalled();
    expect(useLibrary.getState().profiles[api.identity].folders[0].name).toBe('本地目录');
    await chooseUserData('local');
    disconnectUserSync(); await connectUserSync(api); expect(useUserSync.getState().status).toBe('ready');
  });
  it('does not create default server data from an unused browser, or let default library discovery block reading', async () => {
    useLibrary.getState().change(api.identity, () => ({ defaultId: 'music', folders: [], placements: {}, views: {} }));
    memory.set(`${api.identity}|queue`, { version: 1, entries: [], currentId: null, position: 0, repeat: 'off', volume: .7 });
    await connectUserSync(api); await vi.advanceTimersByTimeAsync(1000);
    expect(client.write).not.toHaveBeenCalled(); expect(remote.data).toBeNull();
    const data = structuredClone(localUserData()!);
    disconnectUserSync();
    remote = { revision: 1, updatedAt: Date.now(), data: { ...data, profile: { avatar: 'data:image/png;base64,AA==', playlistCovers: {} } } };
    await connectUserSync(api);
    expect(useUserSync.getState().status).toBe('ready'); expect(localUserData()?.profile.avatar).toBe(remote.data?.profile.avatar);
  });
  it('automatically completes a legacy unconfirmed migration when the server is still empty', async () => {
    await connectUserSync(api); const local = structuredClone(localUserData()!); disconnectUserSync();
    useLibrary.getState().change(api.identity, () => ({ folders: [], placements: {}, views: {}, order: { [orderKey('music', null)]: ['playlist:second', 'playlist:first'] } }));
    memory.set(`${api.identity}|sync`, { version: 1, owner: client.owner, base: remote, local, accepted: false });
    await connectUserSync(api);
    expect(useUserSync.getState().status).toBe('ready');
    expect(remote.data?.organization.order?.[orderKey('music', null)]).toEqual(['playlist:second', 'playlist:first']);
  });
  it('never replays an unknown initial upload after reconnecting', async () => {
    await connectUserSync(api); const local = structuredClone(localUserData()!); disconnectUserSync();
    useLibrary.getState().change(api.identity, () => ({ folders: [], placements: {}, views: {}, order: { [orderKey('music', null)]: ['playlist:second', 'playlist:first'] } }));
    memory.set(`${api.identity}|sync`, { version: 1, owner: client.owner, base: remote, local, accepted: false });
    vi.mocked(client.write).mockRejectedValueOnce(new UserDataError('unknown initial result'));
    await connectUserSync(api); expect(useUserSync.getState().status).toBe('offline'); expect(client.write).toHaveBeenCalledTimes(1);
    disconnectUserSync(); await connectUserSync(api); await vi.advanceTimersByTimeAsync(1000);
    expect(useUserSync.getState().status).toBe('review'); expect(client.write).toHaveBeenCalledTimes(1);
  });
  it('preserves an intentional local deletion instead of treating a previously synced browser as new', async () => {
    useProfiles.getState().setAvatar(api.identity, 'data:image/png;base64,AA==');
    await connectUserSync(api); expect(remote.data?.profile.avatar).toBeDefined();
    disconnectUserSync(); useProfiles.getState().setAvatar(api.identity);
    await connectUserSync(api);
    expect(useProfiles.getState().avatars[api.identity]).toBeUndefined();
    expect(remote.data?.profile.avatar).toBeUndefined();
  });
  it('does not automatically migrate an existing cache into a different verified service account', async () => {
    await connectUserSync(api); const local = structuredClone(localUserData()!); disconnectUserSync();
    useProfiles.getState().setAvatar(api.identity, 'data:image/png;base64,AA==');
    memory.set(`${api.identity}|sync`, { version: 1, owner: 'previous-service-account', base: remote, local, accepted: false });
    await connectUserSync(api); await vi.advanceTimersByTimeAsync(1000);
    expect(useUserSync.getState().status).toBe('review'); expect(client.write).not.toHaveBeenCalled();
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
  it('flushes pending account edits before unified export and falls back to preserved data while offline', async () => {
    await connectUserSync(api); await chooseUserData('local');
    vi.spyOn(client, 'backup').mockImplementation(async () => ({ format: 'tooku-user-data', version: 1, owner: client.owner, exportedAt: Date.now(), data: structuredClone(remote.data!) }));
    usePreferences.getState().update({ theme: 'dark' });
    const backup = await exportUserBackup('account');
    expect(remote.data?.preferences.theme).toBe('dark'); expect(backup.data.preferences.theme).toBe('dark');
    vi.mocked(client.backup).mockRejectedValueOnce(new Error('offline'));
    const fallback = await exportUserBackup('account'); expect(fallback.data).toEqual(localUserData());
    expect(useUserSync.getState().message).toContain('此设备保留');
  });
});
