// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createLyricsService } from '../server/lyrics/service';
import { createLyricsApi } from '../server/lyrics/http';
import { createProviders, LyricsError, type LyricProvider } from '../server/lyrics/providers';
import type { LyricDocument } from '../src/domain/lyrics/types';
import { normalizeLyrics } from '../src/domain/lyrics/normalize';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const doc = (id = '123'): LyricDocument => ({ version: 1, source: 'netease', recordId: id, tracks: [{ role: 'original', text: '[00:01]hello' }] });
function fixture(options: Parameters<typeof createLyricsService>[0] = {}) {
  const provider: LyricProvider = { id: 'netease', search: vi.fn<LyricProvider['search']>(async () => [{ provider: 'netease', id: '123', title: 'Song', artists: ['Artist'], durationMs: 180000 }]), lyrics: vi.fn(async (id) => doc(id)) };
  const service = createLyricsService({ providers: [provider], filename: ':memory:', intervalMs: 0, ...options });
  cleanups.push(() => service.close()); return { provider, service };
}
const track = { title: 'Song', artists: ['Artist'], durationMs: 180000 };
const qqReply = (lyric: string, trans = '') => ({ code: 0, req_0: { code: 0, data: { crypt: 0, lyric, trans } } });
describe('independent lyrics service', () => {
  it('retries a failed combined NetEase query once with the song title and keeps artist filtering', async () => {
    const { provider, service } = fixture();
    vi.mocked(provider.search).mockResolvedValueOnce([]).mockResolvedValueOnce([
      { provider: 'netease', id: 'wrong', title: 'おやすみパラドックス', artists: ['Other'], durationMs: 180000 },
      { provider: 'netease', id: 'right', title: 'おやすみパラドックス', artists: ['やくしまるえつこ'], durationMs: 180000 },
    ]);
    const descriptor = { title: 'おやすみパラドックス', artists: ['やくしまるえつこ'], durationMs: 180000 };
    const result = await service.search(descriptor, ['netease']);
    expect(vi.mocked(provider.search).mock.calls.map(([query]) => query)).toEqual(['おやすみパラドックス やくしまるえつこ', 'おやすみパラドックス']);
    expect(result.candidates.find((c) => c.id === 'right')?.confident).toBe(true);
    expect(result.candidates.find((c) => c.id === 'wrong')?.confident).toBe(false);
    await service.search(descriptor, ['netease']); expect(provider.search).toHaveBeenCalledTimes(2);
  });
  it('bounds and deduplicates fallback candidates and does not broaden queries on a rate limit', async () => {
    const { provider, service } = fixture();
    const candidates = Array.from({ length: 10 }, (_, i) => ({ provider: 'netease' as const, id: String(i), title: 'Other', artists: ['Artist'], durationMs: 180000 }));
    vi.mocked(provider.search).mockResolvedValueOnce(candidates).mockResolvedValueOnce([...candidates.slice(1), { ...candidates[0], id: 'correct', title: 'Song' }]);
    const result = await service.search(track, ['netease']);
    expect(result.candidates).toHaveLength(10); expect(new Set(result.candidates.map((c) => c.id)).size).toBe(10);
    expect(result.candidates[0].id).toBe('correct');
    vi.mocked(provider.search).mockClear().mockRejectedValue(new LyricsError('rate-limited'));
    expect((await service.search(track, ['netease'], true)).errors[0].code).toBe('rate-limited');
    expect(provider.search).toHaveBeenCalledTimes(1);
  });
  it('deduplicates concurrent work, caches across calls and does not fabricate health on cache hits', async () => {
    let time = 100000; const { provider, service } = fixture({ now: () => time });
    const results = await Promise.all([service.lyrics('netease', '123'), service.lyrics('netease', '123')]);
    expect(provider.lyrics).toHaveBeenCalledTimes(1); expect(results[0].document).toEqual(doc());
    const observed = service.status(); time += 1000;
    expect((await service.lyrics('netease', '123')).cached).toBe(true); expect(service.status()).toEqual(observed);
    expect((await service.search(track, ['netease'])).candidates[0].confident).toBe(true);
    await service.search(track, ['netease']); expect(provider.search).toHaveBeenCalledTimes(1);
  });
  it('caches genuine absence briefly, but retries failures and does not report empty data as verified', async () => {
    const { provider, service } = fixture();
    vi.mocked(provider.lyrics).mockResolvedValue({ ...doc(), tracks: [] });
    await service.lyrics('netease', '123'); await service.lyrics('netease', '123');
    expect(provider.lyrics).toHaveBeenCalledTimes(1); expect(service.status().providers[0].lyrics.successAt).toBeUndefined();
    vi.mocked(provider.lyrics).mockRejectedValue(new LyricsError('timeout'));
    await expect(service.lyrics('netease', '456')).rejects.toMatchObject({ code: 'timeout' });
    await expect(service.lyrics('netease', '456')).rejects.toThrow(); expect(provider.lyrics).toHaveBeenCalledTimes(3);
  });
  it('serves stale lyrics immediately and bounds background refresh retries', async () => {
    let time = 100000; const { provider, service } = fixture({ now: () => time });
    await service.lyrics('netease', '123'); time += 604800001;
    vi.mocked(provider.lyrics).mockRejectedValue(new LyricsError('unavailable'));
    expect((await service.lyrics('netease', '123')).stale).toBe(true);
    await vi.waitFor(() => expect(service.status().providers[0].lyrics.error).toBe('unavailable'));
    await service.lyrics('netease', '123'); expect(provider.lyrics).toHaveBeenCalledTimes(2);
  });
  it('keeps protocol failures and rate limits visible and supports a global off switch', async () => {
    const { provider, service } = fixture();
    vi.mocked(provider.lyrics).mockResolvedValue({ ...doc(), source: 'qq' });
    await expect(service.lyrics('netease', '123')).rejects.toMatchObject({ code: 'protocol' });
    vi.mocked(provider.lyrics).mockRejectedValue(new LyricsError('rate-limited'));
    await expect(service.lyrics('netease', '123')).rejects.toMatchObject({ code: 'rate-limited' });
    await expect(service.lyrics('netease', '456')).rejects.toThrow(); expect(provider.lyrics).toHaveBeenCalledTimes(2);
    const disabled = fixture({ enabled: false }).service;
    await expect(disabled.search(track, ['netease'])).rejects.toMatchObject({ code: 'disabled' });
  });
  it('falls back to bounded memory cache when the cache file cannot open', async () => {
    const { service } = fixture({ filename: process.cwd() });
    expect(service.status().cache).toBe('memory'); await service.lyrics('netease', '123'); expect((await service.lyrics('netease', '123')).cached).toBe(true);
  });
  it('detects the search and lyrics capabilities independently using real adapter operations', async () => {
    const { provider, service } = fixture(); vi.mocked(provider.search).mockRejectedValue(new LyricsError('unavailable'));
    const status = await service.check(['netease']);
    expect(status.providers[0].search.error).toBe('unavailable'); expect(status.providers[0].lyrics.successAt).toBeTruthy();
    await service.check(['netease']); expect(provider.search).toHaveBeenCalledTimes(1);
  });
  it('still checks lyrics if only search was recently verified', async () => {
    const { provider, service } = fixture(); await service.search(track, ['netease']);
    await service.check(['netease']); expect(provider.search).toHaveBeenCalledTimes(1); expect(provider.lyrics).toHaveBeenCalledTimes(1);
  });
  it('exposes bounded same-origin HTTP without Navidrome authentication or arbitrary outbound URLs', async () => {
    const { service, provider } = fixture(); const api = createLyricsApi(service);
    const server = createServer((req, res) => { void api.handle(req, res, () => { res.statusCode = 404; res.end(); }); });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    cleanups.push(() => new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); }));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/lyrics/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect((await fetch(`${base}/api/lyrics/status`)).status).toBe(200);
    expect((await post('search', { track, providers: ['netease'] })).status).toBe(200);
    expect((await post('fetch', { provider: 'netease', id: 'https://example.test' })).status).toBe(400);
    expect((await post('search', { track, providers: ['netease'] }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await post('search', { huge: 'x'.repeat(9000) })).status).toBe(413);
    expect(provider.lyrics).not.toHaveBeenCalled();
  });
});

