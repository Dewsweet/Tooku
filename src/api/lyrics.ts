import { isCandidate, isLyricDocument, isProvider, record, type FetchResult, type LyricsStatus, type ProviderId, type SearchResult, type TrackDescriptor } from '../domain/lyrics/types';

export class NetworkLyricsError extends Error {
  constructor(message: string) { super(message); }
}
export function isLyricsStatus(v: unknown): v is LyricsStatus {
  return record(v) && v.version === 1 && typeof v.enabled === 'boolean' && ['sqlite', 'memory'].includes(String(v.cache)) && Array.isArray(v.providers) && v.providers.length <= 2 && v.providers.every((p) => record(p) && isProvider(p.id) && ['search', 'lyrics'].every((kind) => {
    const observation = p[kind];
    return record(observation) && ['checkedAt', 'successAt', 'elapsedMs'].every((key) => observation[key] === undefined || typeof observation[key] === 'number' && Number.isFinite(observation[key])) && (observation.error === undefined || ['timeout', 'rate-limited', 'login-required', 'unavailable', 'protocol', 'disabled'].includes(String(observation.error)));
  }));
}
export class TookuLyricsApi {
  async #request(path: string, data?: unknown, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try { response = await fetch(`/api/lyrics/${path}`, { method: data === undefined ? 'GET' : 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }); }
    catch (e) { if (signal?.aborted) throw e; throw new NetworkLyricsError('网络歌词服务暂不可用'); }
    let body: unknown; try { body = await response.json(); } catch { throw new NetworkLyricsError('网络歌词服务尚未启动，请重启 Tooku'); }
    if (!response.ok) throw new NetworkLyricsError(record(body) && typeof body.error === 'string' ? body.error : '网络歌词服务暂不可用');
    return body;
  }
  async status(signal?: AbortSignal): Promise<LyricsStatus> { const data = await this.#request('status', undefined, signal); if (!isLyricsStatus(data)) throw new NetworkLyricsError('歌词服务版本不兼容'); return data; }
  async check(providers: ProviderId[], signal?: AbortSignal): Promise<LyricsStatus> { const data = await this.#request('check', { providers }, signal); if (!isLyricsStatus(data)) throw new NetworkLyricsError('歌词服务版本不兼容'); return data; }
  async search(track: TrackDescriptor, providers: ProviderId[], signal?: AbortSignal, refresh = false, keyword?: string): Promise<SearchResult> {
    const data = await this.#request('search', { track, providers, refresh, keyword }, signal);
    if (!record(data) || data.version !== 1 || !Array.isArray(data.candidates) || data.candidates.length > 20 || !data.candidates.every(isCandidate) || !Array.isArray(data.errors) || !data.errors.every((e) => record(e) && isProvider(e.provider) && typeof e.code === 'string')) throw new NetworkLyricsError('网络歌词搜索结果无效');
    return { version: 1, candidates: data.candidates, errors: data.errors.filter((e): e is SearchResult['errors'][number] => record(e) && isProvider(e.provider) && ['timeout', 'rate-limited', 'login-required', 'unavailable', 'protocol', 'disabled'].includes(String(e.code))) };
  }
  async lyrics(provider: ProviderId, id: string, signal?: AbortSignal, refresh = false): Promise<FetchResult> {
    const data = await this.#request('fetch', { provider, id, refresh }, signal);
    if (!record(data) || data.version !== 1 || !isLyricDocument(data.document) || data.document.source !== provider || data.document.recordId !== id || typeof data.cached !== 'boolean' || typeof data.stale !== 'boolean') throw new NetworkLyricsError('网络歌词内容无效');
    return { version: 1, document: data.document, cached: data.cached, stale: data.stale };
  }
}
// Stateless client; the React layer supplies the existing QueryClient for caching.
export const lyricsApi = new TookuLyricsApi();
