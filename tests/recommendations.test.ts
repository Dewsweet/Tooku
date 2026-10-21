// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { getCACertificates } from 'node:tls';
import { catalogReleaseDate } from '../src/domain/musicMetadata';
import { listeningSeeds, defaultRecommendationSettings as settings, emptyRecommendationCredentials, isRecommendationProfile, isRecommendationBatch, recommendationCount, recommendationContext, rememberRecommendationBatch, isResolvedSong, isDirectPlatformUrl, songKey, type RecommendationSong, type ListeningSeed } from '../src/domain/recommendations';
import { balancedSeeds, candidatePool } from '../server/recommendations/ranking';
import { selectRecommendations, createRecommendationService as createService, modelCompatibility, readModelJson } from '../server/recommendations/service';
import { createCatalog, object, text } from '../server/recommendations/catalog';
import { createRecommendationsApi } from '../server/recommendations/http';
import { limitedJson, publicAddress, resolveModelEndpoint, modelCertificateAuthorities, modelHttpError, RecommendationError, type modelCompletion } from '../server/recommendations/network';

const credentials = { ...emptyRecommendationCredentials, lastfmKey: crypto.randomUUID(), aiKey: crypto.randomUUID(), spotifyClientId: crypto.randomUUID(), spotifyClientSecret: crypto.randomUUID(), appleToken: crypto.randomUUID() };
const seed: ListeningSeed = { title: 'Seed', artists: ['Artist'], plays: 1, weight: 1 };
const song: RecommendationSong = { id: 'candidate', title: 'New song', artists: ['Artist'], durationMs: 180000, reason: '相关歌曲', origin: 'lastfm' };
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const cleanups: (() => void | Promise<void>)[] = [];
const createRecommendationService = (options: Parameters<typeof createService>[0] = {}) => createService({ ...options, lastfmIntervalMs: 0 });
afterEach(async () => { for (const stop of cleanups.splice(0).reverse()) await stop(); vi.restoreAllMocks(); });

it('aggregates repeated listens without mutating history or letting a loop consume the sample', () => {
  const now = Date.now();
  const history = Array.from({ length: 80 }, (_, i) => ({ occurrenceId: String(i), track: { id: String(i), title: i < 40 ? 'Repeated' : `Song ${i}`, artist: 'Artist' }, listenedAt: now - i * 86400000, submitted: true }));
  const before = structuredClone(history); const seeds = listeningSeeds(history, 30, now);
  expect(seeds).toHaveLength(30); expect(seeds[0].plays).toBe(40); expect(seeds[0].weight).toBeLessThanOrEqual(5);
  expect(seeds[0].weight).toBeGreaterThan(seeds[1].weight); expect(history).toEqual(before);
  expect(listeningSeeds([], 50)).toEqual([]);
});

it('excludes listening seeds and the previous batch, caps performers and honors exploration when possible', () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({ song: { ...song, id: `s${i}`, title: `Song ${i}`, artists: [i < 12 ? `Familiar ${Math.floor(i / 2)}` : `New ${i}`] }, score: 50 - i }));
  candidates.unshift({ song: { ...song, id: 'seed', title: seed.title }, score: 100 });
  const seeds = Array.from({ length: 6 }, (_, i) => ({ ...seed, artists: [`Familiar ${i}`] })); seeds.push(seed);
  const selected = selectRecommendations(candidates, seeds, .3, ['s29'], 10);
  expect(selected).toHaveLength(10); expect(selected.some((s) => s.id === 'seed' || s.id === 's29')).toBe(false);
  expect(selected.filter((s) => s.artists[0].startsWith('New')).length).toBeGreaterThanOrEqual(3);
  expect(new Set(selected.map((song) => song.artists[0])).size).toBe(selected.length);
});

it('validates persistence without credentials, rejects arbitrary links and separates search from direct tracks', () => {
  expect(isRecommendationProfile({ settings })).toBe(true);
  expect(isRecommendationProfile({ settings, credentials })).toBe(false);
  expect(isRecommendationProfile({ settings: { ...settings, aiKey: credentials.aiKey } })).toBe(false);
  for (const aiBaseUrl of ['http://example.com/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=private']) expect(isRecommendationProfile({ settings: { ...settings, aiBaseUrl } })).toBe(false);
  expect(isResolvedSong({ id: song.id, links: [{ platform: 'spotify', url: 'https://open.spotify.com/track/123', kind: 'direct', status: 'matched' }] })).toBe(true);
  for (const url of ['javascript:alert(1)', 'https://open.spotify.com.evil.test/track/123', 'https://open.spotify.com/logout', 'https://open.spotify.com/track/123?token=private']) expect(isResolvedSong({ id: song.id, links: [{ platform: 'spotify', url, kind: 'direct', status: 'matched' }] })).toBe(false);
  expect(isDirectPlatformUrl('https://music.apple.com/us/album/test/123?i=456', 'apple')).toBe(true);
});

