import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class LyricsCache {
  #db?: DatabaseSync;
  #memory = new Map<string, { value: unknown; expires: number; used: number }>();
  mode: 'sqlite' | 'memory' = 'memory';
  constructor(filename: string) {
    try {
      if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
      const db = new DatabaseSync(filename); this.#db = db;
      const version = db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1) throw new Error('Unsupported cache schema');
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS lyrics (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL) STRICT; PRAGMA user_version=1;');
      this.mode = 'sqlite';
    } catch { this.#db?.close(); this.#db = undefined; }
  }
  get(key: string, now: number): { value: unknown; stale: boolean } | undefined {
    try {
      if (this.#db) { const row = this.#db.prepare('SELECT value,expires FROM lyrics WHERE key=?').get(key); if (!row || typeof row.value !== 'string' || typeof row.expires !== 'number') return; this.#db.prepare('UPDATE lyrics SET used=? WHERE key=?').run(now, key); return { value: JSON.parse(row.value), stale: row.expires < now }; }
      const entry = this.#memory.get(key); if (entry) { entry.used = now; return { value: entry.value, stale: entry.expires < now }; }
    } catch { this.#fallback(); }
  }
  put(key: string, value: unknown, ttl: number, now: number) {
    const serialized = JSON.stringify(value); if (Buffer.byteLength(serialized) > 524288) return;
    try {
      if (this.#db) {
        this.#db.prepare('INSERT INTO lyrics VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires,used=excluded.used').run(key, serialized, now + ttl, now);
        const stats = this.#db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(value AS BLOB))),0) AS bytes FROM lyrics').get();
        if (Number(stats?.count) > 5000 || Number(stats?.bytes) > 100 * 1024 * 1024) this.#db.prepare('DELETE FROM lyrics WHERE key IN (SELECT key FROM lyrics ORDER BY used LIMIT 500)').run();
        return;
      }
    } catch { this.#fallback(); }
    this.#memory.set(key, { value, expires: now + ttl, used: now });
    while (this.#memory.size > 40) { const oldest = [...this.#memory.entries()].sort((a, b) => a[1].used - b[1].used)[0]; this.#memory.delete(oldest[0]); }
  }
  #fallback() { try { this.#db?.close(); } catch { /* cache failure must not stop playback */ } this.#db = undefined; this.mode = 'memory'; }
  close() { this.#db?.close(); this.#db = undefined; this.#memory.clear(); }
}
