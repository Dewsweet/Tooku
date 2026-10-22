// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createRequestCache } from '../server/recommendations/cache';
import { createCatalog } from '../server/recommendations/catalog';
import { defaultRecommendationSettings as settings, emptyRecommendationCredentials, type RecommendationSong } from '../src/domain/recommendations';

const signal = () => new AbortController().signal;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const credentials = { ...emptyRecommendationCredentials, spotifyClientId: crypto.randomUUID(), spotifyClientSecret: crypto.randomUUID(), appleToken: crypto.randomUUID() };
const song: RecommendationSong = { id: 'song', title: 'Discovery', artists: ['Performer'], album: 'Model guess', reason: 'fixture', origin: 'ai' };
afterEach(() => vi.restoreAllMocks());

it('expires and bounds cached values, protects them from mutation and clears them on close', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000); const cache = createRequestCache<{ title: string }>(2);
  const load = vi.fn(async () => ({ value: { title: 'Real title' }, ttl: 5000 }));
  const first = await cache.get('a', signal(), load); first.title = 'Changed by caller';
  await cache.get('b', signal(), load);
  expect((await cache.get('a', signal(), load)).title).toBe('Real title');
  await cache.get('c', signal(), load); await cache.get('b', signal(), load);
  expect(load).toHaveBeenCalledTimes(4);
  clock.mockReturnValue(6000); await cache.get('b', signal(), load); expect(load).toHaveBeenCalledTimes(5);
  cache.clear(); await cache.get('b', signal(), load); expect(load).toHaveBeenCalledTimes(6);
});

it('shares a pending lookup while cancelling only the caller that left', async () => {
  const cache = createRequestCache<string>(2); const first = new AbortController(); const second = new AbortController();
  let resolve!: (value: { value: string; ttl: number }) => void; let upstream!: AbortSignal;
  const load = vi.fn((shared: AbortSignal) => { upstream = shared; return new Promise<{ value: string; ttl: number }>((done) => { resolve = done; }); });
  const a = cache.get('shared', first.signal, load); const b = cache.get('shared', second.signal, load);
  await Promise.resolve(); first.abort(); await expect(a).rejects.toMatchObject({ name: 'AbortError' });
  expect(upstream.aborted).toBe(false); expect(load).toHaveBeenCalledOnce();
  resolve({ value: 'verified', ttl: 5000 }); expect(await b).toBe('verified');
  expect(await cache.get('shared', signal(), load)).toBe('verified'); expect(load).toHaveBeenCalledOnce();
});

it('aborts unused work and prevents a late cancelled result from overwriting a newer lookup', async () => {
  const cache = createRequestCache<string>(2); const caller = new AbortController();
  let resolve!: (value: { value: string; ttl: number }) => void; let upstream!: AbortSignal;
  const load = vi.fn((shared: AbortSignal) => { upstream = shared; return new Promise<{ value: string; ttl: number }>((done) => { resolve = done; }); });
  const old = cache.get('same', caller.signal, load); await Promise.resolve();
  caller.abort(); await expect(old).rejects.toMatchObject({ name: 'AbortError' }); expect(upstream.aborted).toBe(true);
  const fresh = vi.fn(async () => ({ value: 'new', ttl: 5000 }));
  expect(await cache.get('same', signal(), fresh)).toBe('new');
  resolve({ value: 'old', ttl: 5000 }); await Promise.resolve(); await Promise.resolve();
  expect(await cache.get('same', signal(), fresh)).toBe('new'); expect(fresh).toHaveBeenCalledOnce();
});

it('does not cache errors, uncacheable lifetimes or oversized entries', async () => {
  const cache = createRequestCache<string>(2);
  await expect(cache.get('failed', signal(), async () => { throw new Error('fixture'); })).rejects.toThrow('fixture');
  const load = vi.fn(async () => ({ value: 'ok', ttl: 1000 }));
  expect(await cache.get('failed', signal(), load)).toBe('ok');
  const uncacheable = vi.fn(async () => ({ value: 'short', ttl: 0 }));
  await cache.get('zero', signal(), uncacheable); await cache.get('zero', signal(), uncacheable); expect(uncacheable).toHaveBeenCalledTimes(2);
  const large = vi.fn(async () => ({ value: 'x'.repeat(32769), ttl: 1000 }));
  await cache.get('large', signal(), large); await cache.get('large', signal(), large); expect(large).toHaveBeenCalledTimes(2);
});

