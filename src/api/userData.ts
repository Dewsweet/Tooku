import { isBackup, isUserDocument, type UserData } from '../domain/userData';
import { emptyRecommendationCredentials, type RecommendationCredentials } from '../domain/recommendations';
import { tookuServiceProtocol } from '../domain/serviceProtocol';

export type SavedCredentials = Record<keyof RecommendationCredentials, boolean>;
export interface CredentialStatus { revision: number; saved: SavedCredentials }
export interface ManagedServer { id: string; address: string; primary: string; aliases: string[] }
function managedServer(value: unknown): ManagedServer {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !/^[\w-]{22}$/.test(value.id) || !('address' in value) || typeof value.address !== 'string' || !('primary' in value) || typeof value.primary !== 'string' || !('aliases' in value) || !Array.isArray(value.aliases) || !value.aliases.every((alias) => typeof alias === 'string')) throw new UserDataError('音乐服务器记录无效。');
  if (!value.aliases.length || value.aliases.length > 20 || new Set(value.aliases).size !== value.aliases.length || !value.aliases.includes(value.address) || !value.aliases.includes(value.primary)) throw new UserDataError('音乐服务器记录无效。');
  return { id: value.id, address: value.address, primary: value.primary, aliases: value.aliases };
}
function credentialStatus(value: unknown): CredentialStatus {
  if (!value || typeof value !== 'object' || !('revision' in value) || !Number.isSafeInteger(value.revision) || typeof value.revision !== 'number' || value.revision < 0 || !('saved' in value) || !value.saved || typeof value.saved !== 'object') throw new UserDataError('密钥保存状态无效。');
  const saved = value.saved;
  if (!Object.keys(emptyRecommendationCredentials).every((field) => field in saved && typeof Reflect.get(saved, field) === 'boolean')) throw new UserDataError('密钥保存状态无效。');
  return { revision: value.revision, saved: { lastfmKey: Reflect.get(saved, 'lastfmKey') === true, aiKey: Reflect.get(saved, 'aiKey') === true, appleToken: Reflect.get(saved, 'appleToken') === true, spotifyClientId: Reflect.get(saved, 'spotifyClientId') === true, spotifyClientSecret: Reflect.get(saved, 'spotifyClientSecret') === true } };
}
function assertServiceProtocol(value: unknown) {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'serviceProtocol') !== tookuServiceProtocol) {
    throw new UserDataError('Tooku 前后端版本不兼容，请刷新页面；如仍出现，请升级并重启 Tooku 服务。', 426);
  }
}

export class UserDataError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
export class UserDataApi {
  #token = '';
  owner = '';
  async request(path: string, method = 'GET', data?: unknown, useServerError = false): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`/api/tooku/${path}`, { method, credentials: 'same-origin', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', ...(this.owner ? { 'X-Tooku-Owner': this.owner } : {}), ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new UserDataError('服务器暂不可用，本地修改已保留。请重新读取同步状态。'); }
    if (!response.ok) {
      let serverError = '';
      if (useServerError) {
        try { const result: unknown = await response.json(); const value = result && typeof result === 'object' ? Reflect.get(result, 'error') : undefined; if (typeof value === 'string' && value.length <= 200) serverError = value; } catch { /* Fall back to the stable client message. */ }
      }
      throw new UserDataError(serverError || (response.status === 426 ? 'Tooku 前后端版本不兼容，请刷新页面；如仍出现，请升级并重启 Tooku 服务。' : response.status === 409 ? '另一设备已修改数据，请选择保留的版本。' : response.status === 401 ? '同步会话已失效，请重新连接。' : response.status === 413 ? '账号数据超过 12 MB，请减少封面。' : '服务器暂不可用，本地数据仍保留。'), response.status);
    }
    try { return await response.json(); } catch { throw new UserDataError('同步接口不可用，本地数据仍保留。'); }
  }
  async connect(auth: { u: string; t: string; s: string }, native?: { nativeToken: string; admin: boolean }, clientBase?: string, connectionId?: string) {
    const session = await this.request('session', 'POST', { ...auth, ...native, persistent: true, clientBase, connectionId });
    assertServiceProtocol(session);
    if (!session || typeof session !== 'object' || !('owner' in session) || typeof session.owner !== 'string') throw new UserDataError('同步接口不可用。');
    if ('token' in session && typeof session.token === 'string') this.#token = session.token;
    this.owner = session.owner;
  }
  async restore() {
    let session: unknown;
    try { session = await this.request('session'); } catch (error) { if (error instanceof UserDataError && error.status === 401) return null; throw error; }
    assertServiceProtocol(session);
    if (!session || typeof session !== 'object' || !('owner' in session) || typeof session.owner !== 'string' || !('username' in session) || typeof session.username !== 'string' || !session.username || !('admin' in session) || typeof session.admin !== 'boolean') throw new UserDataError('登录状态无效，请重新登录。');
    this.owner = session.owner;
    const clientBase = Reflect.get(session, 'clientBase');
    if (clientBase !== undefined && typeof clientBase !== 'string') throw new UserDataError('登录状态无效，请重新登录。');
    return { username: session.username, admin: session.admin, clientBase };
  }
  async credentials() { return credentialStatus(await this.request('credentials')); }
  async server() { return managedServer(await this.request('server', 'GET', undefined, true)); }
  async addServerAlias(connectionId: string) { return managedServer(await this.request('server/aliases', 'POST', { connectionId, confirm: true }, true)); }
  async setPrimaryServerAddress(primary: string) { return managedServer(await this.request('server', 'PATCH', { primary }, true)); }
  async removeServerAlias(address: string) { return managedServer(await this.request('server/aliases', 'DELETE', { address, confirm: true }, true)); }
  async saveCredentials(revision: number, credentials: Partial<RecommendationCredentials>) {
    return credentialStatus(await this.request('credentials', 'PUT', { revision, credentials }));
  }
  async logout() {
    await this.request('session', 'DELETE'); this.dispose();
  }
  async read() {
    const doc = await this.request('data');
    if (!isUserDocument(doc)) throw new UserDataError('服务器数据版本无效。');
    return doc;
  }
  async write(revision: number, data: UserData) {
    const doc = await this.request('data', 'PUT', { revision, data });
    if (!isUserDocument(doc) || doc.revision !== revision + 1) throw new UserDataError('保存结果未知，请重新读取。');
    return doc;
  }
  async backup() {
    const backup = await this.request('backup');
    if (!isBackup(backup) || backup.owner !== this.owner) throw new UserDataError('服务器备份格式无效。');
    return backup;
  }
  async revisions() {
    const versions = await this.request('revisions');
    if (!Array.isArray(versions) || versions.length > 2 || !versions.every(isUserDocument)) throw new UserDataError('历史版本格式无效。');
    return versions;
  }
  dispose() {
    // Disposing a UI/connection does not revoke a persistent browser login.
    this.#token = ''; this.owner = '';
  }
}
