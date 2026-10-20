import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isUserData, maxUserDataBytes, type UserData, type UserDocument } from '../src/domain/userData.ts';

export class DataError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export class UserStore {
  #db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(filename, { timeout: 5000 });
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    const version = this.#db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) { this.#db.close(); throw new Error('Unsupported Tooku database version'); }
    // A single transactional migration; future migrations must retain user rows.
    this.#db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS documents (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS revisions (owner TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner, revision)) STRICT;
      PRAGMA user_version=1; COMMIT;`);
  }
  read(owner: string): UserDocument {
    const row = this.#db.prepare('SELECT revision, updated_at, data FROM documents WHERE owner=?').get(owner);
    if (!row) return { revision: 0, updatedAt: 0, data: null };
    if (typeof row.data !== 'string' || typeof row.revision !== 'number' || typeof row.updated_at !== 'number') throw new Error('Invalid database row');
    const data: unknown = JSON.parse(row.data);
    if (!isUserData(data)) throw new Error('Invalid stored user data');
    return { revision: row.revision, updatedAt: row.updated_at, data };
  }
  write(owner: string, expected: number, data: UserData): UserDocument {
    if (!Number.isSafeInteger(expected) || expected < 0 || !isUserData(data)) throw new DataError(400, '数据格式或版本无效。');
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized) > maxUserDataBytes) throw new DataError(413, '账号数据超过 12 MB，请减少自定义封面。');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.read(owner);
      if (current.revision !== expected) throw new DataError(409, '服务器数据已变化，请比较后选择保留的版本。');
      if (current.data) this.#db.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?)').run(owner, current.revision, current.updatedAt, JSON.stringify(current.data));
      const revision = expected + 1; const updatedAt = Date.now();
      this.#db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, data=excluded.data').run(owner, revision, updatedAt, serialized);
      // Keep only the last two complete versions, including images: bounded, no orphan files.
      this.#db.prepare('DELETE FROM revisions WHERE owner=? AND revision < ?').run(owner, revision - 2);
      this.#db.exec('COMMIT'); return { revision, updatedAt, data };
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  previous(owner: string): UserDocument[] {
    return this.#db.prepare('SELECT revision, updated_at, data FROM revisions WHERE owner=? ORDER BY revision DESC').all(owner).map((r) => {
      const data: unknown = typeof r.data === 'string' ? JSON.parse(r.data) : null;
      if (!isUserData(data) || typeof r.revision !== 'number' || typeof r.updated_at !== 'number') throw new Error('Invalid revision');
      return { revision: r.revision, updatedAt: r.updated_at, data };
    });
  }
  close() { this.#db.close(); }
}
