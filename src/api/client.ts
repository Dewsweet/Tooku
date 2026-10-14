import md5 from 'blueimp-md5';
import type { Album, Artist, Lyrics, Playlist, Track, MusicLibrary } from '../domain/models';

type DTO = Record<string, unknown>;
export const object = (value: unknown): DTO => value && typeof value === 'object' && !Array.isArray(value) ? value as DTO : {};
export const list = (value: unknown): DTO[] => Array.isArray(value) ? value.map(object) : [];
const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const text = (v: unknown, fallback: string) => str(v) || fallback;
export function track(dto: DTO): Track {
  const artists = list(dto.artists).filter((a) => str(a.name)).map((a) => ({ id: str(a.id), name: str(a.name)! }));
  return {
    id: text(dto.id, ''), title: text(dto.title, '未知歌曲'),
    artist: artists.length ? artists.map((a) => a.name).join(' / ') : text(dto.artist, '未知歌手'), artistId: str(dto.artistId), artists,
    album: str(dto.album), albumId: str(dto.albumId), coverArt: str(dto.coverArt),
    duration: num(dto.duration), track: num(dto.track), discNumber: num(dto.discNumber),
    suffix: str(dto.suffix), bitRate: num(dto.bitRate), starred: str(dto.starred),
  };
}
export function album(dto: DTO): Album {
  return { id: text(dto.id, ''), name: text(dto.name ?? dto.title, '未知专辑'), artist: text(dto.artist, '未知歌手'),
    artistId: str(dto.artistId), coverArt: str(dto.coverArt), year: num(dto.year),
    songCount: num(dto.songCount), duration: num(dto.duration), starred: str(dto.starred) };
}
function playlist(dto: DTO): Playlist {
  return { id: text(dto.id, ''), name: text(dto.name, '未命名歌单'), owner: str(dto.owner), songCount: num(dto.songCount), changed: str(dto.changed), coverArt: str(dto.coverArt) };
}

const errors: Record<number, string> = {
  10: '请求缺少必要参数。', 20: '客户端协议不受支持。', 30: '服务器协议版本过旧。',
  40: '用户名或密码不正确。', 41: '此账号不支持 token 认证。', 42: '服务器不支持此认证方式。',
  43: '认证参数存在冲突。', 44: '认证密钥无效。', 50: '你没有执行此操作的权限。',
  60: '此服务器的许可状态不可用。', 70: '内容不存在，或已从音乐库移除。',
};
export class ApiError extends Error {
  constructor(message: string, public code?: number) { super(message); this.name = 'ApiError'; }
}
export function normalizeServer(input: string, origin = window.location.origin) {
  const trimmed = input.trim();
  const url = new URL(trimmed === '/nd' ? `${origin}/nd` : trimmed);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ApiError('请输入完整的 http/https 服务地址，不包含账号、查询参数或锚点。');
  }
  return url.href.replace(/\/+$/, '');
}
export function authToken(password: string, salt: string) { return md5(password + salt); }
type Params = Record<string, string | number | boolean | string[] | undefined>;

