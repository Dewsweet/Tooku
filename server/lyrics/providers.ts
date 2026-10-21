import { isLyricDocument, record, type LyricCandidate, type LyricDocument, type ProviderId, type SourceError } from '../../src/domain/lyrics/types.ts';

export class LyricsError extends Error {
  code: SourceError;
  constructor(code: SourceError) { super(({ timeout: '歌词服务请求超时', 'rate-limited': '歌词来源请求过于频繁', 'login-required': '歌词来源需要登录', unavailable: '歌词来源暂不可用', protocol: '歌词来源返回格式已变化', disabled: '网络歌词已停用' })[code]); this.code = code; }
}
export interface LyricProvider { id: ProviderId; search(keyword: string, signal: AbortSignal): Promise<LyricCandidate[]>; lyrics(id: string, signal: AbortSignal): Promise<LyricDocument> }
export const object = (v: unknown): Record<string, unknown> => record(v) ? v : {};
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(record) : [];
const string = (v: unknown) => typeof v === 'string' ? v : '';
const duration = (v: unknown, multiplier = 1) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v * multiplier : undefined;
export function createProviders(fetcher: typeof fetch = fetch): LyricProvider[] {
  const artistCache = new Map<string, { names: string[]; expires: number }>();
  const aliases = (artist: Record<string, unknown>) => [...new Set([string(artist.trans), ...[artist.alias, artist.transNames].flatMap((value) => Array.isArray(value) ? value.map(string) : [])].filter((name) => name.trim() && name.length <= 256))].slice(0, 20);
  async function request(host: 'music.163.com' | 'c.y.qq.com' | 'u.y.qq.com', path: string, params: Record<string, string>, signal: AbortSignal) {
    const url = new URL(path, `https://${host}`); url.search = new URLSearchParams(params).toString();
    let response: Response;
    try { response = await fetcher(url, { redirect: 'error', credentials: 'omit', headers: { 'User-Agent': 'Mozilla/5.0 Tooku/0.1', Referer: host === 'music.163.com' ? 'https://music.163.com/' : 'https://y.qq.com/' }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) }); }
    catch (e) { if (signal.aborted) throw e; throw new LyricsError(e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'unavailable'); }
    if (!response.ok) throw new LyricsError(response.status === 429 ? 'rate-limited' : [401, 403].includes(response.status) ? 'login-required' : 'unavailable');
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (!reader) throw new LyricsError('protocol');
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 524288) { await reader.cancel(); throw new LyricsError('protocol'); } chunks.push(next.value); } }
    finally { reader.releaseLock(); }
    try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { throw new LyricsError('protocol'); }
  }
  const check = (data: Record<string, unknown>, success: number) => { if (data.code !== success) throw new LyricsError([301, 401, 1000].includes(Number(data.code)) ? 'login-required' : [429, 2001].includes(Number(data.code)) ? 'rate-limited' : 'protocol'); };
  const decode = (v: unknown) => {
    const value = string(v);
    if (!value || value.trimStart().startsWith('[') || value.includes('\n') || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return value;
    try {
      const bytes = Buffer.from(value, 'base64');
      if (bytes.toString('base64') !== value) return value;
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return [...decoded].every((c) => c.charCodeAt(0) >= 32 || '\n\r\t'.includes(c)) ? decoded : value;
    } catch { return value; }
  };
  return [{
    id: 'netease',
    async search(keyword, signal) {
      const data = await request('music.163.com', '/api/search/get', { s: keyword, type: '1', limit: '10', offset: '0' }, signal); check(data, 200);
      const result = object(data.result); if (!Array.isArray(result.songs) && result.songCount !== 0) throw new LyricsError('protocol');
      const songs = list(result.songs).slice(0, 10);
      // Local Chinese names may correspond to a Japanese/Korean/Latin platform name.
      // Use only aliases supplied for that exact artist ID, within the search deadline.
      const foreignArtists = songs.flatMap((song) => list(song.artists ?? song.ar)).filter((artist) =>
        /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Latin}]/u.test(string(artist.name)) && !aliases(artist).length);
      const ids = [...new Set(foreignArtists.filter((artist) => /\p{Script=Han}/u.test(keyword) || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(string(artist.name))).map((artist) => String(artist.id)).filter((id) => /^\d{1,20}$/.test(id)))].slice(0, 2);
      for (const id of ids) {
        if (signal.aborted) break;
        if ((artistCache.get(id)?.expires ?? 0) > Date.now()) continue;
        try {
          const detail = await request('music.163.com', `/api/artist/${id}`, {}, signal); check(detail, 200);
          const artist = object(detail.artist);
          if (String(artist.id) !== id) continue;
          artistCache.delete(id); artistCache.set(id, { names: aliases(artist), expires: Date.now() + 3600000 });
          while (artistCache.size > 40) artistCache.delete(artistCache.keys().next().value!);
        } catch (error) {
          if (error instanceof LyricsError && error.code === 'rate-limited') throw error;
          // Optional name enrichment must preserve usable song search results.
        }
      }
      return songs.map((s) => {
        const artists = list(s.artists ?? s.ar);
        const artistAliases = [...new Set(artists.flatMap((artist) => [...aliases(artist), ...(artistCache.get(String(artist.id))?.names ?? [])]))].slice(0, 20);
        return { provider: 'netease', id: String(s.id), title: string(s.name), artists: artists.map((a) => string(a.name)).slice(0, 20), artistAliases, album: string(object(s.album ?? s.al).name), durationMs: duration(s.duration ?? s.dt) };
      });
    },
    async lyrics(id, signal) {
      const data = await request('music.163.com', '/api/song/lyric', { id, lv: '-1', tv: '-1', rv: '-1' }, signal); check(data, 200);
      const tracks: LyricDocument['tracks'] = [{ role: 'original', text: string(object(data.lrc).lyric) }, { role: 'translation', text: string(object(data.tlyric).lyric), lang: 'zh' }, { role: 'romanization', text: string(object(data.romalrc).lyric) }];
      if (!data.lrc && data.nolyric !== true && data.uncollected !== true) throw new LyricsError('protocol');
      return { version: 1, source: 'netease', recordId: id, tracks, instrumental: data.nolyric === true };
    },
  }, {
    id: 'qq',
    async search(keyword, signal) {
      const data = await request('c.y.qq.com', '/soso/fcgi-bin/client_search_cp', { format: 'json', w: keyword, p: '1', n: '10', cr: '1', t: '0' }, signal); check(data, 0);
      const songs = object(object(data.data).song); if (!Array.isArray(songs.list)) throw new LyricsError('protocol');
      return list(songs.list).map((s) => ({ provider: 'qq', id: string(s.songmid ?? s.mid), title: string(s.songname ?? s.name), artists: list(s.singer).map((a) => string(a.name)).slice(0, 20), album: string(s.albumname ?? object(s.album).name), durationMs: duration(s.interval, 1000) }));
    },
    async lyrics(id, signal) {
      try {
        const result = await request('u.y.qq.com', '/cgi-bin/musicu.fcg', { format: 'json', data: JSON.stringify({
          comm: { ct: 24, cv: 4747474, format: 'json' },
          req_0: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songMid: id, crypt: 0, lrc_t: 0, qrc: 0, qrc_t: 0, trans: 1, trans_t: 0, roma: 0, roma_t: 0, type: 1 } },
        }) }, signal);
        check(result, 0); const reply = object(result.req_0);
        if (reply.code === 24001) return { version: 1, source: 'qq', recordId: id, tracks: [] };
        check(reply, 0); const data = object(reply.data);
        if (data.crypt !== 0 || typeof data.lyric !== 'string' || typeof data.trans !== 'string') throw new LyricsError('protocol');
        const document: LyricDocument = { version: 1, source: 'qq', recordId: id, tracks: [{ role: 'original', text: decode(data.lyric) }, { role: 'translation', text: decode(data.trans), lang: 'zh' }] };
        if (!isLyricDocument(document)) throw new LyricsError('protocol');
        return document;
      } catch (error) {
        if (signal.aborted || error instanceof LyricsError && ['rate-limited', 'login-required'].includes(error.code)) throw error;
      }
      const data = await request('c.y.qq.com', '/lyric/fcgi-bin/fcg_query_lyric_new.fcg', { songmid: id, format: 'json', nobase64: '1', g_tk: '5381', platform: 'yqq' }, signal); check(data, 0);
      if (typeof data.lyric !== 'string') throw new LyricsError('protocol');
      const document: LyricDocument = { version: 1, source: 'qq', recordId: id, tracks: [{ role: 'original', text: decode(data.lyric) }, { role: 'translation', text: decode(data.trans), lang: 'zh' }] };
      if (!isLyricDocument(document)) throw new LyricsError('protocol');
      return document;
    },
  }];
}