it('keeps legacy profiles readable and validates thirty results and bounded recommendation history', () => {
  const legacySettings = { ...settings }; delete legacySettings.resultCount;
  expect(isRecommendationProfile({ settings: legacySettings })).toBe(true);
  expect(recommendationCount(legacySettings)).toBe(30);
  const songs = Array.from({ length: 30 }, (_, index) => ({ ...song, id: `result${index}`, title: `Result ${index}` }));
  const batch = { id: 'batch', createdAt: Date.now(), sampleCount: 50, mode: 'algorithm', songs, notices: [] };
  expect(isRecommendationBatch(batch)).toBe(true);
  expect(isRecommendationBatch({ ...batch, songs: [...songs, { ...song, id: 'excess' }] })).toBe(false);
  expect(isRecommendationProfile({ settings, batch, seenIds: Array.from({ length: 300 }, (_, index) => `seen${index}`) })).toBe(true);
  expect(isRecommendationProfile({ settings: { ...settings, resultCount: 31 } })).toBe(false);
  expect(isRecommendationProfile({ settings, seenIds: ['repeated', 'repeated'] })).toBe(false);
  const batchData = { ...batch, mode: 'algorithm' as const };
  const previous = { settings, seenIds: Array.from({ length: 300 }, (_, index) => `older${index}`), recentSongs: Array.from({ length: 90 }, (_, index) => ({ id: `older${index}`, title: `Previous ${index}`, artists: ['Artist'] })) };
  const remembered = rememberRecommendationBatch(previous, batchData);
  expect(isRecommendationProfile(remembered)).toBe(true);
  expect(remembered.seenIds).toHaveLength(300); expect(remembered.seenIds?.[0]).toBe('older30');
  expect(remembered.recentSongs).toHaveLength(90); expect(remembered.recentSongs?.[0].id).toBe('older30');
  expect(recommendationContext({ settings, batch: batchData })).toHaveLength(30);
  expect(Object.keys(remembered.recentSongs![89])).toEqual(['id', 'title', 'artists']);
});

it('covers all fifty listening seeds, balances their influence and produces thirty distinct performers', async () => {
  const seeds = Array.from({ length: 50 }, (_, index) => ({ ...seed, title: `Seed ${index}`, artists: [index < 20 ? 'Repeated artist' : `Heard artist ${index}`], weight: index < 2 ? 5 : 1 }));
  const queried: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const title = new URL(String(input)).searchParams.get('track')!; queried.push(title);
    return json({ similartracks: { track: Array.from({ length: 5 }, (_, index) => ({ name: `${title} found ${index}`, artist: { name: `${title} discover ${index}` }, match: .9 })) } });
  });
  const ordered = balancedSeeds(seeds);
  expect(ordered.slice(0, 10).filter((item) => item.artists[0] === 'Repeated artist')).toHaveLength(1);
  const result = await createRecommendationService({ fetcher, random: () => .5 }).generate(seeds, { ...settings, mode: 'algorithm' }, credentials, [], new AbortController().signal);
  expect(new Set(queried)).toEqual(new Set(seeds.map((item) => item.title)));
  expect(result.sampleCount).toBe(50); expect(result.songs).toHaveLength(30);
  expect(new Set(result.songs.map((item) => item.artists[0])).size).toBe(30);
  expect(new Set(result.songs.map((item) => item.reason)).size).toBeGreaterThanOrEqual(25);
});

it('preserves low-weight source coverage and avoids repeated albums and previous recommendation batches', () => {
  const candidates = Array.from({ length: 90 }, (_, index) => ({ song: { ...song, id: `new${index}`, title: `New ${index}`, artists: [`New artist ${index}`], album: index < 5 ? 'Same album' : `Album ${index}` }, score: index < 20 ? 1.5 : 1, sources: [index < 20 ? 'dominant' : `source${index}`] }));
  const pool = candidatePool(candidates, [seed], []);
  expect(pool.some((item) => item.sources?.includes('source89'))).toBe(true);
  const first = selectRecommendations(candidates, [seed], .7, [], 30);
  expect(first).toHaveLength(30); expect(new Set(first.map((item) => item.album)).size).toBe(first.length);
  expect(first.filter((item) => Number(item.id.slice(3)) < 20).length).toBeLessThanOrEqual(2);
  const second = selectRecommendations(candidates, [seed], .7, first.map((item) => item.id), 30);
  expect(second).toHaveLength(30); expect(second.every((item) => !first.some((previous) => previous.id === item.id))).toBe(true);
  const third = selectRecommendations(candidates, [seed], .7, [...first, ...second].map((item) => item.id), 30);
  expect(third.every((item) => ![...first, ...second].some((previous) => previous.id === item.id))).toBe(true);
});

