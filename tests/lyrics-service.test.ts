// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createLyricsService } from '../server/lyrics/service';
import { createLyricsApi } from '../server/lyrics/http';
import { createProviders, LyricsError, type LyricProvider } from '../server/lyrics/providers';
import type { LyricDocument } from '../src/domain/lyrics/types';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const doc = (id = '123'): LyricDocument => ({ version: 1, source: 'netease', recordId: id, tracks: [{ role: 'original', text: '[00:01]hello' }] });
function fixture(options: Parameters<typeof createLyricsService>[0] = {}) {
  const provider: LyricProvider = { id: 'netease', search: vi.fn<LyricProvider['search']>(async () => [{ provider: 'netease', id: '123', title: 'Song', artists: ['Artist'], durationMs: 180000 }]), lyrics: vi.fn(async (id) => doc(id)) };
  const service = createLyricsService({ providers: [provider], filename: ':memory:', intervalMs: 0, ...options });
  cleanups.push(() => service.close()); return { provider, service };
}
const track = { title: 'Song', artists: ['Artist'], durationMs: 180000 };
describe('independent lyrics service', () => {
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
  it('converts both providers independently and restricts requests to fixed HTTPS hosts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ code: 200, result: { songs: [{ id: 123, name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album' }, duration: 180000 }] } }))
      .mockResolvedValueOnce(Response.json({ code: 200, lrc: { lyric: '[00:01]hello' }, tlyric: { lyric: '[00:01]你好' } }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { song: { list: [{ songmid: 'abc', songname: 'Song', singer: [{ name: 'Artist' }], interval: 180 }] } } }))
      .mockResolvedValueOnce(Response.json({ code: 0, lyric: Buffer.from('[00:01]hello').toString('base64'), trans: '[00:01]你好' }))
      .mockResolvedValueOnce(Response.json({ code: 0, lyric: 'hello', trans: '' }));
    const [netease, qq] = createProviders(fetcher); const signal = new AbortController().signal;
    expect((await netease.search('Song', signal))[0].durationMs).toBe(180000);
    expect((await netease.lyrics('123', signal)).tracks[1].role).toBe('translation');
    expect((await qq.search('Song', signal))[0].durationMs).toBe(180000);
    expect((await qq.lyrics('abc', signal)).tracks[0].text).toBe('[00:01]hello');
    expect((await qq.lyrics('plain', signal)).tracks[0].text).toBe('hello');
    for (const [url, init] of fetcher.mock.calls) { expect(new URL(String(url)).protocol).toBe('https:'); expect(['music.163.com', 'c.y.qq.com']).toContain(new URL(String(url)).host); expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' }); }
  });
  it('rejects changed protocols, oversized responses and login gates instead of caching them as absent', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ code: 200, result: {} })).mockResolvedValueOnce(new Response('x'.repeat(524289))).mockResolvedValueOnce(new Response('', { status: 403 }));
    const provider = createProviders(fetcher)[0]; const signal = new AbortController().signal;
    await expect(provider.search('Song', signal)).rejects.toMatchObject({ code: 'protocol' });
    await expect(provider.lyrics('123', signal)).rejects.toMatchObject({ code: 'protocol' });
    await expect(provider.search('Song', signal)).rejects.toMatchObject({ code: 'login-required' });
  });
});
