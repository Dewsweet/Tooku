import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { emptyRecommendationCredentials, isRecommendationCredentials, type RecommendationCredentials } from '../src/domain/recommendations.ts';
import { DataError } from './store.ts';

export interface StoredSession {
  owner: string; upstream: string; auth: { u: string; t: string; s: string }; nativeToken: string; admin: boolean;
  expires: number; verifiedAt: number; clientBase?: string;
}
export const sessionLifetime = 30 * 24 * 3600000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

// Separate from account documents and their JSON/SQLite backups. Ciphertext is bound to its owner/purpose.
export class CredentialVault {
  #db: DatabaseSync;
  #key: Buffer;
  constructor(filename: string, keyFile?: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(filename, { timeout: 5000 });
    try {
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const version = this.#db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1) throw new Error('Unsupported Tooku security database version');
      this.#db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS credentials (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;
        PRAGMA user_version=1; COMMIT;`);
      if (filename === ':memory:') this.#key = randomBytes(32);
      else {
        const target = keyFile ?? resolve(dirname(filename), 'tooku-secret.key');
        if (!existsSync(target)) {
          const used = this.#db.prepare('SELECT (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM credentials) AS count').get()?.count;
          if (used !== 0) throw new Error('Tooku encryption key is missing; restore the original key file.');
          mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
          try { writeFileSync(target, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
          catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
        }
        this.#key = readFileSync(target);
        if (this.#key.length !== 32) throw new Error('Invalid Tooku encryption key file');
        // Detect a wrong key before accepting writes, never replace unreadable encrypted records.
        for (const row of this.#db.prepare('SELECT owner, payload FROM credentials LIMIT 1').all()) {
          this.#open(String(row.payload), `credentials:${String(row.owner)}`);
        }
        for (const row of this.#db.prepare('SELECT id, payload FROM sessions LIMIT 1').all()) {
          this.#open(String(row.payload), `session:${String(row.id)}`);
        }
      }
    } catch (error) { this.#db.close(); throw error; }
  }
  #seal(value: unknown, context: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
  }
  #open(payload: string, context: string): unknown {
    const envelope: unknown = JSON.parse(payload);
    if (!envelope || typeof envelope !== 'object' || !('v' in envelope) || envelope.v !== 1 || !('iv' in envelope) || typeof envelope.iv !== 'string' || !('tag' in envelope) || typeof envelope.tag !== 'string' || !('data' in envelope) || typeof envelope.data !== 'string') throw new Error('Invalid encrypted Tooku record');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')) as unknown;
  }
  createSession(session: StoredSession, previous?: string) {
    const token = randomBytes(32).toString('base64url'); const id = hash(token);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      if (previous) this.#db.prepare('DELETE FROM sessions WHERE id=?').run(hash(previous));
      if (Number(this.#db.prepare('SELECT COUNT(*) AS count FROM sessions').get()?.count) >= 10000) throw new DataError(429, '登录会话过多，请稍后再试。');
      this.#db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(id, session.owner, session.expires, this.#seal(session, `session:${id}`));
      this.#db.exec('COMMIT'); return token;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  session(token: string, now: number): StoredSession | undefined {
    if (!/^[\w-]{43}$/.test(token)) return;
    const id = hash(token); const row = this.#db.prepare('SELECT payload, expires FROM sessions WHERE id=?').get(id);
    if (!row || typeof row.expires !== 'number' || row.expires <= now) { this.deleteSession(token); return; }
    const data = this.#open(String(row.payload), `session:${id}`);
    if (!data || typeof data !== 'object' || !('auth' in data) || !data.auth || typeof data.auth !== 'object' || !('u' in data.auth) || typeof data.auth.u !== 'string' || !('t' in data.auth) || typeof data.auth.t !== 'string' || !('s' in data.auth) || typeof data.auth.s !== 'string' || !('owner' in data) || typeof data.owner !== 'string' || !('nativeToken' in data) || typeof data.nativeToken !== 'string' || !('admin' in data) || typeof data.admin !== 'boolean' || !('expires' in data) || typeof data.expires !== 'number' || !('verifiedAt' in data) || typeof data.verifiedAt !== 'number') throw new Error('Invalid Tooku session');
    if (!('upstream' in data) || typeof data.upstream !== 'string') throw new Error('Invalid Tooku session upstream');
    const clientBase = Reflect.get(data, 'clientBase');
    if (clientBase !== undefined && typeof clientBase !== 'string') throw new Error('Invalid Tooku session client base');
    return { owner: data.owner, upstream: data.upstream, auth: { u: data.auth.u, t: data.auth.t, s: data.auth.s }, nativeToken: data.nativeToken, admin: data.admin, expires: data.expires, verifiedAt: data.verifiedAt, clientBase };
  }
  updateSession(token: string, session: StoredSession) {
    const id = hash(token); this.#db.prepare('UPDATE sessions SET payload=? WHERE id=?').run(this.#seal(session, `session:${id}`), id);
  }
  deleteSession(token: string) { this.#db.prepare('DELETE FROM sessions WHERE id=?').run(hash(token)); }
  sweep(now: number) { this.#db.prepare('DELETE FROM sessions WHERE expires<=?').run(now); }
  credentials(owner: string) {
    const row = this.#db.prepare('SELECT revision, payload FROM credentials WHERE owner=?').get(owner);
    if (!row) return { revision: 0, credentials: { ...emptyRecommendationCredentials } };
    const credentials = this.#open(String(row.payload), `credentials:${owner}`);
    if (!isRecommendationCredentials(credentials) || typeof row.revision !== 'number') throw new Error('Invalid stored Tooku credentials');
    return { revision: row.revision, credentials };
  }
  saveCredentials(owner: string, revision: number, patch: Partial<RecommendationCredentials>) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new DataError(400, '密钥版本无效。');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const before = this.credentials(owner);
      if (before.revision !== revision) throw new DataError(409, '服务密钥已被修改，请重新读取后再保存。');
      const credentials = { ...before.credentials, ...patch };
      if (!isRecommendationCredentials(credentials)) throw new DataError(400, '服务密钥格式无效。');
      this.#db.prepare('INSERT INTO credentials VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision, payload=excluded.payload').run(owner, revision + 1, this.#seal(credentials, `credentials:${owner}`));
      this.#db.exec('COMMIT'); return { revision: revision + 1, credentials };
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  close() { this.#db.close(); this.#key.fill(0); }
}
