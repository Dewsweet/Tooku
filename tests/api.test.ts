import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicApi, normalizeServer, authToken, track } from '../src/api/client';

const ok = (data: Record<string, unknown> = {}) => new Response(JSON.stringify({ 'subsonic-response': { status: 'ok', ...data } }), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
describe('Subsonic transport and contracts', () => {
  it('preserves base paths and rejects credentials in a URL', () => { expect(normalizeServer(' https://example.test/music/// ')).toBe('https://example.test/music'); expect(normalizeServer('/nd', 'http://localhost:5173')).toBe('http://localhost:5173/nd'); expect(() => normalizeServer('https://user:password@example.test')).toThrow(); expect(() => normalizeServer('https://example.test?token=secret')).toThrow(); expect(() => normalizeServer('file:///music')).toThrow(); });
  it('uses the protocol hash on UTF-8 raw password plus salt', () => { const password = ' 密码🎵 '; const salt = '测试salt'; expect(authToken(password, salt)).toBe(createHash('md5').update(password + salt, 'utf8').digest('hex')); });
  it('checks failed business envelopes even on HTTP 200 and does not expose server echoes', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'password=private' } } })))); const api = new MusicApi('https://example.test/music', 'user', 'private', 'salt'); await expect(api.request('ping')).rejects.toMatchObject({ code: 40, message: '用户名或密码不正确。' }); });
  it('distinguishes a proxy HTML response from bad credentials', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Login</html>'))); await expect(new MusicApi('https://example.test', 'u', 'p').connect()).rejects.toThrow('反向代理'); });
  it('retains login when optional extension detection fails', async () => { const fetch = vi.fn().mockResolvedValueOnce(ok({ serverVersion: '0.64.1' })).mockRejectedValueOnce(new Error('offline')); vi.stubGlobal('fetch', fetch); const api = new MusicApi('https://example.test', 'u', 'p'); expect(await api.connect()).toBe('0.64.1'); expect(api.supports('songLyrics')).toBe(false); });
  it('uses form POST and retains duplicate song parameters', async () => { const fetch = vi.fn().mockResolvedValue(ok({ playlist: { id: 'p', name: 'name' } })); vi.stubGlobal('fetch', fetch); const api = new MusicApi('https://example.test/base', 'u', 'p'); api.extensions.set('formPost', [1]); await api.createPlaylist('中文 & 音乐', ['a', 'a', 'b']); const [url, options] = fetch.mock.calls[0]; expect(url).toBe('https://example.test/base/rest/createPlaylist.view'); expect(options.method).toBe('POST'); expect(options.body.getAll('songId')).toEqual(['a', 'a', 'b']); expect(options.body.get('name')).toBe('中文 & 音乐'); expect(options.body.has('p')).toBe(false); expect(options.credentials).toBe('omit'); });
  it('refuses to overwrite a changed playlist without a write', async () => { const fetch = vi.fn().mockResolvedValue(ok({ playlist: { id: 'p', name: 'new', changed: 'changed-by-other', entry: [] } })); vi.stubGlobal('fetch', fetch); const api = new MusicApi('https://example.test', 'u', 'p'); await expect(api.savePlaylist('p', 'draft', ['a'], 'old')).rejects.toThrow('其他客户端'); expect(fetch).toHaveBeenCalledTimes(1); });
  it('updates playlist metadata without replacing songs and verifies the result', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(ok({ playlist: { id: 'p', name: '旧名称', changed: 'v1', entry: [{ id: 'a' }, { id: 'a' }] } })).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ playlist: { id: 'p', name: '新名称', comment: '中文简介', changed: 'v2', entry: [{ id: 'a' }, { id: 'a' }] } }));
    vi.stubGlobal('fetch', fetch); const api = new MusicApi('https://example.test', 'u', 'p');
    const result = await api.updatePlaylistDetails('p', { name: '新名称', comment: '中文简介' }, 'v1');
    expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/rest/updatePlaylist.view');
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('comment')).toBe('中文简介');
    expect(result.songs.map((s) => s.id)).toEqual(['a', 'a']);
  });
  it('does not write metadata if another client has changed the playlist', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ playlist: { id: 'p', name: '名称', changed: 'v2' } })); vi.stubGlobal('fetch', fetch);
    await expect(new MusicApi('https://example.test', 'u', 'p').updatePlaylistDetails('p', { name: '新名称', comment: '' }, 'v1')).rejects.toThrow('其他客户端'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reads a playlist after saving and rejects a mismatched order', async () => { const fetch = vi.fn().mockResolvedValueOnce(ok({ playlist: { id: 'p', name: 'same', changed: 'old', entry: [] } })).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok({ playlist: { id: 'p', name: 'same', entry: [{ id: 'b' }, { id: 'a' }] } })); vi.stubGlobal('fetch', fetch); await expect(new MusicApi('https://example.test', 'u', 'p').savePlaylist('p', 'same', ['a', 'b'], 'old')).rejects.toThrow('草稿不同'); expect(fetch).toHaveBeenCalledTimes(3); });
  it('does not retry a timed-out write automatically', async () => { const fetch = vi.fn().mockRejectedValue(new Error('timeout')); vi.stubGlobal('fetch', fetch); await expect(new MusicApi('https://example.test', 'u', 'p').createPlaylist('name')).rejects.toThrow('结果暂时未知'); expect(fetch).toHaveBeenCalledTimes(1); });
  it('normalizes optional song fields and preserves multiple artists', () => { expect(track({ id: 'abc', title: '歌', artists: [{ name: '甲' }, { name: '乙' }], duration: Infinity })).toMatchObject({ id: 'abc', artist: '甲 / 乙', duration: undefined }); });
  it('converts a server positive lyric offset into an earlier display time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ lyricsList: { structuredLyrics: [{ synced: true, offset: 500, lang: 'zho', line: [{ start: 1000, value: '测试' }] }] } })));
    const api = new MusicApi('https://example.test', 'u', 'p'); api.extensions.set('songLyrics', [1]);
    const lyrics = await api.lyrics('id', 'artist', 'title'); expect(lyrics.offsetMs).toBe(-500);
    expect(lyrics.lines[0].startMs! + lyrics.offsetMs).toBe(500);
  });
  it('preserves structured foreign, translated and romanized lyric tracks with their own offsets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ lyricsList: { structuredLyrics: [
      { synced: true, lang: 'jpn-Latn', line: [{ start: 1000, value: 'konnichiwa' }] },
      { synced: true, lang: 'zho', offset: 100, line: [{ start: 1000, value: '你好' }] },
      { synced: true, lang: 'jpn', offset: 200, line: [{ start: 1000, value: 'こんにちは' }] },
    ] } })));
    const api = new MusicApi('https://example.test', 'u', 'p'); api.extensions.set('songLyrics', [1]);
    const lyrics = await api.lyrics('id', 'artist', 'title');
    expect(lyrics.lang).toBe('jpn'); expect(lyrics.document?.tracks.map((t) => t.role)).toEqual(['romanization', 'translation', 'original']);
    expect(lyrics.document?.tracks[1].offsetMs).toBe(-100);
  });
  it('does not conceal local permission or transport failures behind empty fallback lyrics', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code: 50 } } })));
    vi.stubGlobal('fetch', fetch); const api = new MusicApi('https://example.test', 'u', 'p'); api.extensions.set('songLyrics', [1]);
    await expect(api.lyrics('id', 'artist', 'title')).rejects.toMatchObject({ code: 50 }); expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRejectedValue(new Error('offline'));
    await expect(api.lyrics('id', 'artist', 'title')).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('carries abort into outstanding requests when logging out', async () => { let captured: AbortSignal | undefined; vi.stubGlobal('fetch', vi.fn((_url, options) => { captured = options.signal; return Promise.resolve(ok()); })); const api = new MusicApi('https://example.test', 'u', 'p'); await api.request('ping'); api.dispose(); expect(captured?.aborted).toBe(true); });
});
