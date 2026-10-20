import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve(process.env.TOOKU_DATA_DIR || '.local/data', 'tooku.sqlite');
const target = process.argv[2] ? resolve(process.argv[2]) : '';
if (!target || existsSync(target) || !existsSync(source)) {
  console.error('Usage: npm run backup -- <new-backup.sqlite> (source must exist; target must not exist)'); process.exit(1);
}
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
try { await backup(db, target); console.log('Tooku SQLite backup completed.'); } finally { db.close(); }
