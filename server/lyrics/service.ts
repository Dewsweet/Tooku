import { resolve } from 'node:path';
import { isCandidate, isLyricDocument, type FetchResult, type LyricsStatus, type ProviderId, type ProviderStatus, type SearchResult, type TrackDescriptor } from '../../src/domain/lyrics/types.ts';
import { createProviders, LyricsError, type LyricProvider } from './providers.ts';
import { LyricsCache } from './cache.ts';
import { rankCandidates } from './matching.ts';
import { canUseLyricCandidate } from '../../src/domain/lyrics/matching.ts';

export function createLyricsService(options: { providers?: LyricProvider[]; filename?: string; now?: () => number; enabled?: boolean; intervalMs?: number } = {}) {
  const providers = options.providers ?? createProviders(); const now = options.now ?? Date.now;
  const enabled = options.enabled ?? process.env.TOOKU_LYRICS_ENABLED !== 'false';
  const cache = new LyricsCache(options.filename ?? resolve(process.env.TOOKU_DATA_DIR || '.local/data', 'lyrics-cache.sqlite'));
  const root = new AbortController(); const jobs = new Map<string, Promise<unknown>>();
  const tails = new Map<ProviderId, Promise<unknown>>(); const last = new Map<ProviderId, number>();
  const refreshAfter = new Map<string, number>();
  const states: ProviderStatus[] = providers.map((p) => ({ id: p.id, search: {}, lyrics: {} }));
  function status(): LyricsStatus { return { version: 1, enabled, cache: cache.mode, providers: states.map((p) => ({ ...p, search: { ...p.search }, lyrics: { ...p.lyrics } })) }; }
  function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
    const pending = jobs.get(key); if (pending) return pending as Promise<T>;
    if (jobs.size >= 100) return Promise.reject(new LyricsError('rate-limited'));
    const task = run().finally(() => jobs.delete(key)); jobs.set(key, task); return task;
  }
  async function operation<T>(id: ProviderId, kind: 'search' | 'lyrics', run: (provider: LyricProvider, signal: AbortSignal) => Promise<T>, valid: (data: T) => boolean): Promise<T> {
    if (!enabled || root.signal.aborted) throw new LyricsError('disabled');
    const provider = providers.find((p) => p.id === id); const state = states.find((p) => p.id === id);
    if (!provider || !state) throw new LyricsError('disabled');
    const deadline = AbortSignal.any([root.signal, AbortSignal.timeout(6000)]);
    const prior = tails.get(id) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(async () => {
      if (root.signal.aborted) throw new LyricsError('disabled');
      if (deadline.aborted) throw new LyricsError('timeout');
      if ((state.retryAt ?? 0) > now()) throw new LyricsError('rate-limited');
      const wait = (options.intervalMs ?? 250) - (now() - (last.get(id) ?? 0));
      if (wait > 0) await new Promise<void>((done) => {
        const finish = () => { clearTimeout(timer); root.signal.removeEventListener('abort', finish); done(); };
        const timer = setTimeout(finish, wait);
        root.signal.addEventListener('abort', finish, { once: true });
      });
      if (root.signal.aborted) throw new LyricsError('disabled');
      const started = now(); last.set(id, started);
      try {
        deadline.throwIfAborted();
        const result = await run(provider, deadline);
        const finished = now();
        state[kind] = { checkedAt: finished, elapsedMs: finished - started, successAt: valid(result) ? finished : state[kind].successAt }; state.retryAt = undefined;
        return result;
      } catch (e) {
        const error = e instanceof LyricsError ? e : new LyricsError(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'unavailable');
        state[kind] = { ...state[kind], checkedAt: now(), elapsedMs: now() - started, error: error.code };
        state.retryAt = error.code === 'rate-limited' ? now() + 60000 : undefined; throw error;
      }
    });
    tails.set(id, task); return task;
  }
  async function search(track: TrackDescriptor, ids: ProviderId[], refresh = false, keyword?: string): Promise<SearchResult> {
    if (!enabled || root.signal.aborted) throw new LyricsError('disabled');
    const result: SearchResult = { version: 1, candidates: [], errors: [] };
    for (const id of ids) {
      const query = keyword?.trim() || `${track.title} ${track.artists.join(' ')}`.trim();
      const titleOnly = track.title.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, '').trim();
      const key = `search:v3:${id}:${JSON.stringify([query, track])}`;
      const saved = !refresh && cache.get(key, now());
      try {
        let candidates: import('../../src/domain/lyrics/types.ts').LyricCandidate[];
        if (saved && !saved.stale && Array.isArray(saved.value) && saved.value.every(isCandidate)) candidates = saved.value;
        else candidates = await shared(key, async () => {
          const items = await operation(id, 'search', async (p, signal) => {
            const read = async (text: string) => {
              const found = await p.search(text, signal);
              if (!found.every(isCandidate) || found.some((c) => c.provider !== id)) throw new LyricsError('protocol');
              return found.slice(0, 10);
            };
            const found = await read(query);
            if (id === 'netease' && titleOnly && titleOnly !== query && !found.some((candidate) => canUseLyricCandidate(track, candidate)) && !signal.aborted) {
              try {
                const extra = await read(titleOnly);
                return rankCandidates(track, [...new Map([...found, ...extra].map((candidate) => [candidate.id, candidate])).values()]).slice(0, 10);
              } catch (error) {
                if (!found.length || error instanceof LyricsError && error.code === 'rate-limited') throw error;
              }
            }
            return found;
          }, (items) => items.length > 0);
          cache.put(key, items, items.length ? 3600000 : 21600000, now()); return items;
        });
        result.candidates.push(...rankCandidates(track, candidates));
      } catch (e) { result.errors.push({ provider: id, code: e instanceof LyricsError ? e.code : 'unavailable' }); }
    }
    return result;
  }
  async function lyrics(id: ProviderId, recordId: string, refresh = false): Promise<FetchResult> {
    if (!enabled || root.signal.aborted) throw new LyricsError('disabled');
    const key = `lyrics:${id === 'qq' ? 'v2' : 'v1'}:${id}:${recordId}`; const saved = !refresh && cache.get(key, now());
    if (saved && isLyricDocument(saved.value) && saved.value.source === id && saved.value.recordId === recordId) {
      // Stale data stays available, but never updates the provider observation.
      if (!saved.stale || saved.value.tracks.some((t) => t.text?.trim()) || saved.value.instrumental) {
        if (saved.stale && (refreshAfter.get(key) ?? 0) < now()) {
          // Serve stale lyrics immediately; failures retry at most once per hour.
          if (refreshAfter.size >= 5000) refreshAfter.delete(refreshAfter.keys().next().value!);
          refreshAfter.set(key, now() + 3600000);
          void lyrics(id, recordId, true).catch(() => {});
        }
        return { version: 1, document: saved.value, cached: true, stale: saved.stale };
      }
    }
    return shared(key, async () => {
      const document = await operation(id, 'lyrics', async (p, signal) => {
        const doc = await p.lyrics(recordId, signal);
        if (!isLyricDocument(doc) || doc.source !== id || doc.recordId !== recordId) throw new LyricsError('protocol');
        return doc;
      }, (doc) => Boolean(doc.instrumental || doc.tracks.some((t) => t.role === 'original' && t.text?.trim())));
      cache.put(key, document, document.instrumental || document.tracks.some((t) => t.text?.trim()) ? 604800000 : 21600000, now());
      return { version: 1, document, cached: false, stale: false };
    });
  }
  function check(ids: ProviderId[]) {
    return shared(`check:${ids.join(',')}`, async () => {
      for (const id of ids) {
        const state = states.find((p) => p.id === id);
        const recent = (kind: 'search' | 'lyrics') => state?.[kind].checkedAt !== undefined && now() - state[kind].checkedAt! < 30000;
        if (!recent('search')) await search({ title: '海阔天空', artists: ['Beyond'] }, [id], true);
        if (!recent('lyrics')) try { await lyrics(id, id === 'netease' ? '186016' : '0039MnYb0qxYhV', true); } catch { /* observations retain the real failure */ }
      }
      return status();
    });
  }
  return { status, search, lyrics, check, close() { root.abort(); refreshAfter.clear(); cache.close(); } };
}
export type LyricsService = ReturnType<typeof createLyricsService>;
