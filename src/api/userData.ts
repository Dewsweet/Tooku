import { isBackup, isUserDocument, type UserData } from '../domain/userData';

export class UserDataError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
export class UserDataApi {
  #token = '';
  owner = '';
  async request(path: string, method = 'GET', data?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`/api/tooku/${path}`, { method, credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new UserDataError('服务器暂不可用，本地修改已保留。请重新读取同步状态。'); }
    if (!response.ok) {
      throw new UserDataError(response.status === 409 ? '另一设备已修改数据，请选择保留的版本。' : response.status === 401 ? '同步会话已失效，请重新连接。' : response.status === 413 ? '账号数据超过 12 MB，请减少封面。' : '服务器暂不可用，本地数据仍保留。', response.status);
    }
    try { return await response.json(); } catch { throw new UserDataError('同步接口不可用，本地数据仍保留。'); }
  }
  async connect(auth: { u: string; t: string; s: string }) {
    const session = await this.request('session', 'POST', auth);
    if (!session || typeof session !== 'object' || !('token' in session) || !('owner' in session) || typeof session.token !== 'string' || typeof session.owner !== 'string') throw new UserDataError('同步接口不可用。');
    this.#token = session.token; this.owner = session.owner;
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
    if (this.#token) void fetch('/api/tooku/session', { method: 'DELETE', credentials: 'omit', keepalive: true, headers: { Authorization: `Bearer ${this.#token}` } }).catch(() => {});
    this.#token = ''; this.owner = '';
  }
}