it('expands narrow algorithm pools through related unfamiliar tracks', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const title = new URL(String(input)).searchParams.get('track');
    return json({ similartracks: { track: title === seed.title ? [{ name: 'Bridge', artist: { name: 'Bridge artist' }, match: .9 }] : Array.from({ length: 20 }, (_, index) => ({ name: `Deeper ${index}`, artist: { name: `Unfamiliar ${index}` }, match: .8 })) } });
  });
  const result = await createRecommendationService({ fetcher, random: () => .5 }).generate([seed], { ...settings, mode: 'algorithm', resultCount: 20 }, credentials, [], new AbortController().signal);
  expect(result.songs).toHaveLength(20);
  expect(result.songs.some((item) => item.reason === '沿近期收听的相似音乐继续探索')).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('can explore beyond a previously recommended bridge and cancels paced Last.fm work', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const title = new URL(String(input)).searchParams.get('track');
    return json({ similartracks: { track: [{ name: title === seed.title ? 'Bridge' : 'Further', artist: { name: title === seed.title ? 'Bridge artist' : 'Further artist' }, match: .9 }] } });
  });
  const service = createRecommendationService({ fetcher });
  const config = { ...settings, mode: 'algorithm' as const };
  const first = await service.generate([seed], config, credentials, [], new AbortController().signal);
  const bridge = first.songs.find((item) => item.title === 'Bridge'); expect(bridge).toBeDefined();
  const next = await service.generate([seed], config, credentials, [bridge!.id], new AbortController().signal);
  expect(next.songs.map((item) => item.title)).toEqual(['Further']);
  vi.useFakeTimers();
  try {
    const paced = createService({ fetcher });
    await paced.check('lastfm', settings, credentials, new AbortController().signal);
    const before = fetcher.mock.calls.length; const controller = new AbortController();
    const canceled = paced.check('lastfm', settings, credentials, controller.signal);
    const rejection = expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejection;
    expect(fetcher).toHaveBeenCalledTimes(before);
  } finally { vi.useRealTimers(); }
});

it('lets hybrid AI nominate verified discoveries beyond Last.fm while supplying every seed', async () => {
  const seeds = Array.from({ length: 40 }, (_, index) => ({ ...seed, title: `Heard ${index}` }));
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'ws.audioscrobbler.com') return json({ similartracks: { track: [{ name: 'Known candidate', artist: { name: 'Related artist' }, match: .9 }] } });
    return json({ code: 200, result: { songs: [{ id: 123, name: 'Beyond the pool', artists: [{ name: 'New discovery' }], album: { name: 'New record' }, duration: 180000 }] } });
  });
  const complete = vi.fn<typeof modelCompletion>(async (_base, _key, payload) => {
    const messages = object(payload).messages; if (!Array.isArray(messages)) throw new Error('Missing prompt');
    const input = object(JSON.parse(text(object(messages[1]).content)));
    expect(input.seeds).toHaveLength(40); expect(input.variation).toEqual(expect.any(String)); expect(input.avoid).toEqual(expect.arrayContaining([{ title: 'Already recommended', artists: ['Other artist'] }]));
    return { choices: [{ message: { content: JSON.stringify({ ids: ['c1'], songs: [{ title: 'Beyond the pool', artists: ['New discovery'], basedOn: [40] }] }) } }] };
  });
  const result = await createRecommendationService({ fetcher, complete }).generate(seeds, { ...settings, aiBaseUrl: 'https://example.com/v1', model: 'fixture' }, credentials, [], new AbortController().signal, [{ id: 'older-result', title: 'Already recommended', artists: ['Other artist'] }]);
  expect(result.mode).toBe('hybrid'); expect(result.songs.map((item) => item.title)).toContain('Beyond the pool');
  expect(result.songs.find((item) => item.origin === 'ai')?.reason).toContain('Heard 39');
});

