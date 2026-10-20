import type { HistoryEntry, PlayerSnapshot, Track } from './models.ts';

export interface UserPreferences {
  theme: 'light' | 'dark'; accent: string; sidePanel: boolean; panelWidth: number; trackColumns: number[];
  panelSections: { id: 'cover' | 'lyrics' | 'details' | 'queue'; enabled: boolean }[];
  lyricSize: number; lyricDelay: number; reducedMotion: boolean; shortcuts: boolean;
}
export interface UserOrganization {
  activeId?: string; defaultId?: string;
  folders: { id: string; name: string; libraryId: string; parentId: string | null }[];
  placements: Record<string, { libraryId: string; folderId: string | null }>;
  views: Record<string, 'playlists' | 'songs' | 'albums'>; order?: Record<string, string[]>;
}
export interface UserData {
  version: 1;
  preferences: UserPreferences;
  profile: { avatar?: string; playlistCovers: Record<string, string> };
  organization: UserOrganization;
  queue: PlayerSnapshot | null;
  history: HistoryEntry[];
}
export interface UserDocument { revision: number; updatedAt: number; data: UserData | null }
export interface UserBackup { format: 'tooku-user-data'; version: 1; owner: string; exportedAt: number; data: UserData }
export const maxUserDataBytes = 12 * 1024 * 1024;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 2048;
// IDs are opaque, never authenticated media URLs. Arbitrary text (titles/comments) is safe to preserve.
const id = (v: unknown): v is string => text(v) && v.length > 0 && !/[?&#/\\]/.test(v) && [...v].every((c) => c.charCodeAt(0) >= 32);
const optionalId = (v: unknown) => v === undefined || id(v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const map = (v: unknown, check: (item: unknown) => boolean) => record(v) && Object.keys(v).length <= 10000 && Object.entries(v).every(([k, item]) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && text(k) && check(item));
const image = (v: unknown) => typeof v === 'string' && v.length <= 2 * 1024 * 1024 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);
function validTrack(v: unknown): v is Track {
  if (!record(v) || !keys(v, ['id', 'title', 'artist', 'album', 'albumId', 'artistId', 'artists', 'coverArt', 'duration', 'track', 'discNumber', 'suffix', 'bitRate', 'starred'])) return false;
  return id(v.id) && text(v.title) && text(v.artist) && ['album', 'suffix', 'starred'].every((k) => v[k] === undefined || text(v[k]))
    && ['albumId', 'artistId', 'coverArt'].every((k) => optionalId(v[k]))
    && ['duration', 'track', 'discNumber', 'bitRate'].every((k) => v[k] === undefined || finite(v[k], 0, 1e9))
    && (v.artists === undefined || Array.isArray(v.artists) && v.artists.length <= 100 && v.artists.every((a) => record(a) && keys(a, ['id', 'name']) && optionalId(a.id) && text(a.name)));
}
export function isUserData(v: unknown): v is UserData {
  if (!record(v) || !keys(v, ['version', 'preferences', 'profile', 'organization', 'queue', 'history']) || v.version !== 1) return false;
  const p = v.preferences; const art = v.profile; const o = v.organization; const q = v.queue;
  if (!record(p) || !keys(p, ['theme', 'accent', 'sidePanel', 'panelWidth', 'trackColumns', 'panelSections', 'lyricSize', 'lyricDelay', 'reducedMotion', 'shortcuts'])
    || !['light', 'dark'].includes(String(p.theme)) || typeof p.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.accent)
    || !['sidePanel', 'reducedMotion', 'shortcuts'].every((k) => typeof p[k] === 'boolean') || !finite(p.panelWidth, 280, 560)
    || !finite(p.lyricSize, 12, 100) || !finite(p.lyricDelay, -600000, 600000)
    || !Array.isArray(p.trackColumns) || p.trackColumns.length !== 4 || !p.trackColumns.every((x) => finite(x, .25, 10))
    || !Array.isArray(p.panelSections) || p.panelSections.length !== 4 || new Set(p.panelSections.map((s) => record(s) ? s.id : null)).size !== 4
    || !p.panelSections.every((s) => record(s) && keys(s, ['id', 'enabled']) && ['cover', 'lyrics', 'details', 'queue'].includes(String(s.id)) && typeof s.enabled === 'boolean')) return false;
  if (!record(art) || !keys(art, ['avatar', 'playlistCovers']) || art.avatar !== undefined && !image(art.avatar) || !map(art.playlistCovers, image)) return false;
  if (!record(o) || !keys(o, ['activeId', 'defaultId', 'folders', 'placements', 'views', 'order']) || !optionalId(o.activeId) || !optionalId(o.defaultId)
    || !Array.isArray(o.folders) || o.folders.length > 2000 || !o.folders.every((f) => record(f) && keys(f, ['id', 'name', 'libraryId', 'parentId']) && id(f.id) && text(f.name) && f.name.trim().length && id(f.libraryId) && (f.parentId === null || id(f.parentId)))
    || !map(o.placements, (p) => record(p) && keys(p, ['libraryId', 'folderId']) && id(p.libraryId) && (p.folderId === null || id(p.folderId)))
    || !map(o.views, (v) => ['playlists', 'songs', 'albums'].includes(String(v)))
    || o.order !== undefined && !map(o.order, (v) => Array.isArray(v) && v.length <= 10000 && v.every(text))) return false;
  const folders = o.folders;
  if (new Set(folders.map((f) => f.id)).size !== folders.length) return false;
  const byId = new Map(folders.map((f) => [f.id, f])); const siblings = new Set<string>();
  for (const f of folders) {
    const nameKey = JSON.stringify([f.libraryId, f.parentId, f.name]); if (siblings.has(nameKey)) return false; siblings.add(nameKey);
    const visited = new Set([f.id]); let parent = f.parentId;
    while (parent !== null) { const target = byId.get(parent); if (!target || target.libraryId !== f.libraryId || visited.has(parent)) return false; visited.add(parent); parent = target.parentId; }
  }
  if (!record(o.placements)) return false;
  for (const p of Object.values(o.placements)) {
    if (!record(p) || p.folderId !== null && (!text(p.folderId) || byId.get(p.folderId)?.libraryId !== p.libraryId)) return false;
  }
  if (q !== null) {
    if (!record(q) || !keys(q, ['version', 'entries', 'currentId', 'position', 'repeat', 'volume']) || q.version !== 1
      || !Array.isArray(q.entries) || q.entries.length > 5000 || !q.entries.every((e) => record(e) && keys(e, ['entryId', 'track']) && id(e.entryId) && validTrack(e.track))
      || new Set(q.entries.map((e) => e.entryId)).size !== q.entries.length || q.currentId !== null && !q.entries.some((e) => e.entryId === q.currentId)
      || !finite(q.position, 0, 1e9) || !finite(q.volume, 0, 1) || !['off', 'all', 'one'].includes(String(q.repeat))) return false;
  }
  return Array.isArray(v.history) && v.history.length <= 200 && v.history.every((h) => record(h) && keys(h, ['occurrenceId', 'track', 'listenedAt', 'submitted']) && id(h.occurrenceId) && validTrack(h.track) && finite(h.listenedAt, 0, 1e16) && typeof h.submitted === 'boolean');
}
export function isBackup(v: unknown): v is UserBackup {
  return record(v) && keys(v, ['format', 'version', 'owner', 'exportedAt', 'data']) && v.format === 'tooku-user-data' && v.version === 1 && text(v.owner) && finite(v.exportedAt, 0, 1e16) && isUserData(v.data);
}
export function isUserDocument(v: unknown): v is UserDocument {
  return record(v) && keys(v, ['revision', 'updatedAt', 'data']) && Number.isSafeInteger(v.revision) && typeof v.revision === 'number' && v.revision >= 0
    && finite(v.updatedAt, 0, 1e16) && (v.data === null ? v.revision === 0 : isUserData(v.data));
}
