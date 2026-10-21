// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { listeningSeeds, defaultRecommendationSettings as settings, emptyRecommendationCredentials, isRecommendationProfile, isResolvedSong, isDirectPlatformUrl, songKey, type RecommendationSong, type ListeningSeed } from '../src/domain/recommendations';
import { selectRecommendations, createRecommendationService } from '../server/recommendations/service';
import { createCatalog, object, text } from '../server/recommendations/catalog';
import { createRecommendationsApi } from '../server/recommendations/http';
import { limitedJson, publicAddress, resolveModelEndpoint, type modelCompletion } from '../server/recommendations/network';

const credentials = { ...emptyRecommendationCredentials, lastfmKey: crypto.randomUUID(), aiKey: crypto.randomUUID(), spotifyClientId: crypto.randomUUID(), spotifyClientSecret: crypto.randomUUID(), appleToken: crypto.randomUUID() };
const seed: ListeningSeed = { title: 'Seed', artists: ['Artist'], plays: 1, weight: 1 };
const song: RecommendationSong = { id: 'candidate', title: 'New song', artists: ['Artist'], durationMs: 180000, reason: '相关歌曲', origin: 'lastfm' };
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const cleanups: (() => void | Promise<void>)[] = [];
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
  const selected = selectRecommendations(candidates, seeds, .3, ['s29']);
  expect(selected).toHaveLength(10); expect(selected.some((s) => s.id === 'seed' || s.id === 's29')).toBe(false);
  expect(selected.filter((s) => s.artists[0].startsWith('New'))).toHaveLength(3);
  expect(Math.max(...selected.map((s) => selected.filter((other) => other.artists[0] === s.artists[0]).length))).toBeLessThanOrEqual(2);
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

it('falls back to algorithm results when model ranking fails, without returning secrets or provider errors', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ similartracks: { track: Array.from({ length: 15 }, (_, i) => ({ name: `Found ${i}`, artist: { name: `Singer ${i}` }, match: .9 })) } }));
  const complete = vi.fn<typeof modelCompletion>(async () => { throw new Error(credentials.aiKey); });
  const service = createRecommendationService({ fetcher, complete });
  const result = await service.generate([seed], { ...settings, aiBaseUrl: 'https://example.com/v1', model: 'fixture' }, credentials, [], new AbortController().signal);
  expect(result.songs).toHaveLength(10); expect(result.mode).toBe('algorithm'); expect(result.notices).toContain('AI 排序未完成，本批使用算法推荐');
  expect(JSON.stringify(result)).not.toContain(credentials.aiKey);
  expect(fetcher).toHaveBeenCalledOnce(); expect(complete).toHaveBeenCalledOnce();
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
  expect((await post({ ...payload, extra: 'x'.repeat(100000) })).status).toBe(413);
  const failed = await post(payload); expect(failed.status).toBe(502); expect(await failed.text()).not.toContain(credentials.aiKey);
  for (let i = 0; i < 16; i++) await post(payload);
  expect((await post(payload)).status).toBe(429);
});
