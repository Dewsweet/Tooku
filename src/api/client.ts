import md5 from 'blueimp-md5';
import { UserDataApi } from './userData';
import type { Album, Artist, Lyrics, Playlist, Track, MusicLibrary } from '../domain/models';
import { playlistPermissions } from '../domain/playlistPermissions';

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
  return { id: text(dto.id, ''), name: text(dto.name, '未命名歌单'), owner: str(dto.owner), songCount: num(dto.songCount), changed: str(dto.changed), coverArt: str(dto.coverArt), duration: num(dto.duration), comment: str(dto.comment), readonly: typeof dto.readonly === 'boolean' ? dto.readonly : undefined };
}

const errors: Record<number, string> = {
  10: '请求缺少必要参数。', 20: '客户端协议不受支持。', 30: '服务器协议版本过旧。',
  40: '用户名或密码不正确。', 41: '此账号不支持 token 认证。', 42: '服务器不支持此认证方式。',
  43: '认证参数存在冲突。', 44: '认证密钥无效。', 50: '你没有执行此操作的权限。',
  60: '此服务器的许可状态不可用。', 70: '内容不存在，或已从音乐库移除。',
};
export class ApiError extends Error {
  constructor(message: string, public code?: number, public httpStatus?: number, public retryable = false) { super(message); this.name = 'ApiError'; }
}
export function normalizeServer(input: string, origin = window.location.origin) {
  const trimmed = input.trim();
  let url: URL;
  try { url = new URL(trimmed === '/nd' ? `${origin}/nd` : trimmed); }
  catch { throw new ApiError('请输入完整的 http/https 服务地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ApiError('请输入完整的 http/https 服务地址，不包含账号、查询参数或锚点。');
  }
  const base = url.href.replace(/\/+$/, '');
  // The Tooku site itself is a friendly alias for its fixed Navidrome proxy.
  return base === origin ? `${origin}/nd` : base;
}
export function authToken(password: string, salt: string) { return md5(password + salt); }

const managedTransport = () => `${window.location.origin}/api/navidrome`;
async function managedServer(base: string, signal?: AbortSignal) {
  try {
    const response = await fetch('/api/tooku/connection', {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server: base }),
      signal: signal ?? AbortSignal.timeout(8000),
    });
    if (!response.ok) return { managed: false, connectionId: '' };
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('managed' in result) || result.managed !== true) return { managed: false, connectionId: '' };
    const connectionId = 'connectionId' in result && typeof result.connectionId === 'string' && /^[\w-]{43}$/.test(result.connectionId) ? result.connectionId : '';
    return { managed: true, connectionId };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { managed: false, connectionId: '' };
  }
}

export async function prepareServerAlias(input: string, signal?: AbortSignal) {
  const base = normalizeServer(input); const timeout = AbortSignal.timeout(10000);
  const requestSignal = AbortSignal.any([timeout, ...(signal ? [signal] : [])]);
  let response: Response;
  try {
    response = await fetch('/api/tooku/connection', {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server: base, purpose: 'alias' }), signal: requestSignal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(timeout.aborted ? '连接超时，请检查地址或稍后重试。' : '无法连接新的音乐服务器地址。');
  }
  const result: unknown = await response.json().catch(() => undefined);
  const connectionId = result && typeof result === 'object' && 'connectionId' in result && typeof result.connectionId === 'string' ? result.connectionId : '';
  if (!response.ok || !/^[\w-]{43}$/.test(connectionId)) throw new ApiError(response.status === 429 ? '连接请求过于频繁，请稍后再试。' : '新地址未通过 Navidrome 服务验证。');
  return { base, connectionId };
}