export class MusicApi {
  readonly identity: string;
  readonly extensions = new Map<string, number[]>();
  #auth: { u: string; t: string; s: string };
  #abort = new AbortController();
  constructor(readonly base: string, readonly username: string, password: string, salt?: string) {
    const random = salt ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.#auth = { u: username, t: authToken(password, random), s: random };
    this.identity = `${base}|${username}`;
  }
  dispose() { this.#abort.abort(); this.#auth = { u: '', t: '', s: '' }; }
  supports(name: string, version = 1) { return (this.extensions.get(name) ?? []).some((v) => v >= version); }
  #params(params: Params) {
    const out = new URLSearchParams({ v: '1.16.1', c: 'Tooku', f: 'json', ...this.#auth });
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) value.forEach((item) => out.append(key, item));
      else out.set(key, String(value));
    }
    return out;
  }
  mediaUrl(method: 'stream' | 'getCoverArt', params: Params) {
    const args = this.#params(params); args.delete('f');
    return `${this.base}/rest/${method}.view?${args}`;
  }
  coverUrl(id?: string, size = 400) { return id ? this.mediaUrl('getCoverArt', { id, size }) : undefined; }
  streamUrl(id: string, mode: 'original' | 'compatible') {
    return this.mediaUrl('stream', { id, ...(mode === 'compatible' ? { format: 'mp3', maxBitRate: 320 } : {}) });
  }
  async request(method: string, params: Params = {}, signal?: AbortSignal, write = false): Promise<DTO> {
    const args = this.#params(params);
    const post = this.supports('formPost');
    const endpoint = `${this.base}/rest/${method}.view`;
    if (!post && endpoint.length + args.toString().length > 8000) throw new ApiError('请求过长；服务器需要支持表单 POST 才能保存此列表。');
    let response: Response;
    try {
      response = await fetch(post ? endpoint : `${endpoint}?${args}`, {
        method: post ? 'POST' : 'GET', body: post ? args : undefined,
        credentials: 'omit', referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([this.#abort.signal, ...(signal ? [signal] : []), AbortSignal.timeout(write ? 30000 : 12000)]),
      });
    } catch (error) {
      if (this.#abort.signal.aborted || signal?.aborted) throw error;
      throw new ApiError(write ? '保存结果暂时未知，请重新读取核实后再操作。' : '无法连接服务，请检查地址、网络和浏览器访问权限。');
    }
    if (!response.ok) throw new ApiError(response.status === 401 ? '认证已失效，请重新连接。' : `服务请求失败（HTTP ${response.status}）。`, response.status === 401 ? 40 : undefined);
    let json: unknown;
    try { json = await response.json(); } catch { throw new ApiError('接口返回了网页或无法识别的数据，请检查反向代理。'); }
    const result = object(object(json)['subsonic-response']);
    if (result.status !== 'ok') {
      const code = num(object(result.error).code);
      throw new ApiError(code ? errors[code] ?? '服务器未能完成请求。' : '服务响应缺少有效的协议状态。', code);
    }
    return result;
  }
  async connect() {
    const ping = await this.request('ping');
    try {
      const ext = await this.request('getOpenSubsonicExtensions');
      for (const item of list(ext.openSubsonicExtensions)) {
        if (typeof item.name === 'string' && Array.isArray(item.versions)) this.extensions.set(item.name, item.versions.filter((v): v is number => typeof v === 'number'));
      }
    } catch { /* optional detection must not block a valid login */ }
    return text(ping.serverVersion, '版本未知');
  }
  async libraries(signal?: AbortSignal): Promise<MusicLibrary[]> {
    const data = await this.request('getMusicFolders', {}, signal);
    return list(object(data.musicFolders).musicFolder).filter((f) => typeof f.id === 'string' || typeof f.id === 'number').map((f) => ({ id: String(f.id), name: text(f.name, '音乐库') }));
  }
  async albums(type = 'newest', offset = 0, signal?: AbortSignal, musicFolderId?: string) {
    const data = await this.request('getAlbumList2', { type, size: 30, offset, musicFolderId }, signal);
    return list(object(data.albumList2).album).map(album);
  }
  async album(id: string, signal?: AbortSignal) {
    const dto = object((await this.request('getAlbum', { id }, signal)).album);
    return { ...album(dto), songs: list(dto.song).map(track).sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.track ?? 0) - (b.track ?? 0)) };
  }
  async song(id: string, signal?: AbortSignal) { return track(object((await this.request('getSong', { id }, signal)).song)); }
  async artists(signal?: AbortSignal, musicFolderId?: string): Promise<Artist[]> {
    const data = object((await this.request('getArtists', { musicFolderId }, signal)).artists);
    return list(data.index).flatMap((group) => list(group.artist)).map((a) => ({ id: text(a.id, ''), name: text(a.name, '未知歌手'), albumCount: num(a.albumCount), coverArt: str(a.coverArt) }));
  }
  async artist(id: string, signal?: AbortSignal, musicFolderId?: string) {
    const data = object((await this.request('getArtist', { id }, signal)).artist);
    let albums = list(data.album).map(album);
    // getArtist aggregates libraries; getAlbumList2 supplies the reliable library boundary.
    if (musicFolderId && albums.length) {
      const allowed = new Set<string>(); let offset = 0;
      while (true) {
        const page = list(object((await this.request('getAlbumList2', { type: 'alphabeticalByName', size: 500, offset, musicFolderId }, signal)).albumList2).album);
        page.forEach((item) => allowed.add(text(item.id, '')));
        if (page.length < 500) break;
        offset += 500;
      }
      albums = albums.filter((item) => allowed.has(item.id));
    }
    return { name: text(data.name, '未知歌手'), albums };
  }
  async songs(offset = 0, signal?: AbortSignal, musicFolderId?: string) {
    const data = object((await this.request('search3', { query: '', songCount: 50, songOffset: offset, albumCount: 0, artistCount: 0, musicFolderId }, signal)).searchResult3);
    return list(data.song).map(track);
  }
  async search(query: string, offset = 0, signal?: AbortSignal, musicFolderId?: string) {
    const data = object((await this.request('search3', { query, songCount: 30, albumCount: 30, artistCount: 30, songOffset: offset, albumOffset: offset, artistOffset: offset, musicFolderId }, signal)).searchResult3);
    return { songs: list(data.song).map(track), albums: list(data.album).map(album), artists: list(data.artist).map((a) => ({ id: text(a.id, ''), name: text(a.name, '未知歌手') })) };
  }
  async favorites(signal?: AbortSignal, musicFolderId?: string) {
    const data = object((await this.request('getStarred2', { musicFolderId }, signal)).starred2);
    return { songs: list(data.song).map(track), albums: list(data.album).map(album), artists: list(data.artist).map((a) => ({ id: text(a.id, ''), name: text(a.name, '未知歌手') })) };
  }
  async star(id: string, starred: boolean, kind: 'song' | 'album' | 'artist' = 'song') {
    return this.request(starred ? 'unstar' : 'star', { [kind === 'song' ? 'id' : `${kind}Id`]: id }, undefined, true);
  }
  async playlists(signal?: AbortSignal) { return list(object((await this.request('getPlaylists', {}, signal)).playlists).playlist).map(playlist); }
  async playlist(id: string, signal?: AbortSignal) {
    const dto = object((await this.request('getPlaylist', { id }, signal)).playlist);
    return { ...playlist(dto), songs: list(dto.entry).map(track) };
  }
  async createPlaylist(name: string, songs: string[] = []) { return playlist(object((await this.request('createPlaylist', { name, songId: songs }, undefined, true)).playlist)); }
  async savePlaylist(id: string, name: string, songs: string[], changed?: string) {
    const before = await this.playlist(id);
    if (before.changed !== changed) throw new ApiError('歌单已被其他客户端修改。请保留草稿并重新读取。');
    await this.request('createPlaylist', { playlistId: id, songId: songs }, undefined, true);
    if (before.name !== name) await this.request('updatePlaylist', { playlistId: id, name }, undefined, true);
    const after = await this.playlist(id);
    if (after.name !== name || after.songs.map((s) => s.id).join('|') !== songs.join('|')) throw new ApiError('保存后歌单与草稿不同，请重新读取核实。');
    return after;
  }
  async lyrics(id: string, artist: string, title: string, signal?: AbortSignal): Promise<Lyrics> {
    if (this.supports('songLyrics')) {
      try {
        const data = await this.request('getLyricsBySongId', { id }, signal);
        const choices = list(object(data.lyricsList).structuredLyrics);
        const chosen = choices.find((l) => l.synced === true) ?? choices[0];
        // OpenSubsonic positive offset means earlier; our internal positive delay means later.
        if (chosen) return { synced: chosen.synced === true, offsetMs: -(num(chosen.offset) ?? 0), lang: str(chosen.lang), lines: list(chosen.line).map((l) => ({ startMs: num(l.start), text: text(l.value, '') })) };
      } catch (e) { if (signal?.aborted || (e instanceof ApiError && e.code === 40)) throw e; }
    }
    const plain = object((await this.request('getLyrics', { artist, title }, signal)).lyrics);
    return { synced: false, offsetMs: 0, lines: text(plain.value, '').split(/\r?\n/).filter(Boolean).map((text) => ({ text })) };
  }
  async scrobble(id: string, time: number, submission: boolean) { return this.request('scrobble', { id, time, submission }, undefined, true); }
}