it('rejects private, reserved and DNS-rebound model destinations before sending credentials', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.2', '192.88.99.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1', '2001:db8::1', '2001:0db8::1', '2001:20::1', '3fff::1', '3::1', '200::1']) expect(publicAddress(address)).toBe(false);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) expect(publicAddress(address)).toBe(true);
  const resolver = vi.fn(async () => [{ address: '1.1.1.1', family: 4 }]);
  const result = await resolveModelEndpoint('https://example.com/v1', resolver); expect(result.url.href).toBe('https://example.com/v1/chat/completions');
  expect((await resolveModelEndpoint('https://example.com/v1/chat/completions', resolver)).url.href).toBe(result.url.href);
  expect((await resolveModelEndpoint('https://example.com/v1/chat/completions/', resolver)).url.href).toBe(result.url.href);
  resolver.mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  await expect(resolveModelEndpoint('https://example.com/v1', resolver)).rejects.toThrow('公网地址');
  await expect(resolveModelEndpoint('http://example.com/v1', resolver)).rejects.toThrow('HTTPS');
  await expect(resolveModelEndpoint('https://127.0.0.1/v1', resolver)).rejects.toThrow('公网地址');
  await expect(limitedJson(new Response('x'.repeat(1048577)))).rejects.toThrow('大小限制');
});

it('loads the production service in the native Node TypeScript runtime', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./server/recommendations/http.ts')"], { cwd: process.cwd(), encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});

it('normalizes official DeepSeek URLs for checks and generation and retains system trust roots', async () => {
  const resolver = async () => [{ address: '1.1.1.1', family: 4 }];
  for (const base of ['https://api.deepseek.com', 'https://api.deepseek.com/', 'https://api.deepseek.com/v1', 'https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/v1/chat/completions/']) {
    expect((await resolveModelEndpoint(base, resolver)).url.href).toBe('https://api.deepseek.com/v1/chat/completions');
  }
  const authorities = new Set(modelCertificateAuthorities());
  expect(getCACertificates('default').every((ca) => authorities.has(ca))).toBe(true);
  expect(getCACertificates('system').every((ca) => authorities.has(ca))).toBe(true);
  expect((await resolveModelEndpoint('https://other.example.com/custom/v1', resolver)).url.href).toBe('https://other.example.com/custom/v1/chat/completions');
});

it('distinguishes empty model content from invalid JSON and supports text parts, fences and BOM', () => {
  expect(() => readModelJson({ choices: [{ message: { content: '  ' }, finish_reason: 'stop' }] })).toThrow('模型已连通，但返回了空内容');
  expect(() => readModelJson({ data: '<html>proxy</html>' })).toThrow('缺少 choices/message');
  expect(() => readModelJson({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })).toThrow('拒绝');
  expect(readModelJson({ choices: [{ message: { content: '\uFEFF```json\n{"ok":true}\n```' } }] })).toEqual({ ok: true });
  expect(readModelJson({ choices: [{ message: { content: [{ type: 'text', text: '{"ok":' }, { type: 'text', text: 'true}' }] } }] })).toEqual({ ok: true });
});

it('uses release metadata only when returned by a matching catalog and preserves its precision', async () => {
  expect(catalogReleaseDate('2003')).toBe('2003'); expect(catalogReleaseDate('2003-03')).toBe('2003-03');
  expect(catalogReleaseDate('2003-02-30')).toBeUndefined(); expect(catalogReleaseDate(0)).toBeUndefined();
  expect(catalogReleaseDate(Date.UTC(1963, 0, 1))).toBe('1963-01-01');
  const fetcher = vi.fn<typeof fetch>(async () => json({ code: 200, result: { songs: [{ id: 123, name: song.title, artists: [{ name: 'Artist' }], duration: 180000, publishTime: Date.UTC(2003, 2, 1), album: { name: 'Record' } }] } }));
  const catalog = createCatalog(fetcher); const config = { ...settings, platforms: ['netease'] as const };
  const result = await catalog.verify(song, { ...config, platforms: [...config.platforms] }, credentials, new AbortController().signal);
  expect(result).toMatchObject({ album: 'Record', durationMs: 180000, releaseDate: '2003-03-01' });
  const [resolved] = await catalog.links([song], { ...config, platforms: [...config.platforms] }, credentials, new AbortController().signal);
  expect(resolved).toMatchObject({ album: 'Record', durationMs: 180000, releaseDate: '2003-03-01' }); expect(isResolvedSong(resolved)).toBe(true);
  expect(isResolvedSong({ ...resolved, releaseDate: '2003-02-30' })).toBe(false);
});

it('falls back to algorithm results when model ranking fails, without returning secrets or provider errors', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ similartracks: { track: Array.from({ length: 15 }, (_, i) => ({ name: `Found ${i}`, artist: { name: `Singer ${i}` }, match: .9 })) } }));
  const complete = vi.fn<typeof modelCompletion>(async () => { throw new Error(credentials.aiKey); });
  const service = createRecommendationService({ fetcher, complete });
  const result = await service.generate([seed], { ...settings, resultCount: 10, aiBaseUrl: 'https://example.com/v1', model: 'fixture' }, credentials, [], new AbortController().signal);
  expect(result.songs).toHaveLength(10); expect(result.mode).toBe('algorithm'); expect(result.notices.some((notice) => notice.includes('AI 排序未完成') && notice.includes('本批使用算法推荐'))).toBe(true);
  expect(JSON.stringify(result)).not.toContain(credentials.aiKey);
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(9); expect(complete).toHaveBeenCalledOnce();
});