/** Anonymous protocol probe: no session, credentials, extension discovery or account writes. */
export async function testServerConnection(input: string, signal?: AbortSignal): Promise<{ latencyMs: number }> {
  const base = normalizeServer(input);
  const timeout = AbortSignal.timeout(8000);
  const requestSignal = AbortSignal.any([timeout, ...(signal ? [signal] : [])]);
  try {
    const connection = await managedServer(base, requestSignal);
    const transport = connection.managed ? managedTransport() : base;
    const started = performance.now();
    const params = new URLSearchParams({ v: '1.16.1', c: 'Tooku', f: 'json' });
    const response = await fetch(`${transport}/rest/ping.view?${params}`, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', headers: connection.connectionId ? { 'X-Tooku-Connection': connection.connectionId } : undefined,
      signal: requestSignal,
    });
    if (!response.ok && response.status !== 401 && response.status !== 403) throw new ApiError(`连接失败（HTTP ${response.status}）。`);
    const body: unknown = await response.json().catch(() => { throw new ApiError('未识别到音乐服务，请检查服务器地址。'); });
    const result = object(object(body)['subsonic-response']);
    const code = num(object(result.error).code);
    // Requiring authentication is an expected response to an anonymous ping.
    const requiresAccount = result.status === 'failed' && code !== undefined && [10, 40, 41, 42, 43, 44, 50].includes(code);
    if (!(response.ok && result.status === 'ok') && !requiresAccount) throw new ApiError('未识别到音乐服务，请检查服务器地址。');
    return { latencyMs: Math.max(1, Math.round(performance.now() - started)) };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new ApiError('连接超时，请检查地址或稍后重试。');
    if (error instanceof ApiError) throw error;
    throw new ApiError('无法连接，请检查地址、网络或跨域访问设置。');
  }
}

type Params = Record<string, string | number | boolean | string[] | undefined>;
export interface PlaybackLocation { url: string; expiresAt?: number }

