import type { HistoryEntry } from './models.ts';

export const musicPlatforms = ['netease', 'qq', 'apple', 'spotify'] as const;
export type MusicPlatform = typeof musicPlatforms[number];
export const platformNames: Record<MusicPlatform, string> = { netease: '网易云音乐', qq: 'QQ 音乐', apple: 'Apple Music', spotify: 'Spotify' };
export type RecommendationMode = 'algorithm' | 'ai' | 'hybrid';
export interface RecommendationSettings {
  mode: RecommendationMode; sampleSize: number; exploration: number; platforms: MusicPlatform[];
  aiBaseUrl: string; model: string; appleStorefront: string; spotifyMarket: string;
}
export const defaultRecommendationSettings: RecommendationSettings = {
  mode: 'hybrid', sampleSize: 50, exploration: .3, platforms: [...musicPlatforms],
  aiBaseUrl: '', model: '', appleStorefront: 'cn', spotifyMarket: 'US',
};
export interface RecommendationCredentials { lastfmKey: string; aiKey: string; appleToken: string; spotifyClientId: string; spotifyClientSecret: string }
export const emptyRecommendationCredentials: RecommendationCredentials = { lastfmKey: '', aiKey: '', appleToken: '', spotifyClientId: '', spotifyClientSecret: '' };
export interface RecommendationSong { id: string; title: string; artists: string[]; album?: string; durationMs?: number; reason: string; origin: 'lastfm' | 'ai' }
export interface ListeningSeed { title: string; artists: string[]; album?: string; durationMs?: number; weight: number; plays: number }
export interface RecommendationBatch { id: string; createdAt: number; sampleCount: number; mode: 'algorithm' | 'ai' | 'hybrid'; songs: RecommendationSong[]; notices: string[] }
export interface RecommendationProfile { settings: RecommendationSettings; batch?: RecommendationBatch }
export interface PlatformLink { platform: MusicPlatform; url: string; kind: 'direct' | 'search'; status: 'matched' | 'unconfigured' | 'not-found' | 'unavailable' }
export interface ResolvedSong { id: string; links: PlatformLink[]; artwork?: string }
export const recommendationRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((key) => allowed.includes(key));
const text = (v: unknown, max = 512): v is string => typeof v === 'string' && v.length <= max;
const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export const isMusicPlatform = (v: unknown): v is MusicPlatform => musicPlatforms.includes(v as MusicPlatform);
export function validModelBase(value: unknown): value is string {
  if (!text(value, 512)) return false;
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
export function isRecommendationSettings(v: unknown): v is RecommendationSettings {
  return recommendationRecord(v) && keys(v, ['mode', 'sampleSize', 'exploration', 'platforms', 'aiBaseUrl', 'model', 'appleStorefront', 'spotifyMarket'])
    && ['algorithm', 'ai', 'hybrid'].includes(String(v.mode)) && Number.isInteger(v.sampleSize) && finite(v.sampleSize, 30, 50) && finite(v.exploration, 0, .5)
    && Array.isArray(v.platforms) && v.platforms.length > 0 && v.platforms.length <= 4 && v.platforms.every(isMusicPlatform) && new Set(v.platforms).size === v.platforms.length
    && validModelBase(v.aiBaseUrl) && text(v.model, 120) && typeof v.appleStorefront === 'string' && /^[a-z]{2}$/.test(v.appleStorefront) && typeof v.spotifyMarket === 'string' && /^[A-Z]{2}$/.test(v.spotifyMarket);
}
export function isRecommendationCredentials(v: unknown): v is RecommendationCredentials {
  return recommendationRecord(v) && keys(v, Object.keys(emptyRecommendationCredentials)) && Object.keys(emptyRecommendationCredentials).every((key) => text(v[key], 8192) && !/[\r\n\0]/.test(String(v[key])));
}
const metadata = (v: Record<string, unknown>) => text(v.title, 256) && !!v.title.trim() && Array.isArray(v.artists) && v.artists.length > 0 && v.artists.length <= 5 && v.artists.every((a) => text(a, 120) && a.trim())
  && (v.album === undefined || text(v.album, 256)) && (v.durationMs === undefined || finite(v.durationMs, 0, 86400000));
export function isListeningSeed(v: unknown): v is ListeningSeed { return recommendationRecord(v) && keys(v, ['title', 'artists', 'album', 'durationMs', 'weight', 'plays']) && metadata(v) && finite(v.weight, 0, 10) && Number.isInteger(v.plays) && finite(v.plays, 1, 200); }
export function isRecommendationSong(v: unknown): v is RecommendationSong { return recommendationRecord(v) && keys(v, ['id', 'title', 'artists', 'album', 'durationMs', 'reason', 'origin']) && text(v.id, 80) && /^[a-zA-Z0-9_-]+$/.test(v.id) && metadata(v) && text(v.reason, 180) && ['lastfm', 'ai'].includes(String(v.origin)); }
export function isRecommendationBatch(v: unknown): v is RecommendationBatch {
  return recommendationRecord(v) && keys(v, ['id', 'createdAt', 'sampleCount', 'mode', 'songs', 'notices']) && text(v.id, 80) && /^[a-zA-Z0-9_-]+$/.test(v.id)
    && finite(v.createdAt, 0, 1e16) && Number.isInteger(v.sampleCount) && finite(v.sampleCount, 1, 50) && ['algorithm', 'ai', 'hybrid'].includes(String(v.mode))
    && Array.isArray(v.songs) && v.songs.length <= 10 && v.songs.every(isRecommendationSong) && new Set(v.songs.map((song) => song.id)).size === v.songs.length
    && Array.isArray(v.notices) && v.notices.length <= 8 && v.notices.every((n) => text(n, 180));
}
export function isRecommendationProfile(v: unknown): v is RecommendationProfile { return recommendationRecord(v) && keys(v, ['settings', 'batch']) && isRecommendationSettings(v.settings) && (v.batch === undefined || isRecommendationBatch(v.batch)); }
export const songKey = (title: string, artists: string[]) => [title, ...artists].map((part) => part.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')).join('|');

export function listeningSeeds(history: HistoryEntry[], size = 50, now = Date.now()): ListeningSeed[] {
  const seeds = new Map<string, ListeningSeed>();
  for (const record of [...history].sort((a, b) => b.listenedAt - a.listenedAt).slice(0, 200)) {
    const track = record.track;
    const seed: ListeningSeed = { title: track.title.slice(0, 256), artists: (track.artists?.length ? track.artists.map((a) => a.name) : [track.artist]).filter((a) => a.trim()).slice(0, 5).map((a) => a.slice(0, 120)), ...(track.album ? { album: track.album.slice(0, 256) } : {}), ...(track.duration ? { durationMs: track.duration * 1000 } : {}), plays: 1, weight: 1 };
    if (!isListeningSeed(seed)) continue;
    const key = songKey(seed.title, seed.artists); const saved = seeds.get(key);
    const recency = Math.pow(.5, Math.max(0, now - record.listenedAt) / (14 * 86400000));
    if (saved) { saved.plays++; saved.weight = Math.min(5, saved.weight + recency / Math.sqrt(saved.plays)); }
    else if (seeds.size < size) seeds.set(key, { ...seed, weight: recency });
  }
  return [...seeds.values()];
}
export function platformSearchLink(platform: MusicPlatform, song: Pick<RecommendationSong, 'title' | 'artists'>, settings = defaultRecommendationSettings) {
  const query = encodeURIComponent(`${song.title} ${song.artists.join(' ')}`);
  return ({ netease: `https://music.163.com/#/search/m/?s=${query}&type=1`, qq: `https://y.qq.com/n/ryqq/search?w=${query}&t=song`, apple: `https://music.apple.com/${settings.appleStorefront}/search?term=${query}`, spotify: `https://open.spotify.com/search/${query}` })[platform];
}
export function isPlatformUrl(value: unknown, platform: MusicPlatform) {
  if (!text(value, 2048)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && ![...url.searchParams.keys()].some((key) => /^(token|key|api_?key|authorization|password|salt)$/i.test(key)) && ({ netease: ['music.163.com'], qq: ['y.qq.com'], apple: ['music.apple.com'], spotify: ['open.spotify.com'] })[platform].includes(url.hostname); } catch { return false; }
}
export function isDirectPlatformUrl(value: unknown, platform: MusicPlatform) {
  if (!isPlatformUrl(value, platform) || typeof value !== 'string') return false;
  const url = new URL(value);
  return ({ netease: /^#\/song\?id=\d+$/.test(url.hash) || url.pathname === '/song' && /^\d+$/.test(url.searchParams.get('id') ?? ''), qq: /^\/n\/ryqq\/songDetail\/[a-zA-Z0-9]+$/.test(url.pathname), apple: /^\/[a-z]{2}\/(song|album)\/.+\/\d+$/.test(url.pathname), spotify: /^\/(?:intl-[a-z]{2}\/)?track\/[a-zA-Z0-9]+$/.test(url.pathname) })[platform];
}
export function isResolvedSong(v: unknown): v is ResolvedSong {
  return recommendationRecord(v) && text(v.id, 80) && Array.isArray(v.links) && v.links.length <= 4 && v.links.every((link) => recommendationRecord(link) && isMusicPlatform(link.platform) && isPlatformUrl(link.url, link.platform) && ['direct', 'search'].includes(String(link.kind)) && (link.kind !== 'direct' || isDirectPlatformUrl(link.url, link.platform)) && ['matched', 'unconfigured', 'not-found', 'unavailable'].includes(String(link.status)))
    && new Set(v.links.map((link) => link.platform)).size === v.links.length && (v.artwork === undefined || safeArtwork(v.artwork));
}
export function safeArtwork(value: unknown): value is string {
  if (!text(value, 2048)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && /(^|\.)(music\.126\.net|gtimg\.cn|mzstatic\.com|scdn\.co)$/.test(url.hostname); } catch { return false; }
}
