// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createUserApi } from '../server/api';
import { UserStore, DataError } from '../server/store';
import { isUserData, type UserData } from '../src/domain/userData';

export function sampleData(): UserData {
  const track = { id: 'track-1', title: '测试歌曲', artist: '测试歌手', coverArt: 'cover-1' };
  return { version: 1, preferences: { theme: 'light', accent: '#c83e55', sidePanel: true, panelWidth: 328, trackColumns: [2.8, 1.5, 1.8, .6], panelSections: ['cover', 'lyrics', 'details', 'queue'].map((id) => ({ id: id as 'cover' | 'lyrics' | 'details' | 'queue', enabled: true })), lyricSize: 30, lyricDelay: 0, reducedMotion: false, shortcuts: true },
    profile: { playlistCovers: {} }, organization: { folders: [], placements: {}, views: {} },
    queue: { version: 1, entries: [{ entryId: 'a', track }, { entryId: 'b', track }], currentId: 'b', position: 12, repeat: 'all', volume: .7 },
    history: [{ occurrenceId: 'first', track, listenedAt: 1000, submitted: true }, { occurrenceId: 'second', track, listenedAt: 2000, submitted: false }] };
}
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllGlobals(); });
async function listening(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanups.push(() => new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  return `http://127.0.0.1:${address.port}`;
}
describe('versioned user storage', () => {
  it('round-trips optional lyrics settings while accepting old data and rejecting credential fields', () => {
    const legacy = sampleData(); expect(isUserData(legacy)).toBe(true);
    const lyrics = { enabled: true, order: ['netease', 'qq'], tracks: { song: { mode: 'qq', bindings: { qq: 'abc123' }, edits: { local: { layout: 'alternating', hash: 'a', delayMs: 100 } } } } };
    const data = { ...legacy, lyrics }; expect(isUserData(data)).toBe(true);
    if (!isUserData(data)) throw new Error('Invalid fixture');
    const store = new UserStore(':memory:'); cleanups.push(() => store.close()); store.write('alice', 0, data);
    expect(store.read('alice').data?.lyrics).toEqual(lyrics); expect(store.read('bob').data).toBeNull();
    expect(isUserData({ ...data, lyrics: { ...lyrics, password: 'invalid' } })).toBe(false);
  });
  it('round-trips optional playback sources and shuffle order while retaining legacy documents', () => {
    const data = sampleData(); expect(isUserData(data)).toBe(true);
    if (!data.queue) throw new Error('Missing fixture queue');
    data.queue.shuffle = true; data.queue.originalOrder = ['b', 'a'];
    data.queue.entries[0].source = { kind: 'playlist', id: 'playlist-a' };
    data.queue.entries[1].source = { kind: 'album', id: 'album-b', libraryId: 'music' };
    expect(isUserData(data)).toBe(true);
    const store = new UserStore(':memory:'); cleanups.push(() => store.close());
    store.write('alice', 0, data); expect(store.read('alice').data?.queue).toEqual(data.queue);
    for (const originalOrder of [['a', 'a'], ['a'], ['a', 'missing']]) {
      expect(isUserData({ ...data, queue: { ...data.queue, originalOrder } })).toBe(false);
    }
    for (const source of [{ kind: 'playlist', id: 'https://example.test/rest?u=fixture' }, { kind: 'unknown', id: 'a' }, { kind: 'playlist', id: 'a', token: 'invalid' }]) {
      expect(isUserData({ ...data, queue: { ...data.queue, entries: [{ ...data.queue.entries[0], source }, data.queue.entries[1]] } })).toBe(false);
    }
  });
  it('accepts old documents and validates optional folder folding against existing unique IDs', () => {
    const data = sampleData();
    expect(isUserData(data)).toBe(true);
    const organization = { ...data.organization, folders: [{ id: 'folder', name: '目录', libraryId: 'music', parentId: null }], collapsedFolders: ['folder'] };
    expect(isUserData({ ...data, organization })).toBe(true);
    for (const collapsedFolders of [['missing'], ['folder', 'folder'], ['https://example.test/private'], 'folder']) {
      expect(isUserData({ ...data, organization: { ...organization, collapsedFolders } })).toBe(false);
    }
  });
  it('accepts legacy profiles and persists validated artist pictures in the account document', () => {
    const data = sampleData();
    expect(isUserData(data)).toBe(true);
    const withArt = { ...data, profile: { ...data.profile, artistCovers: { 'artist-one': 'data:image/jpeg;base64,AA==' } } };
    expect(isUserData(withArt)).toBe(true);
    const store = new UserStore(':memory:'); cleanups.push(() => store.close());
    store.write('alice', 0, withArt);
    expect(store.read('alice').data?.profile.artistCovers).toEqual(withArt.profile.artistCovers);
    expect(store.read('bob').data).toBeNull();
    expect(isUserData({ ...withArt, profile: { ...data.profile, artistCovers: { 'artist-one': 'https://example.test/image' } } })).toBe(false);
    expect(isUserData({ ...withArt, profile: { ...data.profile, artistCovers: { 'https://example.test/private?key=value': 'data:image/jpeg;base64,AA==' } } })).toBe(false);
  });

  it('creates a consistent native online backup while WAL data is live and restores it without credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tooku-backup-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const store = new UserStore(join(dir, 'tooku.sqlite')); cleanups.push(() => store.close());
    store.write('alice', 0, sampleData());
    const target = join(dir, 'backup.sqlite');
    const result = spawnSync(process.execPath, ['server/backup.ts', target], { cwd: process.cwd(), env: { ...process.env, TOOKU_DATA_DIR: dir }, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const restored = new UserStore(target); cleanups.push(() => restored.close());
    expect(restored.read('alice').data).toEqual(sampleData());
    expect(spawnSync(process.execPath, ['server/backup.ts', target], { env: { ...process.env, TOOKU_DATA_DIR: dir } }).status).toBe(1);
  });
  it('persists after restart, isolates accounts, retains duplicate tracks and compares revisions atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tooku-store-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const filename = join(dir, 'data.sqlite'); let store = new UserStore(filename); const data = sampleData();
    data.organization.folders = [{ id: 'folder', name: '目录', libraryId: 'music', parentId: null }]; data.organization.collapsedFolders = ['folder'];
    expect(store.write('alice', 0, data).revision).toBe(1);
    expect(() => store.write('alice', 0, data)).toThrow(DataError);
    expect(store.read('bob').data).toBeNull(); store.close(); store = new UserStore(filename); cleanups.push(() => store.close());
    expect(store.read('alice').data).toEqual(data);
    for (let revision = 1; revision < 5; revision++) store.write('alice', revision, { ...data, preferences: { ...data.preferences, lyricDelay: revision } });
    expect(store.previous('alice').map((d) => d.revision)).toEqual([4, 3]);
    store.write('alice', 5, data); expect(store.read('alice').data?.queue?.entries).toHaveLength(2);
  });
  it('rejects credentials, authenticated URLs, invalid images, cyclic or cross-library folders and oversized data', () => {
    const store = new UserStore(':memory:'); cleanups.push(() => store.close()); const data = sampleData();
    expect(isUserData({ ...data, credentials: { u: 'not-stored' } })).toBe(false);
    expect(isUserData({ ...data, profile: { avatar: 'https://example.test/private', playlistCovers: {} } })).toBe(false);
    expect(isUserData({ ...data, queue: { ...data.queue, entries: [{ entryId: 'a', track: { id: 'one', title: 'one', artist: 'one', coverArt: 'https://example.test/media?private=value' } }] } })).toBe(false);
    const folders = [{ id: 'a', name: 'A', libraryId: 'one', parentId: 'b' }, { id: 'b', name: 'B', libraryId: 'one', parentId: 'a' }];
    expect(isUserData({ ...data, organization: { ...data.organization, folders } })).toBe(false);
    expect(isUserData({ ...data, organization: { ...data.organization, folders: [{ ...folders[0], parentId: null }, { ...folders[1], libraryId: 'two' }] } })).toBe(false);
    const image = 'data:image/png;base64,' + 'A'.repeat(1900000);
    const large = { ...data, profile: { playlistCovers: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i), image])) } };
    expect(() => store.write('alice', 0, large)).toThrow('12 MB'); expect(store.read('alice').revision).toBe(0);
  });
});
describe('authenticated Tooku API', () => {
  async function fixture(verify = vi.fn(async ({ u }: { u: string }) => u.toLowerCase()), clock = Date.now) {
    const api = createUserApi({ filename: ':memory:', verify, now: clock }); cleanups.push(() => api.close());
    const origin = await listening(createServer((req, res) => { void api.handle(req, res, () => { res.statusCode = 404; res.end(); }); }));
    const call = (path: string, method = 'GET', data?: unknown, token?: string, extra: Record<string, string> = {}) => fetch(`${origin}/api/tooku/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
    const login = async (u: string) => {
      const response = await call('session', 'POST', { u, t: randomBytes(16).toString('hex'), s: randomBytes(16).toString('hex') });
      return await response.json() as { token: string; owner: string };
    };
    return { call, login, verify };
  }
  it('requires verification, ignores claimed owners and isolates sessions; backups restore through revision checks', async () => {
    const { call, login, verify } = await fixture();
    expect((await call('data')).status).toBe(401);
    const alice = await login('Alice'); const second = await login('alice'); const bob = await login('bob');
    expect(verify).toHaveBeenCalledTimes(3); expect(alice.owner).toBe(second.owner);
    expect((await call('data', 'PUT', { revision: 0, data: sampleData(), owner: bob.owner }, alice.token)).status).toBe(200);
    expect((await (await call('data', 'GET', undefined, bob.token)).json()).data).toBeNull();
    const backup = await (await call('backup', 'GET', undefined, second.token)).json();
    expect(backup.owner).toBe(alice.owner); expect(backup.data).toEqual(sampleData()); expect(JSON.stringify(backup)).not.toContain(alice.token);
    expect((await call('data', 'PUT', { revision: 0, data: backup.data }, second.token)).status).toBe(409);
    expect((await call('data', 'PUT', { revision: 1, data: backup.data }, second.token)).status).toBe(200);
    expect((await (await call('revisions', 'GET', undefined, second.token)).json())).toHaveLength(1);
    await call('session', 'DELETE', undefined, alice.token); expect((await call('data', 'GET', undefined, alice.token)).status).toBe(401);
  });
  it('rejects foreign origins, expires sessions and rate limits authentication attempts', async () => {
    let time = Date.now(); const { call, login } = await fixture(undefined, () => time);
    expect((await call('session', 'POST', {}, undefined, { Origin: 'https://foreign.test' })).status).toBe(403);
    const session = await login('alice'); time += 12 * 3600000 + 1;
    expect((await call('data', 'GET', undefined, session.token)).status).toBe(401);
    for (let i = 0; i < 15; i++) await call('session', 'POST', {});
    expect((await call('session', 'POST', {})).status).toBe(429);
  });
  it('returns 413 for oversized request bodies without storing a partial document', async () => {
    const { call, login } = await fixture(); const session = await login('alice');
    expect((await call('data', 'PUT', { revision: 0, data: 'x'.repeat(13 * 1024 * 1024) }, session.token)).status).toBe(413);
    expect((await (await call('data', 'GET', undefined, session.token)).json()).revision).toBe(0);
  });
  it('verifies against only the fixed upstream using a POST body and rejects business-level auth failures', async () => {
    let rejected = false;
    const upstream = await listening(createServer(async (req, res) => {
      expect(req.url).toBe('/music/rest/getUser.view'); expect(req.method).toBe('POST');
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      const args = new URLSearchParams(Buffer.concat(chunks).toString()); expect(args.get('username')).toBe(args.get('u'));
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ 'subsonic-response': rejected ? { status: 'failed', error: { code: 40 } } : { status: 'ok', user: { username: 'canonical' } } }));
    }));
    const api = createUserApi({ filename: ':memory:', upstream: `${upstream}/music` }); cleanups.push(() => api.close());
    const origin = await listening(createServer((req, res) => { void api.handle(req, res, () => res.end()); }));
    const request = () => fetch(`${origin}/api/tooku/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ u: 'user', t: randomBytes(16).toString('hex'), s: randomBytes(16).toString('hex'), upstream: 'https://untrusted.test' }) });
    expect((await request()).status).toBe(200); rejected = true; expect((await request()).status).toBe(401);
  });
});