export class MusicApi {
  readonly identity: string;
  readonly extensions = new Map<string, number[]>();
  #auth: { u: string; t: string; s: string };
  #abort = new AbortController();
  #userData: UserDataApi | null = null;
  #nativeToken = '';
  #nativeAdmin = false;
  #cookieSession = false;
  #managed = false;
  #connectionId = '';
  #owner = '';
  #transportBase: string;
  #uncertainArtistImages = new Set<string>();
  #writingArtistImages = new Set<string>();
  get canEditArtistImages() { return Boolean((this.#nativeToken || this.#cookieSession) && this.#nativeAdmin); }
  get persistent() { return this.#cookieSession; }
  get managed() { return this.#managed; }
  constructor(readonly base: string, readonly username: string, password: string, salt?: string) {
    const random = salt ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.#auth = { u: username, t: authToken(password, random), s: random };
    this.identity = `${base}|${username}`;
    this.#transportBase = base;
  }
  dispose() { this.#abort.abort(); this.#userData?.dispose(); this.#userData = null; this.#auth = { u: '', t: '', s: '' }; this.#nativeToken = ''; this.#nativeAdmin = false; this.#connectionId = ''; this.#owner = ''; this.#uncertainArtistImages.clear(); this.#writingArtistImages.clear(); }
  static async restoreSession() {
    const client = new UserDataApi(); const session = await client.restore();
    if (!session) return null;
    const api = new MusicApi(session.clientBase ?? `${window.location.origin}/nd`, session.username, '');
    api.#auth = { u: '', t: '', s: '' }; api.#cookieSession = true; api.#managed = true; api.#transportBase = managedTransport(); api.#nativeAdmin = session.admin; api.#owner = client.owner; api.#userData = client;
    try { const version = await api.connect(); return { api, version }; }
    catch (error) { api.dispose(); throw error; }
  }
  async logout() { if (this.#cookieSession) await this.#userData?.logout(); }
  async prepare(signal?: AbortSignal) {
    const connection = await managedServer(this.base, signal);
    this.#managed = connection.managed; this.#connectionId = connection.connectionId;
    this.#transportBase = this.#managed ? managedTransport() : this.base;
  }
  async userData() {
    if (!this.#managed) await this.prepare(this.#abort.signal);
    if (!this.#managed) return null;
    if (this.#cookieSession && this.#userData) return this.#userData;
    const client = new UserDataApi(); await client.connect(this.#auth, { nativeToken: this.#nativeToken, admin: this.#nativeAdmin }, this.base, this.#connectionId);
    if (this.#abort.signal.aborted) { client.dispose(); throw new ApiError('连接已关闭。'); }
    this.#userData = client; this.#cookieSession = true; this.#nativeToken = ''; this.#connectionId = ''; this.#owner = client.owner; this.#auth = { u: '', t: '', s: '' }; return client;
  }
  supports(name: string, version = 1) { return (this.extensions.get(name) ?? []).some((v) => v >= version); }
  #params(params: Params) {
    const out = new URLSearchParams({ v: '1.16.1', c: 'Tooku', f: 'json', ...(this.#cookieSession ? { tookuSession: '1', tookuUser: this.username, tookuOwner: this.#owner } : this.#auth) });
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) value.forEach((item) => out.append(key, item));
      else out.set(key, String(value));
    }
    return out;
  }
  mediaUrl(method: 'stream' | 'getCoverArt', params: Params) {
    const args = this.#params(params); args.delete('f');
    return `${this.#transportBase}/rest/${method}.view?${args}`;
  }
  coverUrl(id?: string, size = 400, revision?: number) { return id ? this.mediaUrl('getCoverArt', { id, size, _: revision }) : undefined; }
  streamUrl(id: string, mode: 'original' | 'compatible') {
    if (this.#cookieSession) throw new ApiError('受管连接需要先取得临时播放授权。');
    return this.mediaUrl('stream', { id, ...(mode === 'compatible' ? { format: 'mp3', maxBitRate: 320 } : {}) });
  }
  playbackUrl(id: string, mode: 'original' | 'compatible'): PlaybackLocation | Promise<PlaybackLocation> {
    if (!this.#cookieSession) return { url: this.streamUrl(id, mode) };
    return this.#managedPlaybackUrl(id, mode);
  }
  async #managedPlaybackUrl(id: string, mode: 'original' | 'compatible'): Promise<PlaybackLocation> {
    let response: Response;
    try {
      response = await fetch('/api/tooku/playback', {
        method: 'POST', credentials: 'same-origin', referrerPolicy: 'no-referrer', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mode }),
        signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(12000)]),
      });
    } catch { throw new ApiError('无法取得播放授权，请检查 Tooku 服务连接。', undefined, undefined, !this.#abort.signal.aborted); }
    if (!response.ok) throw new ApiError(response.status === 401 ? '登录已失效，请重新连接。' : response.status === 429 ? '播放请求过于频繁，请稍后重试。' : `无法取得播放授权（HTTP ${response.status}）。`, undefined, response.status, [408, 502, 503, 504].includes(response.status));
    let result: unknown; try { result = await response.json(); } catch { throw new ApiError('播放授权响应无效。'); }
    const value = object(result); const url = str(value.url); const expiresAt = num(value.expiresAt);
    if (!url || !/^\/api\/tooku-stream\/[a-zA-Z0-9_-]{43}$/.test(url) || !expiresAt || expiresAt <= Date.now()) throw new ApiError('播放授权响应无效。');
    return { url: new URL(url, window.location.origin).href, expiresAt };
  }
  async request(method: string, params: Params = {}, signal?: AbortSignal, write = false): Promise<DTO> {
    const args = this.#params(params);
    const post = this.supports('formPost');
    const endpoint = `${this.#transportBase}/rest/${method}.view${post && this.#cookieSession ? `?tookuSession=1&tookuUser=${encodeURIComponent(this.username)}&tookuOwner=${encodeURIComponent(this.#owner)}` : ''}`;
    if (!post && endpoint.length + args.toString().length > 8000) throw new ApiError('请求过长；服务器需要支持表单 POST 才能保存此列表。');
    let response: Response;
    try {
      response = await fetch(post ? endpoint : `${endpoint}?${args}`, {
        method: post ? 'POST' : 'GET', body: post ? args : undefined,
        headers: this.#connectionId ? { 'X-Tooku-Connection': this.#connectionId } : undefined,
        credentials: this.#cookieSession ? 'same-origin' : 'omit', referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([this.#abort.signal, ...(signal ? [signal] : []), AbortSignal.timeout(write ? 30000 : 12000)]),
      });
    } catch (error) {
      if (this.#abort.signal.aborted || signal?.aborted) throw error;
      throw new ApiError(write ? '保存结果暂时未知，请重新读取核实后再操作。' : '无法连接服务，请检查地址、网络和浏览器访问权限。');
    }
    if (!response.ok) {
      if (response.status === 401) throw new ApiError('认证已失效，请重新连接。', 40);
      if (write && response.status >= 500) throw new ApiError('保存结果暂时未知，请重新读取核实后再操作。');
      if (response.status === 502 || response.status === 504) throw new ApiError('Navidrome 暂时不可用，请检查服务状态后重试。');
      throw new ApiError(`服务请求失败（HTTP ${response.status}）。`);
    }
    let json: unknown;
    try { json = await response.json(); } catch { throw new ApiError('接口返回了网页或无法识别的数据，请检查反向代理。'); }
    const result = object(object(json)['subsonic-response']);
    if (result.status !== 'ok') {
      const code = num(object(result.error).code);
      throw new ApiError(code ? errors[code] ?? '服务器未能完成请求。' : '服务响应缺少有效的协议状态。', code);
    }
    return result;
  }
  async connect(password?: string) {
    const ping = await this.request('ping');
    try {
      const ext = await this.request('getOpenSubsonicExtensions');
      for (const item of list(ext.openSubsonicExtensions)) {
        if (typeof item.name === 'string' && Array.isArray(item.versions)) this.extensions.set(item.name, item.versions.filter((v): v is number => typeof v === 'number'));
      }
    } catch { /* optional detection must not block a valid login */ }
    if (str(ping.type)?.toLowerCase() === 'navidrome' && password !== undefined) {
      try {
        const response = await fetch(`${this.#transportBase}/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.#connectionId ? { 'X-Tooku-Connection': this.#connectionId } : {}) }, body: JSON.stringify({ username: this.username, password }),
          credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
          signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(12000)]),
        });
        if (response.ok) {
          const data = object(await response.json());
          if (!this.#abort.signal.aborted && typeof data.token === 'string' && data.token && typeof data.isAdmin === 'boolean') {
            this.#nativeToken = data.token; this.#nativeAdmin = data.isAdmin;
          }
        }
      } catch { /* Native artwork authentication is optional; listening must remain available. */ }
    }
    return text(ping.serverVersion, '版本未知');
  }
  async #nativeRequest(path: string, body?: FormData, remove = false) {
    if (!this.canEditArtistImages) throw new ApiError('更换服务器歌手图片需要 Navidrome 管理员权限；请重新登录或检查原生 API 代理。');
    const write = Boolean(body || remove);
    let response: Response;
    try {
      response = await fetch(`${this.#transportBase}/api/${path}${this.#cookieSession ? `?tookuSession=1&tookuUser=${encodeURIComponent(this.username)}&tookuOwner=${encodeURIComponent(this.#owner)}` : ''}`, {
        method: remove ? 'DELETE' : body ? 'POST' : 'GET', body,
        headers: this.#cookieSession ? {} : { 'x-nd-authorization': `Bearer ${this.#nativeToken}` }, credentials: this.#cookieSession ? 'same-origin' : 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
        signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(write ? 30000 : 12000)]),
      });
    } catch {
      throw new ApiError(write ? '图片保存结果暂时未知，请重新读取服务器图片后再操作。' : '无法读取 Navidrome 歌手图片，请检查原生 API 连接。');
    }
    const refreshed = response.headers.get('x-nd-authorization');
    if (refreshed && !this.#abort.signal.aborted) this.#nativeToken = refreshed.replace(/^Bearer\s+/i, '');
    if (!response.ok) {
      if (response.status === 401) { this.#nativeToken = ''; this.#nativeAdmin = false; }
      throw new ApiError(response.status === 401 ? '图片编辑会话已失效，请重新登录。' : response.status === 403 ? 'Navidrome 拒绝了图片操作，请检查账号权限。' : response.status === 404 ? '服务器不支持此图片接口，或歌手已不存在。' : write && response.status >= 500 ? '图片保存结果暂时未知，请重新读取服务器图片后再操作。' : `图片请求失败（HTTP ${response.status}）。`);
    }
    try { return object(await response.json()); }
    catch { throw new ApiError(write ? '图片保存结果暂时未知，请重新读取服务器图片后再操作。' : '图片接口返回无效数据，请检查原生 API 代理。'); }
  }
  async artistImage(id: string) {
    const data = await this.#nativeRequest(`artist/${encodeURIComponent(id)}`);
    if (data.id !== id || data.uploadedImage !== undefined && typeof data.uploadedImage !== 'string') throw new ApiError('服务器没有返回有效的歌手图片信息。');
    this.#uncertainArtistImages.delete(id);
    return { uploadedImage: str(data.uploadedImage) ?? '', updatedAt: str(data.updatedAt) };
  }
  async saveArtistImage(id: string, image?: string) {
    if (this.#writingArtistImages.has(id)) throw new ApiError('此歌手的图片正在保存，请稍候。');
    if (this.#uncertainArtistImages.has(id)) throw new ApiError('上次图片保存结果未知，请先重新读取服务器图片。');
    this.#writingArtistImages.add(id);
    try { return await this.#writeArtistImage(id, image); }
    finally { this.#writingArtistImages.delete(id); }
  }
  async #writeArtistImage(id: string, image?: string) {
    const before = await this.artistImage(id);
    let body: FormData | undefined;
    if (image !== undefined) {
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 2 * 1024 * 1024) throw new ApiError('请选择有效且不超过 2 MB 的歌手图片。');
      const bytes = Uint8Array.from(atob(image.slice(image.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      body = new FormData(); body.append('image', new Blob([bytes], { type: image.slice(5, image.indexOf(';')) }), 'artist-image');
    } else if (!before.uploadedImage) return before;
    this.#uncertainArtistImages.add(id);
    const result = await this.#nativeRequest(`artist/${encodeURIComponent(id)}/image`, body, image === undefined);
    if (result.status !== 'ok') throw new ApiError('图片保存结果暂时未知，请重新读取服务器图片后再操作。');
    const after = await this.artistImage(id);
    if (image === undefined ? Boolean(after.uploadedImage) : !after.uploadedImage || after.updatedAt === before.updatedAt && after.uploadedImage === before.uploadedImage) {
      this.#uncertainArtistImages.add(id);
      throw new ApiError('保存后图片信息与预期不同，请重新读取服务器图片后核实。');
    }
    return after;
  }
  async libraries(signal?: AbortSignal): Promise<MusicLibrary[]> {
    const data = await this.request('getMusicFolders', {}, signal);
    return list(object(data.musicFolders).musicFolder).filter((f) => typeof f.id === 'string' || typeof f.id === 'number').map((f) => ({ id: String(f.id), name: text(f.name, '音乐库') }));
  }
  async albums(type = 'newest', offset = 0, signal?: AbortSignal, musicFolderId?: string) {
    const data = await this.request('getAlbumList2', { type, size: 30, offset, musicFolderId }, signal);
    return list(object(data.albumList2).album).map(album);
  }
  async allAlbums(type = 'newest', signal?: AbortSignal, musicFolderId?: string) {
    const albums = new Map<string, Album>();
    // Random pages overlap; enumerate a stable order before shuffling the complete list.
    for (let offset = 0; ; offset += 500) {
      const data = await this.request('getAlbumList2', { type: type === 'random' ? 'alphabeticalByName' : type, size: 500, offset, musicFolderId }, signal);
      const page = list(object(data.albumList2).album).map(album);
      const before = albums.size;
      for (const item of page) albums.set(item.id, item);
      if (page.length < 500 || albums.size === before) break;
    }
    const result = [...albums.values()];
    if (type === 'random') for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  async libraryOverview(musicFolderId: string, signal?: AbortSignal) {
    const seen = new Set<string>(); let songCount = 0; let duration = 0; let completeSongs = true; let completeDuration = true;
    for (let offset = 0; ; offset += 500) {
      const data = await this.request('getAlbumList2', { type: 'alphabeticalByName', size: 500, offset, musicFolderId }, signal);
      const page = list(object(data.albumList2).album); let added = 0;
      for (const item of page) {
        const id = str(item.id); if (!id || seen.has(id)) continue;
        seen.add(id); added++; songCount += num(item.songCount) ?? 0; duration += num(item.duration) ?? 0;
        completeSongs &&= num(item.songCount) !== undefined; completeDuration &&= num(item.duration) !== undefined;
      }
      if (page.length < 500) break;
      if (!added) throw new ApiError('服务器返回了重复的分页结果，请稍后刷新音乐库概览。');
    }
    return { albums: seen.size, songs: completeSongs ? songCount : null, duration: completeDuration ? duration : null };
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
    return { name: text(data.name, '未知歌手'), coverArt: str(data.coverArt), albums };
  }
  async songs(offset = 0, signal?: AbortSignal, musicFolderId?: string) {
    const data = object((await this.request('search3', { query: '', songCount: 50, songOffset: offset, albumCount: 0, artistCount: 0, musicFolderId }, signal)).searchResult3);
    return list(data.song).map(track);
  }
  async search(query: string, offset = 0, signal?: AbortSignal, musicFolderId?: string) {
    const data = object((await this.request('search3', { query, songCount: 30, albumCount: 30, artistCount: 30, songOffset: offset, albumOffset: offset, artistOffset: offset, musicFolderId }, signal)).searchResult3);
    return { songs: list(data.song).map(track), albums: list(data.album).map(album), artists: list(data.artist).map((a) => ({ id: text(a.id, ''), name: text(a.name, '未知歌手'), coverArt: str(a.coverArt) })) };
  }
  async favorites(signal?: AbortSignal, musicFolderId?: string) {
    const data = object((await this.request('getStarred2', { musicFolderId }, signal)).starred2);
    return { songs: list(data.song).map(track), albums: list(data.album).map(album), artists: list(data.artist).map((a) => ({ id: text(a.id, ''), name: text(a.name, '未知歌手'), coverArt: str(a.coverArt) })) };
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
    if (!playlistPermissions(before, this.username).canReorder) throw new ApiError('此歌单为只读，无法修改曲目。', 50);
    if (before.changed !== changed) throw new ApiError('歌单已被其他客户端修改。请保留草稿并重新读取。');
    await this.request('createPlaylist', { playlistId: id, songId: songs }, undefined, true);
    if (before.name !== name) await this.request('updatePlaylist', { playlistId: id, name }, undefined, true);
    const after = await this.playlist(id);
    if (after.name !== name || after.songs.map((s) => s.id).join('|') !== songs.join('|')) throw new ApiError('保存后歌单与草稿不同，请重新读取核实。');
    return after;
  }
  async updatePlaylistDetails(id: string, details: { name: string; comment: string }, changed?: string) {
    const before = await this.playlist(id);
    if (before.changed !== changed) throw new ApiError('歌单已被其他客户端修改。请重新读取后再保存。');
    await this.request('updatePlaylist', { playlistId: id, name: details.name, comment: details.comment }, undefined, true);
    const after = await this.playlist(id);
    if (after.name !== details.name || (after.comment ?? '') !== details.comment) throw new ApiError('保存结果与填写内容不同，请重新读取核实。');
    return after;
  }
  async lyrics(id: string, artist: string, title: string, signal?: AbortSignal): Promise<Lyrics> {
    if (this.supports('songLyrics')) {
      try {
        const data = await this.request('getLyricsBySongId', { id }, signal);
        const choices = list(object(data.lyricsList).structuredLyrics);
        const chinese = (lang: unknown) => typeof lang === 'string' && /^(?:zho|chi|cmn|zh)(?:$|[-_])/i.test(lang);
        const romanized = (lang: unknown) => typeof lang === 'string' && (/(?:^|[-_])(?:romaji|romanization|romanisation|romanized|romanised|roma)(?:$|[-_])/i.test(lang) || /^(?:ja|jpn|ko|kor|zh|zho|chi|cmn|ru|rus|el|ell|gre|ar|ara|th|tha|hi|hin|he|heb|uk|ukr|bg|bul|sr|srp)[-_]latn(?:$|[-_])/i.test(lang));
        const nativeForeign = (choice: DTO) => typeof choice.lang === 'string' && !chinese(choice.lang) && !romanized(choice.lang);
        const chosen = choices.find((choice) => choice.synced === true && nativeForeign(choice))
          ?? choices.find(nativeForeign) ?? choices.find((choice) => choice.synced === true && !romanized(choice.lang))
          ?? choices.find((choice) => !romanized(choice.lang)) ?? choices[0];
        // OpenSubsonic positive offset means earlier; our internal positive delay means later.
        if (chosen) return { synced: chosen.synced === true, offsetMs: -(num(chosen.offset) ?? 0), lang: str(chosen.lang), lines: list(chosen.line).map((l) => ({ startMs: num(l.start), text: text(l.value, '') })), document: {
          version: 1, source: 'local', recordId: id, tracks: choices.map((choice) => ({ role: choice !== chosen && romanized(choice.lang) ? 'romanization' : choice !== chosen && chinese(choice.lang) && !chinese(chosen.lang) ? 'translation' : 'original', lang: str(choice.lang), offsetMs: -(num(choice.offset) ?? 0), lines: list(choice.line).map((l) => ({ startMs: num(l.start), text: text(l.value, '') })) })),
        } };
      } catch (e) {
        // Only a declared unsupported protocol may fall back. Permission or transport
        // failures must not become an empty local result that triggers the network.
        if (signal?.aborted || !(e instanceof ApiError) || ![20, 30].includes(e.code ?? 0)) throw e;
      }
    }
    const plain = object((await this.request('getLyrics', { artist, title }, signal)).lyrics);
    return { synced: false, offsetMs: 0, lines: text(plain.value, '').split(/\r?\n/).filter(Boolean).map((text) => ({ text })), document: { version: 1, source: 'local', recordId: id, tracks: [{ role: 'original', text: text(plain.value, '') }] } };
  }
  async scrobble(id: string, time: number, submission: boolean) { return this.request('scrobble', { id, time, submission }, undefined, true); }
}
