import { createHash } from 'node:crypto';
import { createProviders } from '../lyrics/providers.ts';
import { canUseLyricCandidate, rankCandidates } from '../../src/domain/lyrics/matching.ts';
import { isDirectPlatformUrl, platformSearchLink, recommendationRecord, safeArtwork, type MusicPlatform, type PlatformLink, type RecommendationCredentials, type RecommendationSettings, type RecommendationSong, type ResolvedSong } from '../../src/domain/recommendations.ts';
import { limitedJson, RecommendationError } from './network.ts';
import { catalogReleaseDate } from '../../src/domain/musicMetadata.ts';
import { createRequestCache } from './cache.ts';

export const object = (v: unknown): Record<string, unknown> => recommendationRecord(v) ? v : {};
export const text = (v: unknown) => typeof v === 'string' ? v : '';
const array = (v: unknown) => Array.isArray(v) ? v.map(object) : [];
interface CatalogSong { title: string; artists: string[]; album?: string; durationMs?: number; releaseDate?: string; url: string; artwork?: string; artistAliases?: string[] }
export class CatalogRequestError extends RecommendationError {
  readonly upstreamStatus: number;
  constructor(upstreamStatus: number) { super(upstreamStatus === 429 ? '来源请求过于频繁，请稍后再试' : '来源认证未通过，请检查凭据或权限'); this.upstreamStatus = upstreamStatus; }
}
export async function mapLimit<T, R>(items: T[], count: number, action: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => { while (index < items.length) { const current = index++; results[current] = await action(items[current], current); } }));
  return results;
}
export function createCatalog(fetcher: typeof fetch = fetch) {
  const domestic = createProviders(fetcher);
  const searches = createRequestCache<CatalogSong[]>(256); const tokens = createRequestCache<string>(16);
  const cacheKey = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  async function json(url: URL | string, init: RequestInit, signal: AbortSignal, timeoutMs = 6000) {
    const budget = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const response = await fetcher(url, { ...init, credentials: 'omit', redirect: 'error', signal: budget });
      if ([401, 403, 429].includes(response.status)) { await response.body?.cancel(); throw new CatalogRequestError(response.status); }
      return object(await limitedJson(response));
    } catch (error) {
      if (signal.aborted) throw error;
      if (budget.aborted) throw new RecommendationError('来源请求超时，请稍后重试');
      if (error instanceof RecommendationError) throw error;
      throw new RecommendationError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? '来源请求超时，请稍后重试' : '来源网络连接失败，请稍后重试');
    }
  }
  async function spotifyToken(credentials: RecommendationCredentials, signal: AbortSignal) {
    return tokens.get(cacheKey([credentials.spotifyClientId, credentials.spotifyClientSecret]), signal, async (sharedSignal) => {
      const started = Date.now();
      const data = await json('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${credentials.spotifyClientId}:${credentials.spotifyClientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }, sharedSignal);
      if (!text(data.access_token)) throw new RecommendationError('Spotify 认证响应无效');
      const lifetime = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0 ? Math.min(data.expires_in * 1000, 3600000) : 0;
      return { value: text(data.access_token), ttl: Math.max(0, lifetime - Math.min(30000, lifetime * .1) - (Date.now() - started)) };
    });
  }
  async function search(platform: MusicPlatform, song: Pick<RecommendationSong, 'title' | 'artists'>, settings: RecommendationSettings, credentials: RecommendationCredentials, signal: AbortSignal, token?: string): Promise<CatalogSong[]> {
    const key = cacheKey([platform, song.title, song.artists, platform === 'apple' ? [settings.appleStorefront, credentials.appleToken] : platform === 'spotify' ? [settings.spotifyMarket, credentials.spotifyClientId, credentials.spotifyClientSecret, token] : []]);
    return searches.get(key, signal, async (sharedSignal) => {
      const value = await searchCatalog(platform, song, settings, credentials, sharedSignal, token);
      return { value, ttl: value.length ? 300000 : 30000 };
    });
  }
  async function searchCatalog(platform: MusicPlatform, song: Pick<RecommendationSong, 'title' | 'artists'>, settings: RecommendationSettings, credentials: RecommendationCredentials, signal: AbortSignal, token?: string): Promise<CatalogSong[]> {
    const query = `${song.title} ${song.artists.join(' ')}`;
    if (platform === 'netease' || platform === 'qq') {
      const result = await domestic.find((provider) => provider.id === platform)!.search(query, signal);
      return result.filter((candidate) => /^[a-zA-Z0-9]{1,80}$/.test(candidate.id)).map((candidate) => ({ ...candidate, url: platform === 'netease' ? `https://music.163.com/#/song?id=${candidate.id}` : `https://y.qq.com/n/ryqq/songDetail/${candidate.id}` }));
    }
    if (platform === 'apple') {
      const url = new URL(`https://api.music.apple.com/v1/catalog/${settings.appleStorefront}/search`); url.search = new URLSearchParams({ term: query, types: 'songs', limit: '5' }).toString();
      const data = await json(url, { headers: { Authorization: `Bearer ${credentials.appleToken}` } }, signal);
      if (!Array.isArray(object(object(data.results).songs).data)) throw new RecommendationError('Apple Music 目录响应格式无效');
      return array(object(object(data.results).songs).data).map((entry) => {
        const a = object(entry.attributes); const artwork = text(object(a.artwork).url).replace(/\{w\}|\{h\}/g, '240').replace(/\{f\}/g, 'jpg');
        return { title: text(a.name), artists: [text(a.artistName)], album: text(a.albumName), durationMs: typeof a.durationInMillis === 'number' ? a.durationInMillis : undefined, releaseDate: catalogReleaseDate(a.releaseDate), url: text(a.url), ...(safeArtwork(artwork) ? { artwork } : {}) };
      });
    }
    if (!token) throw new RecommendationError('Spotify 尚未配置');
    const url = new URL('https://api.spotify.com/v1/search'); url.search = new URLSearchParams({ q: `track:${song.title} artist:${song.artists[0]}`, type: 'track', limit: '5', market: settings.spotifyMarket }).toString();
    let data: Record<string, unknown>;
    try { data = await json(url, { headers: { Authorization: `Bearer ${token}` } }, signal); }
    catch (error) { if (error instanceof CatalogRequestError && error.upstreamStatus === 401) tokens.delete(cacheKey([credentials.spotifyClientId, credentials.spotifyClientSecret])); throw error; }
    if (!Array.isArray(object(data.tracks).items)) throw new RecommendationError('Spotify 目录响应格式无效');
    return array(object(data.tracks).items).map((entry) => {
      const album = object(entry.album); const artwork = text(array(album.images)[0]?.url);
      return { title: text(entry.name), artists: array(entry.artists).map((a) => text(a.name)), album: text(album.name), durationMs: typeof entry.duration_ms === 'number' ? entry.duration_ms : undefined, releaseDate: catalogReleaseDate(album.release_date), url: text(object(entry.external_urls).spotify), ...(safeArtwork(artwork) ? { artwork } : {}) };
    });
  }
  async function verify(song: RecommendationSong, settings: RecommendationSettings, credentials: RecommendationCredentials, signal: AbortSignal) {
    // AI proposals must exist in a catalog before entering a recommendation batch.
    const platforms: MusicPlatform[] = ['netease', 'qq']; if (credentials.appleToken) platforms.push('apple');
    for (const platform of platforms) {
      signal.throwIfAborted();
      try {
        const match = rankCandidates(song, await search(platform, song, settings, credentials, signal)).find((candidate) => canUseLyricCandidate(song, candidate));
        if (match) return { id: song.id, reason: song.reason, origin: song.origin, title: match.title.slice(0, 256), artists: match.artists.slice(0, 5).map((artist) => artist.slice(0, 120)), ...(match.album ? { album: match.album.slice(0, 256) } : {}), ...(match.durationMs ? { durationMs: match.durationMs } : {}), ...(match.releaseDate ? { releaseDate: match.releaseDate } : {}) };
      } catch { if (signal.aborted) break; }
    }
    return undefined;
  }
  async function links(songs: RecommendationSong[], settings: RecommendationSettings, credentials: RecommendationCredentials, signal: AbortSignal): Promise<ResolvedSong[]> {
    let token: string | undefined;
    if (settings.platforms.includes('spotify') && credentials.spotifyClientId && credentials.spotifyClientSecret) { try { token = await spotifyToken(credentials, signal); } catch { /* Other platforms keep working. */ } }
    const results: ResolvedSong[] = songs.map((song) => ({ id: song.id, links: [] }));
    const metadata: Partial<Record<MusicPlatform, CatalogSong>>[] = songs.map(() => ({}));
    await mapLimit(songs.flatMap((song, index) => settings.platforms.map((platform) => ({ song, index, platform }))), 4, async ({ song, index, platform }) => {
      const fallback: PlatformLink = { platform, url: platformSearchLink(platform, song, settings), kind: 'search', status: 'not-found' };
      const configured = platform === 'apple' ? Boolean(credentials.appleToken) : platform === 'spotify' ? Boolean(credentials.spotifyClientId && credentials.spotifyClientSecret) : true;
      if (!configured) fallback.status = 'unconfigured';
      else try {
        signal.throwIfAborted();
        const found = rankCandidates(song, await search(platform, song, settings, credentials, signal, token)).find((candidate) => canUseLyricCandidate(song, candidate) && isDirectPlatformUrl(candidate.url, platform));
        if (found) { fallback.url = found.url; fallback.kind = 'direct'; fallback.status = 'matched'; metadata[index][platform] = found; }
      } catch { fallback.status = 'unavailable'; }
      results[index].links.push(fallback);
    });
    for (const [index, result] of results.entries()) {
      result.links.sort((a, b) => settings.platforms.indexOf(a.platform) - settings.platforms.indexOf(b.platform));
      const match = settings.platforms.map((platform) => metadata[index][platform]).find(Boolean);
      if (match) { if (match.album) result.album = match.album.slice(0, 256); if (match.durationMs) result.durationMs = match.durationMs; if (match.releaseDate) result.releaseDate = match.releaseDate; }
    }
    return results;
  }
  return { json, search, verify, links, spotifyToken, close() { searches.clear(); tokens.clear(); } };
}
