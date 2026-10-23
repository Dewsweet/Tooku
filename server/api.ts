import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { UserStore, DataError } from './store.ts';
import { isUserData, maxUserDataBytes } from '../src/domain/userData.ts';
import { emptyRecommendationCredentials, type RecommendationCredentials } from '../src/domain/recommendations.ts';
import { CredentialVault, sessionLifetime } from './vault.ts';
import { requestAllowsSecureCookie, sameOriginRequest } from './security.ts';

const cookieName = 'tooku-session';
export function assertSameOrigin(req: IncomingMessage) {
  if (!sameOriginRequest(req)) throw new DataError(403, '仅允许同源访问。');
}
export function sessionCookie(req: IncomingMessage) {
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
}
function setCookie(req: IncomingMessage, res: ServerResponse, token: string, seconds: number) {
  const secure = requestAllowsSecureCookie(req);
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
}

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function upstreamUrl(input: string) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid NAVIDROME_UPSTREAM');
  return url.href.replace(/\/+$/, '');
}
function normalizedClientBase(input: unknown) {
  if (typeof input !== 'string' || input.length > 2048) return;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return;
    return url.href.replace(/\/+$/, '');
  } catch { return; }
}
function loopbackHost(hostname: string) { return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname.toLowerCase()); }
function sameConfiguredServer(candidate: string, upstream: string) {
  if (candidate === upstream) return true;
  const left = new URL(candidate); const right = new URL(upstream);
  return loopbackHost(left.hostname) && loopbackHost(right.hostname) && left.protocol === right.protocol && left.port === right.port && left.pathname === right.pathname;
}
function tookuOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (origin) return normalizedClientBase(origin);
  const host = req.headers.host;
  if (!host) return;
  const secure = requestAllowsSecureCookie(req);
  return normalizedClientBase(`${secure ? 'https' : 'http'}://${host}`);
}
function isManagedBase(req: IncomingMessage, input: unknown, upstream: string) {
  const candidate = normalizedClientBase(input); if (!candidate) return false;
  if (sameConfiguredServer(candidate, upstream)) return true;
  const origin = tookuOrigin(req);
  return Boolean(origin && [origin, `${origin}/nd`, `${origin}/api/navidrome`].includes(candidate));
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
export function createUserApi(options: { upstream?: string; filename?: string; securityFilename?: string; keyFile?: string; verify?: (auth: { u: string; t: string; s: string }) => Promise<string>; now?: () => number } = {}) {
  const upstream = upstreamUrl(options.upstream ?? process.env.NAVIDROME_UPSTREAM ?? 'http://127.0.0.1:44533');
  const filename = options.filename ?? resolve(process.env.TOOKU_DATA_DIR || '.local/data', 'tooku.sqlite');
  const vault = new CredentialVault(options.securityFilename ?? (filename === ':memory:' ? ':memory:' : resolve(dirname(filename), 'tooku-security.sqlite')), options.keyFile ?? process.env.TOOKU_SECRET_KEY_FILE);
  const store = new UserStore(filename);
  const now = options.now ?? Date.now;
  const sessions = new Map<string, { owner: string; expires: number }>();
  const attempts = new Map<string, { count: number; reset: number }>();
  const sweep = setInterval(() => {
    vault.sweep(now());
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
  const ownerFor = (username: string) => createHash('sha256').update(JSON.stringify([upstream, username])).digest('hex');
  async function authenticate(req: IncomingMessage, force = false) {
    assertSameOrigin(req);
    const token = sessionCookie(req);
    const session = vault.session(token, now());
    if (!session) return;
    if (session.upstream !== upstream) { vault.deleteSession(token); return; }
    if (req.headers['x-tooku-owner'] && req.headers['x-tooku-owner'] !== session.owner || req.headers['x-tooku-user'] && req.headers['x-tooku-user'] !== session.auth.u) throw new DataError(401, '浏览器登录账号已变化，请重新登录。');
    if (force || now() - session.verifiedAt > 15 * 60000) {
      try {
        if (ownerFor(await verify(session.auth)) !== session.owner) throw new DataError(401, '账号已变化，请重新登录。');
        session.verifiedAt = now(); vault.updateSession(token, session);
      } catch (error) { if (error instanceof DataError && error.status === 401) vault.deleteSession(token); throw error; }
    }
    return { ...session, token };
  }
  const credentialStatus = (value: ReturnType<CredentialVault['credentials']>) => ({ revision: value.revision, saved: Object.fromEntries(Object.entries(value.credentials).map(([field, secret]) => [field, Boolean(secret)])) });
  async function recommendationCredentials(req: IncomingMessage) {
    const session = await authenticate(req);
    if (!session) throw new DataError(401, '登录已过期，请重新登录。');
    return vault.credentials(session.owner).credentials;
  }
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/tooku/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status: number, data: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
    try {
      // No CORS. Compare host (including port) without trusting forwarded headers.
      assertSameOrigin(req);
      if (path === '/api/tooku/health' && req.method === 'GET') { send(200, { app: 'tooku', persistence: 1 }); return; }
      if (path === '/api/tooku/connection' && req.method === 'POST') {
        const data = await body(req);
        send(200, { managed: isManagedBase(req, data.server, upstream) }); return;
      }
      if (path === '/api/tooku/session' && req.method === 'POST') {
        const ip = req.socket.remoteAddress ?? '';
        let rate = attempts.get(ip); if (!rate || rate.reset <= now()) { rate = { count: 0, reset: now() + 60000 }; attempts.set(ip, rate); }
        if (++rate.count > 15 || sessions.size >= 10000 || attempts.size > 10000) throw new DataError(429, '请求过于频繁，请稍后重试。');
        const data = await body(req);
        if (typeof data.u !== 'string' || !data.u || data.u.length > 256 || typeof data.t !== 'string' || !/^[a-f0-9]{32}$/i.test(data.t) || typeof data.s !== 'string' || !/^[a-f0-9]{16,128}$/i.test(data.s)) throw new DataError(400, '认证参数无效。');
        const username = await verify({ u: data.u, t: data.t, s: data.s });
        const owner = ownerFor(username);
        if (data.persistent === true) {
          const clientBase = normalizedClientBase(data.clientBase);
          if (clientBase && !isManagedBase(req, clientBase, upstream)) throw new DataError(400, '服务地址与 Tooku 配置不一致。');
          const old = sessionCookie(req); const expires = now() + sessionLifetime;
          const token = vault.createSession({ owner, upstream, auth: { u: data.u, t: data.t, s: data.s }, nativeToken: typeof data.nativeToken === 'string' && data.nativeToken.length <= 8192 ? data.nativeToken : '', admin: data.admin === true, expires, verifiedAt: now(), clientBase }, old);
          setCookie(req, res, token, sessionLifetime / 1000);
          send(200, { owner, username: data.u, admin: data.admin === true, persistent: true, clientBase }); return;
        }
        const token = randomBytes(32).toString('base64url'); const expires = now() + 12 * 3600000;
        sessions.set(token, { owner, expires }); send(200, { token, owner, expires }); return;
      }
      const cookieSession = await authenticate(req, path === '/api/tooku/session' && req.method === 'GET');
      if (path === '/api/tooku/session' && req.method === 'GET') {
        if (!cookieSession) throw new DataError(401, '登录已过期，请重新登录。');
        send(200, { owner: cookieSession.owner, username: cookieSession.auth.u, admin: cookieSession.admin, persistent: true, clientBase: cookieSession.clientBase }); return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''; const session = cookieSession ?? sessions.get(token);
      if (!session || session.expires <= now()) { sessions.delete(token); throw new DataError(401, 'Tooku 会话已失效，请重新连接同步。'); }
      if (path === '/api/tooku/session' && req.method === 'DELETE') { sessions.delete(token); if (cookieSession) vault.deleteSession(cookieSession.token); setCookie(req, res, '', 0); send(200, { ok: true }); return; }
      if (path === '/api/tooku/credentials') {
        if (req.method === 'GET') { send(200, credentialStatus(vault.credentials(session.owner))); return; }
        if (req.method === 'PUT') {
          const data = await body(req); const patch = object(data.credentials);
          if (typeof data.revision !== 'number' || Object.keys(patch).some((key) => !Object.hasOwn(emptyRecommendationCredentials, key) || typeof patch[key] !== 'string')) throw new DataError(400, '密钥格式无效。');
          const credentials: Partial<RecommendationCredentials> = {};
          for (const field of Object.keys(emptyRecommendationCredentials) as (keyof RecommendationCredentials)[]) if (typeof patch[field] === 'string') credentials[field] = patch[field];
          send(200, credentialStatus(vault.saveCredentials(session.owner, data.revision, credentials))); return;
        }
      }
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
  return { handle, authenticate, recommendationCredentials,
    refreshNativeToken(token: string, value: string) { const session = vault.session(token, now()); if (session) { session.nativeToken = value; vault.updateSession(token, session); } },
    close() { clearInterval(sweep); sessions.clear(); store.close(); vault.close(); } };
}