it('uses compact ranking ids and sufficient JSON output with thinking disabled on official DeepSeek', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ similartracks: { track: Array.from({ length: 20 }, (_, i) => ({ name: `Found ${i}`, artist: { name: `Singer ${i}` }, match: .9 })) } }));
  const complete = vi.fn<typeof modelCompletion>(async (_base, _key, payload) => {
    const data = object(payload); expect(data.thinking).toEqual({ type: 'disabled' }); expect(data.response_format).toEqual({ type: 'json_object' });
    expect(_base).toBe('https://api.deepseek.com/v1/chat/completions'); expect(data.stream).toBe(false);
    if (data.max_tokens === 1024) return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] };
    expect(Number(data.max_tokens)).toBeGreaterThanOrEqual(2048);
    const messages = Array.isArray(data.messages) ? data.messages : []; const prompt = object(JSON.parse(text(object(messages[1]).content)));
    const candidates = Array.isArray(prompt.candidates) ? prompt.candidates.map(object) : [];
    expect(candidates[0].id).toBe('c1'); expect(candidates.every((candidate) => /^c\d+$/.test(text(candidate.id)))).toBe(true);
    return { choices: [{ message: { content: JSON.stringify({ ids: candidates.map((candidate) => candidate.id).reverse() }) }, finish_reason: 'stop' }] };
  });
  const service = createRecommendationService({ fetcher, complete }); const deepseek = { ...settings, resultCount: 20 as const, aiBaseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
  expect(await service.check('ai', deepseek, credentials, new AbortController().signal)).toMatchObject({ ok: true });
  const result = await service.generate([seed], deepseek, credentials, [], new AbortController().signal);
  expect(result.mode).toBe('hybrid'); expect(result.songs[0].title).toBe('Found 19');
  expect(modelCompatibility('https://api.deepseek.com/v1').thinking).toEqual({ type: 'disabled' });
  expect(modelCompatibility('https://other.example.com/v1')).toEqual({});
});

it('reports model truncation, thinking-only output and safe HTTP causes without showing raw upstream errors', async () => {
  expect(() => readModelJson({ choices: [{ finish_reason: 'length', message: { content: '{"ids":[' } }] })).toThrow('被截断');
  expect(() => readModelJson({ choices: [{ message: { content: '', reasoning_content: 'private reasoning' } }] })).toThrow('只返回了思考内容');
  expect(() => readModelJson({ choices: [{ message: { content: credentials.aiKey } }] })).toThrow('有效 JSON');
  expect(modelHttpError(401).message).toContain('API Key 认证失败'); expect(modelHttpError(402).message).toContain('余额不足'); expect(modelHttpError(404).message).toContain('模型名称不存在');
  expect(modelHttpError(429).message).toContain('过于频繁'); expect(modelHttpError(422).message).toContain('参数无效');
  const fetcher = vi.fn<typeof fetch>(async () => json({ similartracks: { track: [{ name: 'Found', artist: { name: 'Singer' }, match: 1 }] } }));
  const complete = vi.fn<typeof modelCompletion>(async () => { throw modelHttpError(402); });
  const result = await createRecommendationService({ fetcher, complete }).generate([seed], { ...settings, aiBaseUrl: 'https://example.com/v1', model: 'fixture' }, credentials, [], new AbortController().signal);
  expect(result.notices.some((notice) => notice.includes('余额不足') && notice.includes('本批使用算法推荐'))).toBe(true);
  complete.mockRejectedValueOnce(new RecommendationError('模型请求超时，请稍后重试'));
  const timedOut = await createRecommendationService({ fetcher, complete }).generate([seed], { ...settings, aiBaseUrl: 'https://example.com/v1', model: 'fixture' }, credentials, [], new AbortController().signal);
  expect(timedOut.notices.some((notice) => notice.includes('模型请求超时'))).toBe(true);
});

