import { catalogReleaseDate } from '../musicMetadata.ts';

export const providerIds = ['netease', 'qq'] as const;
export type ProviderId = typeof providerIds[number];
export type LyricSource = 'local' | ProviderId;
export const providerNames = { local: '本地', netease: '网易云', qq: 'QQ 音乐' } as const;
export type LyricMode = 'auto' | 'local' | 'network' | ProviderId;
export type LyricLayout = 'auto' | 'original' | 'inline' | 'alternating' | 'halves';
export interface RawLyricTrack { role: 'original' | 'translation' | 'romanization'; text?: string; lang?: string; offsetMs?: number; lines?: { text: string; startMs?: number }[] }
export interface LyricDocument { version: 1; source: LyricSource; recordId: string; tracks: RawLyricTrack[]; instrumental?: boolean }
export interface LyricEdit { layout: LyricLayout; hash: string; separator?: string; splitAt?: number; delayMs?: number; showTranslation?: boolean; showRomanization?: boolean }
export interface LyricChoice { mode: LyricMode; bindings?: Partial<Record<ProviderId, string>>; edits?: Partial<Record<LyricSource, LyricEdit>> }
export interface LyricsSettings { enabled: boolean; order: ProviderId[]; tracks: Record<string, LyricChoice> }
export const defaultLyricsSettings: LyricsSettings = { enabled: true, order: ['netease', 'qq'], tracks: {} };
export interface TrackDescriptor { title: string; artists: string[]; album?: string; durationMs?: number }
export interface LyricCandidate { provider: ProviderId; id: string; title: string; artists: string[]; artistAliases?: string[]; album?: string; durationMs?: number; releaseDate?: string; score?: number; confident?: boolean }
export type SourceError = 'timeout' | 'rate-limited' | 'login-required' | 'unavailable' | 'protocol' | 'disabled';
export interface ProviderObservation { checkedAt?: number; successAt?: number; elapsedMs?: number; error?: SourceError }
export interface ProviderStatus { id: ProviderId; search: ProviderObservation; lyrics: ProviderObservation; retryAt?: number }
export interface LyricsStatus { version: 1; enabled: boolean; cache: 'sqlite' | 'memory'; providers: ProviderStatus[] }
export interface SearchResult { version: 1; candidates: LyricCandidate[]; errors: { provider: ProviderId; code: SourceError }[] }
export interface FetchResult { version: 1; document: LyricDocument; cached: boolean; stale: boolean }

export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isProvider = (v: unknown): v is ProviderId => v === 'netease' || v === 'qq';
export const opaqueId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[?&#/\\]/.test(v) && [...v].every((c) => c.charCodeAt(0) >= 32) && !['__proto__', 'constructor', 'prototype'].includes(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((key) => allowed.includes(key));
const text = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length <= max;
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function isDescriptor(v: unknown): v is TrackDescriptor {
  return record(v) && keys(v, ['title', 'artists', 'album', 'durationMs']) && text(v.title, 512) && !!v.title.trim() && Array.isArray(v.artists) && v.artists.length <= 20 && v.artists.every((a) => text(a, 256)) && (v.album === undefined || text(v.album, 512)) && (v.durationMs === undefined || number(v.durationMs, 0, 86400000));
}
export function isCandidate(v: unknown): v is LyricCandidate {
  if (record(v) && v.releaseDate !== undefined && (typeof v.releaseDate !== 'string' || catalogReleaseDate(v.releaseDate) !== v.releaseDate)) return false;
  return record(v) && isProvider(v.provider) && opaqueId(v.id) && text(v.title, 512) && !!v.title.trim() && Array.isArray(v.artists) && v.artists.length <= 20 && v.artists.every((a) => text(a, 256)) && (v.artistAliases === undefined || Array.isArray(v.artistAliases) && v.artistAliases.length <= 20 && v.artistAliases.every((a) => text(a, 256))) && (v.album === undefined || text(v.album, 512)) && (v.durationMs === undefined || number(v.durationMs, 0, 86400000)) && (v.score === undefined || number(v.score, 0, 1)) && (v.confident === undefined || typeof v.confident === 'boolean');
}
export function isLyricDocument(v: unknown): v is LyricDocument {
  return record(v) && v.version === 1 && (v.source === 'local' || isProvider(v.source)) && opaqueId(v.recordId) && (v.instrumental === undefined || typeof v.instrumental === 'boolean') && Array.isArray(v.tracks) && v.tracks.length <= 12 && v.tracks.every((t) => record(t) && ['original', 'translation', 'romanization'].includes(String(t.role)) && (t.text === undefined || text(t.text, 262144)) && (t.lang === undefined || text(t.lang, 32)) && (t.offsetMs === undefined || number(t.offsetMs, -600000, 600000)) && (t.lines === undefined || Array.isArray(t.lines) && t.lines.length <= 10000 && t.lines.every((l) => record(l) && text(l.text) && (l.startMs === undefined || number(l.startMs, 0, 86400000)))));
}
export function isLyricsSettings(v: unknown): v is LyricsSettings {
  if (!record(v) || !keys(v, ['enabled', 'order', 'tracks']) || typeof v.enabled !== 'boolean' || !Array.isArray(v.order) || !v.order.length || v.order.length > 2 || !v.order.every(isProvider) || new Set(v.order).size !== v.order.length || !record(v.tracks) || Object.keys(v.tracks).length > 2000) return false;
  return Object.entries(v.tracks).every(([id, choice]) => opaqueId(id) && record(choice) && keys(choice, ['mode', 'bindings', 'edits']) && ['auto', 'local', 'network', 'netease', 'qq'].includes(String(choice.mode))
    && (choice.bindings === undefined || record(choice.bindings) && Object.entries(choice.bindings).every(([p, id]) => isProvider(p) && opaqueId(id)))
    && (choice.edits === undefined || record(choice.edits) && Object.entries(choice.edits).every(([source, e]) => (source === 'local' || isProvider(source)) && record(e) && keys(e, ['layout', 'hash', 'separator', 'splitAt', 'delayMs', 'showTranslation', 'showRomanization']) && ['auto', 'original', 'inline', 'alternating', 'halves'].includes(String(e.layout)) && text(e.hash, 64) && (e.separator === undefined || text(e.separator, 16)) && (e.splitAt === undefined || Number.isInteger(e.splitAt) && number(e.splitAt, 1, 10000)) && (e.delayMs === undefined || number(e.delayMs, -600000, 600000)) && ['showTranslation', 'showRomanization'].every((key) => e[key] === undefined || typeof e[key] === 'boolean'))));
}
