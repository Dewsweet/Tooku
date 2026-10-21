import { isRecommendationBatch, isResolvedSong, recommendationRecord, emptyRecommendationCredentials, defaultRecommendationSettings, type ListeningSeed, type RecommendationCredentials, type RecommendationSettings, type RecommendationSong } from '../domain/recommendations';

export class RecommendationsApi {
  async request(path: 'generate' | 'links' | 'check', data: unknown, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`/api/recommendations/${path}`, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(path === 'generate' ? 105000 : path === 'check' ? 55000 : 25000)]) });
    } catch { if (signal?.aborted) throw signal.reason; throw new Error('推荐服务未完成，请检查连接或稍后重试'); }
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(recommendationRecord(result) && typeof result.error === 'string' && result.error.length <= 180 ? result.error : '推荐服务暂不可用');
    return result;
  }
  async generate(seeds: ListeningSeed[], settings: RecommendationSettings, credentials: RecommendationCredentials, excluded: string[], signal?: AbortSignal) {
    const result = await this.request('generate', { seeds, settings, credentials: { ...emptyRecommendationCredentials, lastfmKey: credentials.lastfmKey.trim(), aiKey: credentials.aiKey.trim(), appleToken: credentials.appleToken.trim() }, excluded }, signal);
    if (!isRecommendationBatch(result)) throw new Error('推荐结果格式无效');
    return result;
  }
  async links(songs: RecommendationSong[], settings: RecommendationSettings, credentials: RecommendationCredentials, signal?: AbortSignal) {
    const result = await this.request('links', { songs, settings, credentials: { ...emptyRecommendationCredentials, appleToken: credentials.appleToken.trim(), spotifyClientId: credentials.spotifyClientId.trim(), spotifyClientSecret: credentials.spotifyClientSecret.trim() } }, signal);
    if (!Array.isArray(result) || result.length !== songs.length || !result.every(isResolvedSong) || new Set(result.map((song) => song.id)).size !== songs.length || result.some((song) => !songs.some((input) => input.id === song.id))) throw new Error('平台链接格式无效');
    return result;
  }
  async check(target: 'lastfm' | 'ai' | 'apple' | 'spotify', settings: RecommendationSettings, credentials: RecommendationCredentials, signal?: AbortSignal) {
    const selected = { ...emptyRecommendationCredentials };
    if (target === 'lastfm') selected.lastfmKey = credentials.lastfmKey.trim();
    if (target === 'ai') selected.aiKey = credentials.aiKey.trim();
    if (target === 'apple') selected.appleToken = credentials.appleToken.trim();
    if (target === 'spotify') { selected.spotifyClientId = credentials.spotifyClientId.trim(); selected.spotifyClientSecret = credentials.spotifyClientSecret.trim(); }
    const config = { ...defaultRecommendationSettings };
    if (target === 'ai') { config.aiBaseUrl = settings.aiBaseUrl; config.model = settings.model; }
    if (target === 'apple') config.appleStorefront = settings.appleStorefront;
    if (target === 'spotify') config.spotifyMarket = settings.spotifyMarket;
    const result = await this.request('check', { target, settings: config, credentials: selected }, signal);
    if (!recommendationRecord(result) || result.ok !== true) throw new Error('服务检测未完成');
    return '连接成功';
  }
}
export const recommendationsApi = new RecommendationsApi();
