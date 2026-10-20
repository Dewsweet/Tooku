import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { UserStore, DataError } from './store.ts';
import { isUserData, maxUserDataBytes } from '../src/domain/userData.ts';

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function upstreamUrl(input: string) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid NAVIDROME_UPSTREAM');
  return url.href.replace(/\/+$/, '');
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new DataError(415, '请求需要 JSON。');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= maxUserDataBytes + 4096) chunks.push(chunk); else chunks.length = 0;
  }
  // Drain oversized requests without retaining their payload or destroying the response socket.
  if (size > maxUserDataBytes + 4096) throw new DataError(413, '上传数据过大。');
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { throw new DataError(400, 'JSON 格式无效。'); }
}
export function createUserApi(options: { upstream?: string; filename?: string; verify?: (auth: { u: string; t: string; s: string }) => Promise<string>; now?: () => number } = {}) {
  const upstream = upstreamUrl(options.upstream ?? process.env.NAVIDROME_UPSTREAM ?? 'http://127.0.0.1:44533');
  const store = new UserStore(options.filename ?? resolve(process.env.TOOKU_DATA_DIR || '.local/data', 'tooku.sqlite'));
  const now = options.now ?? Date.now;
  const sessions = new Map<string, { owner: string; expires: number }>();
  const attempts = new Map<string, { count: number; reset: number }>();
  const sweep = setInterval(() => {
    for (const [key, s] of sessions) if (s.expires <= now()) sessions.delete(key);
    for (const [key, a] of attempts) if (a.reset <= now()) attempts.delete(key);
  }, 60000); sweep.unref();
  async function verify(auth: { u: string; t: string; s: string }): Promise<string> {
    if (options.verify) return options.verify(auth);
    // Fixed configured upstream only. Form bodies keep credentials out of URLs/logs.
    const response = await fetch(`${upstream}/rest/getUser.view`, {
      method: 'POST', body: new URLSearchParams({ ...auth, username: auth.u, v: '1.16.1', c: 'Tooku', f: 'json' }),
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new DataError(502, '无法验证音乐服务账号。');
    const result = object(object(await response.json())['subsonic-response']);
    if (result.status !== 'ok') throw new DataError(401, '音乐服务认证未通过，请重新登录。');
    const username = object(result.user).username;
    if (typeof username !== 'string' || !username || username.length > 256) throw new DataError(502, '音乐服务未返回有效账号。');
    return username;
  }
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/tooku/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status: number, data: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
    try {
      // No CORS. Compare host (including port) without trusting forwarded headers.
      const origin = req.headers.origin;
      if (req.headers['sec-fetch-site'] === 'cross-site' || origin && new URL(origin).host !== req.headers.host) throw new DataError(403, '仅允许同源访问。');
      if (path === '/api/tooku/health' && req.method === 'GET') { send(200, { app: 'tooku', persistence: 1 }); return; }
      if (path === '/api/tooku/session' && req.method === 'POST') {
        const ip = req.socket.remoteAddress ?? '';
        let rate = attempts.get(ip); if (!rate || rate.reset <= now()) { rate = { count: 0, reset: now() + 60000 }; attempts.set(ip, rate); }
        if (++rate.count > 15 || sessions.size >= 10000 || attempts.size > 10000) throw new DataError(429, '请求过于频繁，请稍后重试。');
        const data = await body(req);
        if (typeof data.u !== 'string' || !data.u || data.u.length > 256 || typeof data.t !== 'string' || !/^[a-f0-9]{32}$/i.test(data.t) || typeof data.s !== 'string' || !/^[a-f0-9]{16,128}$/i.test(data.s)) throw new DataError(400, '认证参数无效。');
        const username = await verify({ u: data.u, t: data.t, s: data.s });
        const owner = createHash('sha256').update(JSON.stringify([upstream, username])).digest('hex');
        const token = randomBytes(32).toString('base64url'); const expires = now() + 12 * 3600000;
        sessions.set(token, { owner, expires }); send(200, { token, owner, expires }); return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''; const session = sessions.get(token);
      if (!session || session.expires <= now()) { sessions.delete(token); throw new DataError(401, 'Tooku 会话已失效，请重新连接同步。'); }
      if (path === '/api/tooku/session' && req.method === 'DELETE') { sessions.delete(token); send(200, { ok: true }); return; }
      if (path === '/api/tooku/data' && req.method === 'GET') { send(200, store.read(session.owner)); return; }
      if (path === '/api/tooku/data' && req.method === 'PUT') {
        const data = await body(req);
        // Validation lives in the store, including JSON schema, limits and atomic compare-and-swap.
        if (typeof data.revision !== 'number') throw new DataError(400, '缺少版本。');
        if (!isUserData(data.data)) throw new DataError(400, '数据格式或版本无效。');
        send(200, store.write(session.owner, data.revision, data.data)); return;
      }
      if (path === '/api/tooku/revisions' && req.method === 'GET') { send(200, store.previous(session.owner)); return; }
      if (path === '/api/tooku/backup' && req.method === 'GET') {
        const current = store.read(session.owner); if (!current.data) throw new DataError(404, '尚无服务器数据。');
        send(200, { format: 'tooku-user-data', version: 1, owner: session.owner, exportedAt: now(), data: current.data }); return;
      }
      throw new DataError(404, '接口不存在。');
    } catch (error) {
      // Never echo upstream URLs, credentials, payloads or exception messages from dependencies.
      send(error instanceof DataError ? error.status : 503, { error: error instanceof DataError ? error.message : '服务暂不可用；本地数据仍保留，请稍后重试。' });
    }
  }
  return { handle, close() { clearInterval(sweep); sessions.clear(); store.close(); } };
}