describe('provider protocol adapters', () => {
  it('bounds ensemble metadata so an unrelated result with 25 artists cannot reject the entire search', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ code: 200, result: { songs: [
      { id: 123, name: 'Song', artists: [{ name: 'Artist' }], duration: 180000 },
      { id: 456, name: 'Other', artists: Array.from({ length: 25 }, (_, i) => ({ name: `Singer ${i}` })) },
    ] } }));
    const { service } = fixture({ providers: createProviders(fetcher) });
    const result = await service.search(track, ['netease']);
    expect(result.errors).toEqual([]); expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].confident).toBe(true); expect(result.candidates[1].artists).toHaveLength(20);
  });
  it('loads platform artist aliases once per ID without changing the displayed performer name', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => new URL(String(url)).pathname.startsWith('/api/artist/')
      ? Response.json({ code: 200, artist: { id: 17637, name: 'つじあやの', alias: ['Tsuji Ayano'], transNames: ['辻亚弥乃'], trans: '辻亚弥乃' } })
      : Response.json({ code: 200, result: { songs: [{ id: 123, name: '風になる', artists: [{ id: 17637, name: 'つじあやの' }], duration: 276600 }] } }));
    const provider = createProviders(fetcher)[0]; const signal = new AbortController().signal;
    const songs = await provider.search('風になる (幻化成风) 辻亚弥乃', signal);
    expect(songs[0]).toMatchObject({ artists: ['つじあやの'], artistAliases: ['辻亚弥乃', 'Tsuji Ayano'] });
    await provider.search('別の曲 辻亚弥乃', signal);
    expect(fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.startsWith('/api/artist/'))).toHaveLength(1);
  });
  it('preserves search results when optional artist details fail or return another ID', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 200, result: { songs: [{ id: 123, name: '風になる', artists: [{ id: 17637, name: 'つじあやの' }] }] } }))
      .mockResolvedValueOnce(Response.json({ code: 200, artist: { id: 999, trans: '辻亚弥乃' } }))
      .mockResolvedValueOnce(Response.json({ code: 200, result: { songs: [{ id: 123, name: '風になる', artists: [{ id: 17637, name: 'つじあやの' }] }] } }))
      .mockRejectedValueOnce(new Error('unavailable'));
    const provider = createProviders(fetcher)[0]; const signal = new AbortController().signal;
    for (let i = 0; i < 2; i++) expect(await provider.search('風になる 辻亚弥乃', signal)).toMatchObject([{ id: '123', artistAliases: [] }]);
  });
  it('bounds optional artist lookups and uses aliases already present in the search response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.startsWith('/api/artist/')) return Response.json({ code: 200, artist: { id: Number(path.split('/').at(-1)), trans: '平台译名' } });
      return Response.json({ code: 200, result: { songs: [
        { id: 1, name: '曲名', artists: [{ id: 1, name: '名前', trans: '已有译名' }] },
        ...[2, 3, 4].map((id) => ({ id, name: '曲名', artists: [{ id, name: `Artist ${id}` }] })),
      ] } });
    });
    const songs = await createProviders(fetcher)[0].search('曲名', new AbortController().signal);
    expect(songs[0].artistAliases).toEqual(['已有译名']);
    expect(songs[3].artistAliases).toEqual([]); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('honors rate limits from optional name lookup and stops further platform requests', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 200, result: { songs: [{ id: 123, name: '風になる', artists: [{ id: 17637, name: 'つじあやの' }] }] } }))
      .mockResolvedValueOnce(new Response('', { status: 429 }));
    const service = createLyricsService({ providers: createProviders(fetcher), filename: ':memory:', intervalMs: 0 });
    cleanups.push(() => service.close());
    const track = { title: '風になる', artists: ['辻亚弥乃'] };
    expect((await service.search(track, ['netease'])).errors).toEqual([{ provider: 'netease', code: 'rate-limited' }]);
    await service.search(track, ['netease']); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('retains QQ translations from plain and base64 responses (%s)', async (encoded) => {
    const original = '[00:01]A foreign line\n[00:02]Another line';
    const translation = '[00:01]第一句译文\n[00:02]第二句译文';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(qqReply(encoded ? Buffer.from(original).toString('base64') : original, encoded ? Buffer.from(translation).toString('base64') : translation)));
    const result = normalizeLyrics(await createProviders(fetcher)[1].lyrics('qq123', new AbortController().signal));
    expect(result.lines.map((line) => line.translation)).toEqual([['第一句译文'], ['第二句译文']]);
    const request = new URL(String(fetcher.mock.calls[0][0]));
    expect(request.host).toBe('u.y.qq.com');
    expect(JSON.parse(request.searchParams.get('data')!).req_0.param).toMatchObject({ songMid: 'qq123', trans: 1, crypt: 0, qrc: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps QQ original lyrics usable when the platform returns no translation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(qqReply('[00:01]A foreign line')));
    const result = normalizeLyrics(await createProviders(fetcher)[1].lyrics('qq123', new AbortController().signal));
    expect(result.lines[0]).toMatchObject({ text: 'A foreign line' }); expect(result.lines[0].translation).toBeUndefined();
  });
  it('converts both providers independently and restricts requests to fixed HTTPS hosts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ code: 200, result: { songs: [{ id: 123, name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album' }, duration: 180000 }] } }))
      .mockResolvedValueOnce(Response.json({ code: 200, lrc: { lyric: '[00:01]hello' }, tlyric: { lyric: '[00:01]你好' } }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { song: { list: [{ songmid: 'abc', songname: 'Song', singer: [{ name: 'Artist' }], interval: 180 }] } } }))
      .mockResolvedValueOnce(Response.json(qqReply(Buffer.from('[00:01]hello').toString('base64'), '[00:01]你好')))
      .mockResolvedValueOnce(Response.json(qqReply('hello')));
    const [netease, qq] = createProviders(fetcher); const signal = new AbortController().signal;
    expect((await netease.search('Song', signal))[0].durationMs).toBe(180000);
    expect((await netease.lyrics('123', signal)).tracks[1].role).toBe('translation');
    expect((await qq.search('Song', signal))[0].durationMs).toBe(180000);
    expect((await qq.lyrics('abc', signal)).tracks[0].text).toBe('[00:01]hello');
    expect((await qq.lyrics('plain', signal)).tracks[0].text).toBe('hello');
    for (const [url, init] of fetcher.mock.calls) { expect(new URL(String(url)).protocol).toBe('https:'); expect(['music.163.com', 'c.y.qq.com', 'u.y.qq.com']).toContain(new URL(String(url)).host); expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' }); }
  });
  it('falls back from the new QQ protocol to the legacy endpoint without treating ciphertext as lyrics', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ code: 0, req_0: { code: 0, data: { crypt: 1, lyric: 'abcdef012345', trans: '' } } }))
      .mockResolvedValueOnce(Response.json({ code: 0, lyric: '[00:01]legacy original', trans: '[00:01]旧接口译文' }));
    const result = normalizeLyrics(await createProviders(fetcher)[1].lyrics('qq123', new AbortController().signal));
    expect(result.lines[0]).toMatchObject({ text: 'legacy original', translation: ['旧接口译文'] });
    expect(new URL(String(fetcher.mock.calls[1][0])).host).toBe('c.y.qq.com');
  });
  it.each([24001, 2001])('does not call the legacy QQ endpoint for absence or rate limiting (%s)', async (code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 0, req_0: { code } }));
    const request = createProviders(fetcher)[1].lyrics('qq123', new AbortController().signal);
    if (code === 24001) expect((await request).tracks).toEqual([]);
    else await expect(request).rejects.toMatchObject({ code: 'rate-limited' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects changed protocols, oversized responses and login gates instead of caching them as absent', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ code: 200, result: {} })).mockResolvedValueOnce(new Response('x'.repeat(524289))).mockResolvedValueOnce(new Response('', { status: 403 }));
    const provider = createProviders(fetcher)[0]; const signal = new AbortController().signal;
    await expect(provider.search('Song', signal)).rejects.toMatchObject({ code: 'protocol' });
    await expect(provider.lyrics('123', signal)).rejects.toMatchObject({ code: 'protocol' });
    await expect(provider.search('Song', signal)).rejects.toMatchObject({ code: 'login-required' });
  });
});