it('treats missing Last.fm tracks as empty results while distinguishing credential and network failures', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ error: 6, message: 'Track not found' }));
  const service = createRecommendationService({ fetcher }); const config = { ...settings, mode: 'algorithm' as const };
  const missing = await service.generate([seed], config, credentials, [], new AbortController().signal);
  expect(missing.songs).toEqual([]); expect(missing.notices.some((notice) => notice.includes('未完成'))).toBe(false);
  fetcher.mockResolvedValueOnce(json({ similartracks: { '@attr': { artist: 'Artist' } } }));
  expect((await service.generate([seed], config, credentials, [], new AbortController().signal)).notices.some((notice) => notice.includes('未完成'))).toBe(false);
  fetcher.mockResolvedValueOnce(json({ error: 10, message: credentials.lastfmKey }));
  const invalid = await service.generate([seed], config, credentials, [], new AbortController().signal);
  expect(invalid.notices[0]).toContain('API Key 无效'); expect(JSON.stringify(invalid)).not.toContain(credentials.lastfmKey);
  fetcher.mockRejectedValueOnce(new DOMException('fixture', 'TimeoutError'));
  const timeout = await service.generate([seed], config, credentials, [], new AbortController().signal);
  expect(timeout.notices[0]).toContain('来源请求超时'); expect(timeout.notices[0]).toContain('0/1');
});

it('does not accept invented AI ids or songs that cannot be verified in a catalog', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'music.163.com') return json({ code: 200, result: { songs: [{ id: 123, name: 'Real song', artists: [{ name: 'Artist' }], duration: 180000, album: { name: 'Album' } }] } });
    return json({ code: 0, data: { song: { list: [] } } });
  });
  const complete = vi.fn<typeof modelCompletion>(async () => ({ choices: [{ message: { content: JSON.stringify({ songs: [{ title: 'Real song', artists: ['Artist'] }, { title: 'Imaginary', artists: ['Nobody'] }] }) } }] }));
  const service = createRecommendationService({ fetcher, complete });
  const result = await service.generate([seed], { ...settings, mode: 'ai', aiBaseUrl: 'https://example.com/v1', model: 'fixture' }, { ...credentials, appleToken: '' }, [], new AbortController().signal);
  expect(result.songs.map((s) => s.title)).toEqual(['Real song']); expect(result.songs[0].origin).toBe('ai'); expect(result.notices).toContain('未能核实的 AI 候选已略过');
  expect(JSON.stringify(vi.mocked(complete).mock.calls[0])).not.toContain('spotify');
});

it('accepts an AI ordering only for real candidates and never places credential fields in the prompt', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ similartracks: { track: Array.from({ length: 15 }, (_, i) => ({ name: `Found ${i}`, artist: { name: `Singer ${i}` }, match: .9 })) } }));
  const complete = vi.fn<typeof modelCompletion>(async (_base, _key, payload) => {
    const messages = object(payload).messages; if (!Array.isArray(messages)) throw new Error('Missing prompt');
    const input = object(JSON.parse(text(object(messages[1]).content)));
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    return { choices: [{ message: { content: JSON.stringify({ ids: candidates.map((candidate) => object(candidate).id).reverse() }) } }] };
  });
  const result = await createRecommendationService({ fetcher, complete }).generate([seed], { ...settings, aiBaseUrl: 'https://example.com/v1', model: 'fixture' }, credentials, [], new AbortController().signal);
  expect(result.mode).toBe('hybrid'); expect(result.songs[0].title).toBe('Found 14');
  const prompt = JSON.stringify(vi.mocked(complete).mock.calls[0][2]);
  for (const value of Object.values(credentials)) expect(prompt).not.toContain(value);
});

const discovery = (index: number) => ({ title: `Discovery ${index}`, artists: [`Performer ${index}`], album: `Record ${index}` });
const modelSongs = (songs: ReturnType<typeof discovery>[]) => ({ choices: [{ message: { content: JSON.stringify({ songs }) } }] });
const discoveryCatalog = (count: number) => vi.fn<typeof fetch>(async (input) => {
  const url = new URL(String(input)); const query = url.searchParams.get('s');
  if (url.hostname !== 'music.163.com') return json({ code: 0, data: { song: { list: [] } } });
  const index = Array.from({ length: count }, (_, i) => i).find((i) => query === `${discovery(i).title} ${discovery(i).artists[0]}`);
  return json({ code: 200, result: { songs: index === undefined ? [] : [{ id: index + 100, name: discovery(index).title, artists: [{ name: discovery(index).artists[0] }], album: { name: discovery(index).album }, duration: 180000 }] } });
});
const aiSettings = { ...settings, mode: 'ai' as const, aiBaseUrl: 'https://example.com/v1', model: 'fixture' };

