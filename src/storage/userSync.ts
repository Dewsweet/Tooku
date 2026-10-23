import { create } from 'zustand';
import type { MusicApi } from '../api/client';
import { UserDataError, type UserDataApi } from '../api/userData';
import { isUserData, isUserDocument, type UserData, type UserDocument, type UserPreferences } from '../domain/userData';
import type { HistoryEntry, PlayerSnapshot } from '../domain/models';
import { usePreferences } from '../state/preferences';
import { emptyLibraryProfile, useLibrary } from '../state/library';
import { useProfiles } from '../state/profile';
import { useLyricsProfiles } from '../state/lyrics';
import { useRecommendationProfiles } from '../state/recommendations';
import { defaultRecommendationSettings } from '../domain/recommendations';
import { defaultLyricsSettings } from '../domain/lyrics/types';
import { holdPlaybackSnapshots, onProfileSave, readProfile, writeLocalData } from './local';

type SyncStatus = 'local' | 'review' | 'ready' | 'saving' | 'conflict' | 'offline';
interface SyncState { status: SyncStatus; message: string; remote: UserDocument | null; identity: string; }
export const useUserSync = create<SyncState>(() => ({ status: 'local', message: '仅保存在此设备', remote: null, identity: '' }));
interface Cache { version: 1; owner: string; base: UserDocument; local: UserData; accepted: boolean; requiresReview?: boolean }
interface Connection {
  api: MusicApi; client: UserDataApi | null; base: UserDocument; queue: PlayerSnapshot | null; history: HistoryEntry[];
  timer?: ReturnType<typeof setTimeout>; stops: (() => void)[]; applying: boolean; busy: boolean; device: UserPreferences; accepted: boolean; owner: string; requiresReview: boolean;
  pending?: Promise<void>;
}
let current: Connection | null = null;
const update = (patch: Partial<SyncState>) => useUserSync.setState(patch);
export const sameData = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function preferences(source: UserPreferences = usePreferences.getState()): UserPreferences {
  const { theme, accent, sidePanel, panelWidth, trackColumns, panelSections, lyricSize, lyricDelay, reducedMotion, shortcuts } = source;
  return { theme, accent, sidePanel, panelWidth, trackColumns, panelSections, lyricSize, lyricDelay, reducedMotion, shortcuts };
}
function hasAccountData(data: UserData, device: UserPreferences): boolean {
  const organization = data.organization;
  // Discovering the default library and persisting an empty player are automatic startup work.
  // Neither represents local edits that should block a new browser from adopting its account.
  return Boolean(data.profile.avatar || Object.keys(data.profile.playlistCovers).length || Object.keys(data.profile.artistCovers ?? {}).length
    || organization.folders.length || Object.keys(organization.placements).length || organization.activeId
    || Object.keys(organization.views).length || Object.values(organization.order ?? {}).some((items) => items.length)
    || data.queue?.entries.length || data.history.length || data.lyrics && !sameData(data.lyrics, defaultLyricsSettings)
    || data.recommendations && (data.recommendations.batch || !sameData(data.recommendations.settings, defaultRecommendationSettings)) || !sameData(data.preferences, device));
}
function capture(c: Connection): UserData {
  const profile = useProfiles.getState();
  const artistCovers = profile.artistCovers?.[c.api.identity] ?? {};
  return { version: 1, preferences: preferences(), profile: { ...(profile.avatars[c.api.identity] ? { avatar: profile.avatars[c.api.identity] } : {}), playlistCovers: profile.playlistCovers[c.api.identity] ?? {}, ...(Object.keys(artistCovers).length ? { artistCovers } : {}) },
    organization: useLibrary.getState().profiles[c.api.identity] ?? emptyLibraryProfile, queue: c.queue, history: c.history,
    ...(useLyricsProfiles.getState().profiles[c.api.identity] ? { lyrics: useLyricsProfiles.getState().profiles[c.api.identity] } : {}),
    ...(useRecommendationProfiles.getState().profiles[c.api.identity] ? { recommendations: useRecommendationProfiles.getState().profiles[c.api.identity] } : {}) };
}
async function cache(c: Connection) {
  const saved = await writeLocalData(c.api.identity, 'sync', { version: 1, owner: c.client?.owner || c.owner, base: c.base, local: capture(c), accepted: c.accepted, requiresReview: c.requiresReview } satisfies Cache);
  if (!saved && current === c) update({ message: '本地同步缓存无法保存，请导出备份；浏览器原有数据仍保留。' });
}
async function apply(c: Connection, data: UserData, preservePlayback = false) {
  if (current !== c) return;
  c.applying = true;
  if (preservePlayback && (!sameData(data.queue, c.queue) || !sameData(data.history, c.history))) holdPlaybackSnapshots(c.api.identity, true);
  try {
    usePreferences.getState().update(data.preferences);
    useProfiles.setState((s) => { const avatars = { ...s.avatars }; if (data.profile.avatar) avatars[c.api.identity] = data.profile.avatar; else delete avatars[c.api.identity]; return { avatars, playlistCovers: { ...s.playlistCovers, [c.api.identity]: data.profile.playlistCovers }, artistCovers: { ...s.artistCovers, [c.api.identity]: data.profile.artistCovers ?? {} } }; });
    useLibrary.getState().change(c.api.identity, () => data.organization);
    useLyricsProfiles.getState().apply(c.api.identity, data.lyrics);
    useRecommendationProfiles.getState().apply(c.api.identity, data.recommendations);
    c.queue = data.queue; c.history = data.history;
    const saved = await Promise.all([writeLocalData(c.api.identity, 'queue', data.queue), writeLocalData(c.api.identity, 'history', data.history)]);
    if (saved.some((ok) => !ok)) throw new Error('浏览器缓存无法保存恢复结果，服务器数据仍保留，请恢复存储权限后重新读取。');
  } finally { c.applying = false; }
}
function changed(c: Connection) {
  if (current !== c || c.applying) return;
  void cache(c); clearTimeout(c.timer);
  if (useUserSync.getState().status === 'ready' || useUserSync.getState().status === 'saving') c.timer = setTimeout(() => { void flush(c); }, 800);
}
function flush(c: Connection): Promise<void> {
  if (c.pending) return c.pending;
  const task = performFlush(c); c.pending = task;
  void task.finally(() => { if (c.pending === task) c.pending = undefined; });
  return task;
}
async function performFlush(c: Connection) {
  if (current !== c || !c.client || c.busy || !['ready', 'saving'].includes(useUserSync.getState().status)) return;
  const data = capture(c); if (sameData(data, c.base.data)) return;
  // An unused second browser must not seed the account with defaults ahead of its original browser.
  if (!c.base.data && !hasAccountData(data, c.device)) return;
  if (!isUserData(data)) { c.accepted = false; update({ status: 'offline', message: '本地数据未通过格式或容量检查，请导出备份后检查。' }); await cache(c); return; }
  c.busy = true; update({ status: 'saving', message: '正在保存…' });
  try {
    const doc = await c.client.write(c.base.revision, data);
    if (current !== c) return;
    c.base = doc; update({ status: 'ready', remote: doc, message: '已保存到服务器' }); await cache(c);
  } catch (error) {
    if (current !== c) return;
    update({ status: error instanceof UserDataError && error.status === 409 ? 'conflict' : 'offline', message: error instanceof Error ? error.message : '同步未完成，本地数据已保留。' });
    c.accepted = false; c.requiresReview = true;
    await cache(c);
  } finally {
    c.busy = false;
    if (current === c && useUserSync.getState().status === 'ready' && !sameData(capture(c), c.base.data)) changed(c);
  }
}
export async function prepareUserDataLogout() {
  const c = current; if (!c) return;
  clearTimeout(c.timer);
  if (c.busy && !c.pending) throw new Error('正在恢复数据，请稍后退出。');
  if (c.pending) await c.pending;
  await flush(c); await cache(c);
}
function subscribe(c: Connection) {
  c.stops.push(useRecommendationProfiles.subscribe((s, previous) => { if (s.profiles[c.api.identity] !== previous.profiles[c.api.identity]) changed(c); }));
  c.stops.push(useLyricsProfiles.subscribe((s, previous) => { if (s.profiles[c.api.identity] !== previous.profiles[c.api.identity]) changed(c); }), usePreferences.subscribe(() => changed(c)), useProfiles.subscribe((s, prev) => { if (s.avatars[c.api.identity] !== prev.avatars[c.api.identity] || s.playlistCovers[c.api.identity] !== prev.playlistCovers[c.api.identity] || s.artistCovers?.[c.api.identity] !== prev.artistCovers?.[c.api.identity]) changed(c); }),
    useLibrary.subscribe((s, prev) => { if (s.profiles[c.api.identity] !== prev.profiles[c.api.identity]) changed(c); }),
    onProfileSave((identity, kind, data) => {
      if (identity !== c.api.identity) return;
      if (kind === 'queue' && !Array.isArray(data)) c.queue = data;
      if (kind === 'history' && Array.isArray(data)) c.history = data;
      changed(c);
    }));
}
export async function connectUserSync(api: MusicApi) {
  disconnectUserSync();
  // Preserve legacy device preferences once, so a different account does not inherit the previous account's appearance.
  const stored = await readProfile<UserPreferences>('device', 'preferences'); const device = stored ?? preferences();
  if (!stored) await writeLocalData('device', 'preferences', device);
  usePreferences.getState().update(device);
  const c: Connection = { api, client: null, base: { revision: 0, updatedAt: 0, data: null }, queue: null, history: [], stops: [], applying: false, busy: false, device, accepted: false, owner: '', requiresReview: false };
  current = c; update({ status: 'local', message: '仅保存在此设备', remote: null, identity: api.identity });
  const [queue, history, saved] = await Promise.all([readProfile<PlayerSnapshot>(api.identity, 'queue'), readProfile<HistoryEntry[]>(api.identity, 'history'), readProfile<Cache>(api.identity, 'sync')]);
  if (current !== c) return;
  c.queue = queue ?? null; c.history = history ?? [];
  if (saved?.version === 1 && isUserData(saved.local)) {
    usePreferences.getState().update(saved.local.preferences);
    if (isUserDocument(saved.base)) { c.base = saved.base; c.owner = saved.owner; c.accepted = saved.accepted; c.requiresReview = saved.requiresReview === true; }
  }
  try {
    c.client = await api.userData(); if (current !== c) { c.client?.dispose(); return; }
    if (!c.client) { subscribe(c); return; }
    const remote = await c.client.read(); if (current !== c) return;
    c.base = remote; c.owner = c.client.owner;
    if (saved?.owner && saved.owner !== c.client.owner) c.requiresReview = true;
    const local = capture(c);
    const known = saved?.version === 1 && saved.accepted === true && saved.owner === c.client.owner && isUserData(saved.local) && isUserDocument(saved.base);
    const localIsUnused = !hasAccountData(local, c.device)
      && (!known || !saved.base.data || !hasAccountData(saved.base.data, c.device));
    if (remote.data && sameData(local, remote.data)) { c.requiresReview = false; update({ status: 'ready', remote, message: '已保存到服务器' }); }
    else if (known && sameData(local, saved.base.data) && remote.data) { await apply(c, remote.data); if (current !== c) return; update({ status: 'ready', remote, message: '已读取服务器数据' }); }
    else if (known && saved.base.revision === remote.revision) update({ status: 'ready', remote, message: '本地修改等待保存' });
    else if (!c.requiresReview && (!remote.data || !hasAccountData(remote.data, preferences(usePreferences.getInitialState())))) {
      if (hasAccountData(local, c.device) && !await writeLocalData(api.identity, 'before-import', local)) throw new Error('无法保留迁移前副本，暂未上传。');
      if (current !== c) return;
      update({ status: 'ready', remote, message: '已连接服务器，自动保存用户数据' });
    } else if (!c.requiresReview && localIsUnused && remote.data) {
      if (!await writeLocalData(api.identity, 'before-import', local)) throw new Error('无法保留本地副本，暂未读取账号数据。');
      await apply(c, remote.data);
      if (current !== c) return;
      update({ status: 'ready', remote, message: '已自动读取服务器数据' });
    } else {
      c.requiresReview = true;
      update({ status: 'review', remote, message: '此设备与服务器有不同数据或待核实的保存结果，请在设置中比较。' });
    }
    if (current !== c) return;
    c.accepted = useUserSync.getState().status === 'ready';
    subscribe(c); await cache(c);
    if (useUserSync.getState().status === 'ready') await flush(c);
  } catch (error) {
    if (current !== c) return;
    update({ status: 'offline', message: error instanceof Error ? error.message : '同步不可用，本地数据仍保留。' }); subscribe(c);
  }
}
export function disconnectUserSync() {
  const c = current; if (!c) return;
  clearTimeout(c.timer); for (const stop of c.stops) stop();
  // Capture unsent edits before restoring device preferences. Never discard the legacy storage.
  void cache(c); c.client?.dispose(); current = null;
  holdPlaybackSnapshots(c.api.identity, false);
  usePreferences.getState().update(c.device);
  update({ status: 'local', message: '仅保存在此设备', remote: null, identity: '' });
}
export function localUserData() { return current ? capture(current) : null; }
export async function refreshUserSync() {
  const c = current; if (!c || c.busy) return;
  if (!c.client) c.client = await c.api.userData();
  if (!c.client || current !== c) return;
  let remote: UserDocument;
  try { remote = await c.client.read(); }
  catch (error) { if (error instanceof UserDataError && error.status === 401) { c.client = await c.api.userData(); if (!c.client) return; remote = await c.client.read(); } else throw error; }
  if (current !== c) return;
  // Unknown write results are resolved by reading; never blindly replay a timed-out request.
  c.base = remote; c.accepted = sameData(capture(c), remote.data);
  c.requiresReview = !c.accepted;
  update({ status: c.accepted ? 'ready' : 'review', remote, message: '已重新读取，请比较后选择。' }); await cache(c);
}
export async function chooseUserData(source: 'local' | 'server', replacement?: UserData) {
  const c = current;
  if (!c) throw new Error('请先登录。');
  if (c.busy) throw new Error('正在保存，请稍后再试。');
  const remote = useUserSync.getState().remote;
  if (!c.client) {
    if (c.api.persistent || c.api.managed) throw new Error('请先重新连接服务器，再恢复备份。');
    if (!replacement || !isUserData(replacement)) throw new Error('备份格式无效。');
    if (!await writeLocalData(c.api.identity, 'before-import', capture(c))) throw new Error('无法保留恢复前副本，已取消恢复。');
    if (current !== c) return;
    await apply(c, replacement, true); if (current !== c) return; await cache(c);
    update({ status: 'local', message: '备份已恢复，队列在下次登录应用。' }); return;
  }
  if (!remote) throw new Error('请先重新读取服务器数据。');
  const data = replacement ?? (source === 'server' ? remote.data : capture(c));
  if (!data || !isUserData(data)) throw new Error('数据格式无效，原数据未修改。');
  clearTimeout(c.timer); c.busy = true;
  update({ status: 'saving', message: '正在应用所选版本…' });
  try {
    // Serialize explicit imports with autosaves, and retain the displaced local copy first.
    if (!await writeLocalData(c.api.identity, 'before-import', capture(c))) throw new Error('无法保留本地副本，已取消导入。');
    if (current !== c) return;
    if (source === 'server' && !replacement) {
      const latest = await c.client.read(); if (current !== c) return;
      if (latest.revision !== remote.revision) {
        c.base = latest; update({ remote: latest });
        throw new UserDataError('服务器数据已更新，请关闭后重新预览。', 409);
      }
      c.base = latest;
      await apply(c, data, true);
    } else {
      // Commit first: a rejected or unknown restore must not replace the visible local stores.
      const saved = await c.client.write(remote.revision, data); if (current !== c) return;
      c.base = saved;
      if (replacement) await apply(c, data, true);
    }
    if (current !== c) return;
    c.accepted = true; c.requiresReview = false;
    update({ status: 'ready', remote: c.base, message: '已使用所选数据；当前播放保持不变。' });
    await cache(c);
  } catch (error) {
    if (current === c) {
      c.accepted = false; c.requiresReview = true;
      update({ status: error instanceof UserDataError && error.status === 409 ? 'conflict' : 'offline', message: error instanceof Error ? error.message : '操作未完成，本地副本仍保留。' });
      await cache(c);
    }
    throw error;
  } finally {
    c.busy = false;
    if (current === c && useUserSync.getState().status === 'ready' && !sameData(capture(c), c.base.data)) changed(c);
  }
}
export async function exportUserBackup(source: 'local' | 'server' | 'account' = 'local') {
  const c = current; if (!c) throw new Error('请先登录。');
  if (source === 'server' && c.client) return c.client.backup();
  if (source === 'account' && c.client) {
    await prepareUserDataLogout();
    if (current !== c) throw new Error('账号已变化，请重新导出。');
    if (useUserSync.getState().status === 'ready' && c.base.data) {
      try { const backup = await c.client.backup(); if (current !== c) throw new Error('账号已变化，请重新导出。'); return backup; }
      catch { if (current !== c) throw new Error('账号已变化，请重新导出。'); update({ message: '服务器备份暂未读取，已导出此设备保留的账号数据。' }); }
    }
  }
  const data = capture(c);
  if (!isUserData(data)) throw new Error('账号数据格式无效，请先修正后导出。');
  const owner = syncOwner(); if (!owner || current !== c) throw new Error('账号已变化，请重新导出。');
  return { format: 'tooku-user-data' as const, version: 1 as const, owner, exportedAt: Date.now(), data };
}
export function syncOwner() { return current ? current.client?.owner || current.owner || `local:${current.api.identity}` : undefined; }
export async function previousUserData() { return current?.client?.revisions() ?? []; }
export async function displacedLocalData() { return current ? readProfile<UserData>(current.api.identity, 'before-import') : undefined; }
