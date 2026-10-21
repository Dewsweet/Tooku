import { createProviders } from '../lyrics/providers.ts';
import { canUseLyricCandidate, rankCandidates } from '../../src/domain/lyrics/matching.ts';
import { isDirectPlatformUrl, platformSearchLink, recommendationRecord, safeArtwork, type MusicPlatform, type PlatformLink, type RecommendationCredentials, type RecommendationSettings, type RecommendationSong, type ResolvedSong } from '../../src/domain/recommendations.ts';
import { limitedJson, RecommendationError } from './network.ts';

export const object = (v: unknown): Record<string, unknown> => recommendationRecord(v) ? v : {};
export const text = (v: unknown) => typeof v === 'string' ? v : '';
const array = (v: unknown) => Array.isArray(v) ? v.map(object) : [];
interface CatalogSong { title: string; artists: string[]; album?: string; durationMs?: number; url: string; artwork?: string; artistAliases?: string[] }
export async function mapLimit<T, R>(items: T[], count: number, action: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => { while (index < items.length) { const current = index++; results[current] = await action(items[current], current); } }));
  return results;
}
export function createCatalog(fetcher: typeof fetch = fetch) {
  const domestic = createProviders(fetcher);
  async function json(url: URL | string, init: RequestInit, signal: AbortSignal, timeoutMs = 6000) {
    const budget = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const response = await fetcher(url, { ...init, credentials: 'omit', redirect: 'error', signal: budget });
      return object(await limitedJson(response));
    } catch (error) {
      if (signal.aborted) throw error;
      if (budget.aborted) throw new RecommendationError('来源请求超时，请稍后重试');
      if (error instanceof RecommendationError) throw error;
      throw new RecommendationError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? '来源请求超时，请稍后重试' : '来源网络连接失败，请稍后重试');
    }
  }
  async function spotifyToken(credentials: RecommendationCredentials, signal: AbortSignal) {
    const data = await json('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${credentials.spotifyClientId}:${credentials.spotifyClientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }, signal);
    if (!text(data.access_token)) throw new RecommendationError('Spotify 认证响应无效');
    return text(data.access_token);
  }
  async function search(platform: MusicPlatform, song: Pick<RecommendationSong, 'title' | 'artists'>, settings: RecommendationSettings, credentials: RecommendationCredentials, signal: AbortSignal, token?: string): Promise<CatalogSong[]> {
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
        return { title: text(a.name), artists: [text(a.artistName)], album: text(a.albumName), durationMs: typeof a.durationInMillis === 'number' ? a.durationInMillis : undefined, url: text(a.url), ...(safeArtwork(artwork) ? { artwork } : {}) };
      });
    }
    if (!token) throw new RecommendationError('Spotify 尚未配置');
    const url = new URL('https://api.spotify.com/v1/search'); url.search = new URLSearchParams({ q: `track:${song.title} artist:${song.artists[0]}`, type: 'track', limit: '5', market: settings.spotifyMarket }).toString();
    const data = await json(url, { headers: { Authorization: `Bearer ${token}` } }, signal);
    if (!Array.isArray(object(data.tracks).items)) throw new RecommendationError('Spotify 目录响应格式无效');
    return array(object(data.tracks).items).map((entry) => {
      const album = object(entry.album); const artwork = text(array(album.images)[0]?.url);
      return { title: text(entry.name), artists: array(entry.artists).map((a) => text(a.name)), album: text(album.name), durationMs: typeof entry.duration_ms === 'number' ? entry.duration_ms : undefined, url: text(object(entry.external_urls).spotify), ...(safeArtwork(artwork) ? { artwork } : {}) };
    });
  }
  async function verify(song: RecommendationSong, settings: RecommendationSettings, credentials: RecommendationCredentials, signal: AbortSignal) {
    // AI proposals must exist in a catalog before entering a recommendation batch.
    const platforms: MusicPlatform[] = ['netease', 'qq']; if (credentials.appleToken) platforms.push('apple');
    for (const platform of platforms) {
      signal.throwIfAborted();
      try {
        const match = rankCandidates(song, await search(platform, song, settings, credentials, signal)).find((candidate) => canUseLyricCandidate(song, candidate));
        if (match) return { ...song, title: match.title.slice(0, 256), artists: match.artists.slice(0, 5).map((artist) => artist.slice(0, 120)), ...(match.album ? { album: match.album.slice(0, 256) } : {}), ...(match.durationMs ? { durationMs: match.durationMs } : {}) };
      } catch { if (signal.aborted) break; }
    }
    return undefined;
  }
  async function links(songs: RecommendationSong[], settings: RecommendationSettings, credentials: RecommendationCredentials, signal: AbortSignal): Promise<ResolvedSong[]> {
    let token: string | undefined;
    if (settings.platforms.includes('spotify') && credentials.spotifyClientId && credentials.spotifyClientSecret) { try { token = await spotifyToken(credentials, signal); } catch { /* Other platforms keep working. */ } }
    const results: ResolvedSong[] = songs.map((song) => ({ id: song.id, links: [] }));
    await mapLimit(songs.flatMap((song, index) => settings.platforms.map((platform) => ({ song, index, platform }))), 4, async ({ song, index, platform }) => {
      const fallback: PlatformLink = { platform, url: platformSearchLink(platform, song, settings), kind: 'search', status: 'not-found' };
      const configured = platform === 'apple' ? Boolean(credentials.appleToken) : platform === 'spotify' ? Boolean(credentials.spotifyClientId && credentials.spotifyClientSecret) : true;
      if (!configured) fallback.status = 'unconfigured';
      else try {
        signal.throwIfAborted();
        const found = rankCandidates(song, await search(platform, song, settings, credentials, signal, token)).find((candidate) => canUseLyricCandidate(song, candidate) && isDirectPlatformUrl(candidate.url, platform));
        if (found) { fallback.url = found.url; fallback.kind = 'direct'; fallback.status = 'matched'; if (found.artwork && !results[index].artwork) results[index].artwork = found.artwork; }
      } catch { fallback.status = 'unavailable'; }
      results[index].links.push(fallback);
    });
    for (const result of results) result.links.sort((a, b) => settings.platforms.indexOf(a.platform) - settings.platforms.indexOf(b.platform));
    return results;
  }
  return { json, search, verify, links, spotifyToken };
}