it.each([10, 20, 30] as const)('fills skipped AI candidates to the requested %i songs without rechecking old proposals', async (count) => {
  const half = count / 2; const fetcher = discoveryCatalog(count);
  const complete = vi.fn<typeof modelCompletion>()
    .mockResolvedValueOnce(modelSongs([...Array.from({ length: half }, (_, i) => discovery(i)), discovery(999)]))
    .mockResolvedValueOnce(modelSongs([discovery(0), discovery(999), ...Array.from({ length: half }, (_, i) => discovery(half + i))]));
  const result = await createRecommendationService({ fetcher, complete }).generate([seed], { ...aiSettings, resultCount: count }, { ...credentials, appleToken: '' }, [], new AbortController().signal);
  expect(result.songs).toHaveLength(count); expect(new Set(result.songs.map((song) => song.id)).size).toBe(count);
  expect(result.songs.every((song) => song.title !== 'Discovery 999')).toBe(true);
  expect(complete).toHaveBeenCalledTimes(2); expect(result.mode).toBe('ai'); expect(result.notices).toEqual([]);
  const prompt = object(complete.mock.calls[1][2]); const messages = Array.isArray(prompt.messages) ? prompt.messages : [];
  const input = object(JSON.parse(text(object(messages[1]).content)));
  expect(input.missing).toBe(half); expect(input.accepted).toHaveLength(half);
  expect(input.avoid).toEqual(expect.arrayContaining([{ title: 'Discovery 999', artists: ['Performer 999'] }]));
  expect(input.candidates).toBeUndefined();
  const queries = fetcher.mock.calls.map(([url]) => new URL(String(url))).filter((url) => url.hostname === 'music.163.com').map((url) => url.searchParams.get('s'));
  expect(queries.filter((query) => query === 'Discovery 0 Performer 0')).toHaveLength(1);
  expect(queries.filter((query) => query === 'Discovery 999 Performer 999')).toHaveLength(1);
});

it('can recover from a fully skipped initial AI response and stops after two supplemental rounds', async () => {
  const fetcher = discoveryCatalog(10);
  const complete = vi.fn<typeof modelCompletion>()
    .mockResolvedValueOnce(modelSongs([discovery(999)]))
    .mockResolvedValueOnce(modelSongs(Array.from({ length: 5 }, (_, i) => discovery(i))))
    .mockResolvedValueOnce(modelSongs(Array.from({ length: 5 }, (_, i) => discovery(i + 5))));
  const result = await createRecommendationService({ fetcher, complete }).generate([seed], { ...aiSettings, resultCount: 10 }, { ...credentials, appleToken: '' }, [], new AbortController().signal);
  expect(result.songs).toHaveLength(10); expect(complete).toHaveBeenCalledTimes(3); expect(result.notices).toEqual([]);
  complete.mockReset().mockResolvedValue(modelSongs([discovery(0), discovery(999)]));
  const short = await createRecommendationService({ fetcher, complete }).generate([seed], { ...aiSettings, resultCount: 10 }, { ...credentials, appleToken: '' }, [], new AbortController().signal);
  expect(short.songs).toHaveLength(1); expect(complete).toHaveBeenCalledTimes(3);
  expect(short.notices).toContain('本批目标 10 首，仍缺 9 首；请稍后换一批补充');
});

it('keeps verified results when a supplemental model request fails without retrying that request', async () => {
  const complete = vi.fn<typeof modelCompletion>().mockResolvedValueOnce(modelSongs([discovery(0)])).mockRejectedValue(new RecommendationError('模型请求超时，请稍后重试'));
  const result = await createRecommendationService({ fetcher: discoveryCatalog(1), complete }).generate([seed], { ...aiSettings, resultCount: 10 }, credentials, [], new AbortController().signal);
  expect(result.songs.map((song) => song.title)).toEqual(['Discovery 0']); expect(complete).toHaveBeenCalledTimes(2);
  expect(result.notices).toContain('补充推荐未完成：模型请求超时，请稍后重试；已保留可用结果');
});