it('never starts abandoned work and aborts pending requests when the service closes', async () => {
  const cache = createRequestCache<string>(2); const caller = new AbortController();
  const load = vi.fn(async () => ({ value: 'unused', ttl: 1000 }));
  const abandoned = cache.get('unused', caller.signal, load); caller.abort();
  await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' }); expect(load).not.toHaveBeenCalled();
  const active = cache.get('active', signal(), (shared) => new Promise<{ value: string; ttl: number }>((_resolve, reject) => shared.addEventListener('abort', () => reject(shared.reason), { once: true })));
  await Promise.resolve(); cache.clear(); await expect(active).rejects.toMatchObject({ name: 'AbortError' });
});

it('reuses catalog verification for links and only returns catalog-supplied metadata', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const fetcher = vi.fn<typeof fetch>(async () => json({ code: 200, result: { songs: [{ id: 123, name: song.title, artists: [{ name: 'Performer' }] }] } }));
  const catalog = createCatalog(fetcher); const config = { ...settings, platforms: ['netease' as const] };
  const verified = await catalog.verify({ ...song, durationMs: 180000, releaseDate: '2003' }, config, credentials, signal());
  expect(verified).toBeDefined(); expect(verified).not.toHaveProperty('album'); expect(verified).not.toHaveProperty('durationMs'); expect(verified).not.toHaveProperty('releaseDate');
  const links = await catalog.links([song], config, credentials, signal());
  expect(links[0].links[0].kind).toBe('direct'); expect(links[0]).not.toHaveProperty('album'); expect(fetcher).toHaveBeenCalledOnce();
  clock.mockReturnValue(301001); await catalog.links([song], config, credentials, signal()); expect(fetcher).toHaveBeenCalledTimes(2);
  catalog.close();
});

it('isolates catalog caches by platform credentials and region without automatically retrying failures', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ results: { songs: { data: [] } } })); const catalog = createCatalog(fetcher);
  await catalog.search('apple', song, settings, credentials, signal()); await catalog.search('apple', song, settings, credentials, signal());
  expect(fetcher).toHaveBeenCalledOnce();
  await catalog.search('apple', song, { ...settings, appleStorefront: 'us' }, credentials, signal());
  await catalog.search('apple', song, settings, { ...credentials, appleToken: crypto.randomUUID() }, signal());
  expect(fetcher).toHaveBeenCalledTimes(3);
  fetcher.mockImplementation(async () => new Response('', { status: 503 }));
  const failed = await catalog.links([song], { ...settings, platforms: ['netease', 'qq'] }, credentials, signal());
  expect(failed[0].links.every((link) => link.kind === 'search' && link.status === 'unavailable')).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(5);
  await catalog.links([song], { ...settings, platforms: ['netease', 'qq'] }, credentials, signal());
  expect(fetcher).toHaveBeenCalledTimes(7); catalog.close();
});

it('shares Spotify token requests, renews before expiry and isolates changed secrets', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000); const token = crypto.randomUUID();
  const fetcher = vi.fn<typeof fetch>(async () => json({ access_token: token, expires_in: 3600 })); const catalog = createCatalog(fetcher);
  expect(await Promise.all(Array.from({ length: 3 }, () => catalog.spotifyToken(credentials, signal())))).toEqual([token, token, token]);
  expect(fetcher).toHaveBeenCalledOnce();
  clock.mockReturnValue(3570999); await catalog.spotifyToken(credentials, signal()); expect(fetcher).toHaveBeenCalledOnce();
  clock.mockReturnValue(3571000); await catalog.spotifyToken(credentials, signal()); expect(fetcher).toHaveBeenCalledTimes(2);
  await catalog.spotifyToken({ ...credentials, spotifyClientSecret: crypto.randomUUID() }, signal()); expect(fetcher).toHaveBeenCalledTimes(3);
  catalog.close(); await catalog.spotifyToken(credentials, signal()); expect(fetcher).toHaveBeenCalledTimes(4);
});

it('discards a rejected Spotify token for future requests and falls back without retrying the current lookup', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => new URL(String(input)).hostname === 'accounts.spotify.com'
    ? json({ access_token: crypto.randomUUID(), expires_in: 3600 }) : new Response('', { status: 401 }));
  const catalog = createCatalog(fetcher); const config = { ...settings, platforms: ['spotify' as const] };
  const result = await catalog.links([song], config, credentials, signal());
  expect(result[0].links[0]).toMatchObject({ kind: 'search', status: 'unavailable' }); expect(fetcher).toHaveBeenCalledTimes(2);
  await catalog.links([song], config, credentials, signal()); expect(fetcher).toHaveBeenCalledTimes(4);
  catalog.close();
});