it('cancels AI verification and does not make supplemental requests after cancellation', async () => {
  const controller = new AbortController(); const fetcher = discoveryCatalog(10);
  const complete = vi.fn<typeof modelCompletion>(async () => { controller.abort(); return modelSongs([discovery(0)]); });
  await expect(createRecommendationService({ fetcher, complete }).generate([seed], aiSettings, credentials, [], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(complete).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
});

it('resolves four real song links, checks versions and tolerates one failed platform', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'music.163.com') return json({ code: 200, result: { songs: [{ id: 123, name: song.title, artists: [{ name: 'Artist' }], duration: 180000 }] } });
    if (url.hostname === 'c.y.qq.com') return json({ code: 0, data: { song: { list: [{ songmid: 'mid123', songname: song.title, singer: [{ name: 'Artist' }], interval: 180 }] } } });
    if (url.hostname === 'api.music.apple.com') return json({ results: { songs: { data: [{ attributes: { name: song.title, artistName: 'Artist', albumName: 'Album', durationInMillis: 180000, url: 'https://music.apple.com/cn/album/test/123?i=456' } }] } } });
    if (url.hostname === 'accounts.spotify.com') return json({ access_token: crypto.randomUUID() });
    return json({ tracks: { items: [{ name: song.title, artists: [{ name: 'Artist' }], duration_ms: 180000, album: { name: 'Album' }, external_urls: { spotify: 'https://open.spotify.com/track/abc123' } }] } });
  });
  const catalog = createCatalog(fetcher); const [result] = await catalog.links([song], settings, credentials, new AbortController().signal);
  expect(result.links.map((link) => link.kind)).toEqual(['direct', 'direct', 'direct', 'direct']); expect(isResolvedSong(result)).toBe(true);
  const [mismatch] = await catalog.links([{ ...song, title: 'New song (Live)' }], settings, credentials, new AbortController().signal);
  expect(mismatch.links.every((link) => link.kind === 'search')).toBe(true);
  const [unconfigured] = await catalog.links([song], settings, emptyRecommendationCredentials, new AbortController().signal);
  expect(unconfigured.links.filter((link) => link.status === 'unconfigured').map((link) => link.platform)).toEqual(['apple', 'spotify']);
  expect(songKey('Ａ Song', ['ARTIST'])).toBe(songKey('A Song', ['artist']));
});

it('isolates Spotify catalog data from model prompts and keeps catalog failures as searchable links', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'accounts.spotify.com') return json({ access_token: crypto.randomUUID() });
    if (url.hostname === 'api.spotify.com') return new Response('', { status: 429 });
    if (url.hostname === 'ws.audioscrobbler.com') return json({ similartracks: { track: [{ name: 'Found', artist: { name: 'Singer' }, match: 1 }] } });
    return json({ code: 200, result: { songs: [] } });
  });
  const complete = vi.fn<typeof modelCompletion>(async () => ({ choices: [{ message: { content: '{"ids":["invented-id"]}' } }] }));
  const service = createRecommendationService({ fetcher, complete }); const signal = new AbortController().signal;
  const batch = await service.generate([seed], { ...settings, aiBaseUrl: 'https://example.com/v1', model: 'fixture' }, credentials, [], signal);
  expect(batch.mode).toBe('algorithm'); expect(batch.songs[0].title).toBe('Found');
  const result = await service.links(batch.songs, { ...settings, platforms: ['spotify'] }, credentials, signal);
  expect(result[0].links[0]).toMatchObject({ kind: 'search', status: 'unavailable' });
  expect(complete).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(complete).mock.calls[0][2])).not.toContain('Spotify');
});

it('bounds HTTP requests, rejects cross-origin work and redacts unexpected upstream errors', async () => {
  const service = createRecommendationService(); const generate = vi.spyOn(service, 'generate').mockRejectedValue(new Error(credentials.aiKey));
  const api = createRecommendationsApi(service); const server = createServer((req, res) => { void api.handle(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanups.push(() => { api.close(); return new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  const base = `http://127.0.0.1:${address.port}/api/recommendations/`;
  const payload = { settings, credentials, seeds: [seed], excluded: [] };
  const post = (body: unknown, headers = {}) => fetch(`${base}generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  expect((await post(payload, { Origin: 'https://other.test' })).status).toBe(403); expect(generate).not.toHaveBeenCalled();
  expect((await post({ ...payload, seeds: [seed, { ...seed, token: 'invalid' }] })).status).toBe(400);
  expect((await post({ ...payload, extra: 'x'.repeat(270000) })).status).toBe(413);
  expect((await post({ ...payload, excluded: Array.from({ length: 301 }, (_, index) => `seen${index}`) })).status).toBe(400);
  expect((await post({ ...payload, recentSongs: [{ id: 'x', title: 'Song', artists: ['Artist'], token: 'invalid' }] })).status).toBe(400);
  const failed = await post(payload); expect(failed.status).toBe(502); expect(await failed.text()).not.toContain(credentials.aiKey);
  vi.spyOn(service, 'links').mockResolvedValue([]);
  for (let i = 0; i < 60; i++) expect((await fetch(`${base}links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, credentials, songs: [] }) })).status).toBe(200);
  expect((await fetch(`${base}links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, credentials, songs: [] }) })).status).toBe(429);
  expect((await post(payload)).status).toBe(502);
  for (let i = 0; i < 16; i++) await post(payload);
  expect((await post(payload)).status).toBe(429);
});
