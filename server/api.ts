import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { UserStore, DataError } from './store.ts';
import { isUserData, maxUserDataBytes } from '../src/domain/userData.ts';
import { emptyRecommendationCredentials, type RecommendationCredentials } from '../src/domain/recommendations.ts';
import { CredentialVault, sessionLifetime } from './vault.ts';
import { requestAllowsSecureCookie, sameOriginRequest } from './security.ts';
import { normalizeNavidromeTarget, requestResolvedTarget, resolveNavidromeTarget, type ResolvedNavidromeTarget } from './navidromeTarget.ts';
import { tookuServiceProtocol } from '../src/domain/serviceProtocol.ts';

const cookieName = 'tooku-session';
export const playbackGrantLifetime = 4 * 60 * 60 * 1000;
const playbackGrantRequestLimit = 64;
interface PlaybackGrant {
  owner: string;
  session: string;
  id: string;
  mode: 'original' | 'compatible';
  expiresAt: number;
  requests: number;
  active: number;
  aborters: Set<() => void>;
}
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
export function upstreamUrl(input: string) { try { return normalizeNavidromeTarget(input); } catch { throw new Error('Invalid NAVIDROME_UPSTREAM'); } }
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
async function body(req: IncomingMessage, limit = maxUserDataBytes + 4096): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new DataError(415, '请求需要 JSON。');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk); else chunks.length = 0;
  }
  // Drain oversized requests without retaining their payload or destroying the response socket.
  if (size > limit) throw new DataError(413, '上传数据过大。');
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { throw new DataError(400, 'JSON 格式无效。'); }
}
export function createUserApi(options: { upstream?: string; filename?: string; securityFilename?: string; keyFile?: string; verify?: (auth: { u: string; t: string; s: string }, upstream: string) => Promise<string>; resolveTarget?: (upstream: string, allowPrivate: boolean) => Promise<ResolvedNavidromeTarget>; allowPrivateServers?: boolean; now?: () => number } = {}) {
  const upstream = upstreamUrl(options.upstream ?? process.env.NAVIDROME_UPSTREAM ?? 'http://127.0.0.1:44533');
  const filename = options.filename ?? resolve(process.env.TOOKU_DATA_DIR || '.local/data', 'tooku.sqlite');
  const vault = new CredentialVault(options.securityFilename ?? (filename === ':memory:' ? ':memory:' : resolve(dirname(filename), 'tooku-security.sqlite')), options.keyFile ?? process.env.TOOKU_SECRET_KEY_FILE);
  const store = new UserStore(filename);
  const now = options.now ?? Date.now;
  const sessions = new Map<string, { owner: string; expires: number }>();
  const attempts = new Map<string, { count: number; reset: number }>();
  const connectionAttempts = new Map<string, { count: number; reset: number }>();
  const connections = new Map<string, { upstream: string; expires: number }>();
  const playbackGrants = new Map<string, PlaybackGrant>();
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const revokeGrant = (key: string, grant: PlaybackGrant) => {
    playbackGrants.delete(key);
    for (const abort of grant.aborters) abort();
    grant.aborters.clear();
  };
  const revokePlaybackSession = (token: string) => {
    if (!token) return;
    const session = digest(token);
    for (const [key, grant] of playbackGrants) if (grant.session === session) revokeGrant(key, grant);
  };
  const sweep = setInterval(() => {
    vault.sweep(now());
    for (const [key, s] of sessions) if (s.expires <= now()) sessions.delete(key);
    for (const [key, a] of attempts) if (a.reset <= now()) attempts.delete(key);
    for (const [key, a] of connectionAttempts) if (a.reset <= now()) connectionAttempts.delete(key);
    for (const [key, grant] of playbackGrants) if (grant.expiresAt <= now()) revokeGrant(key, grant);
    for (const [key, connection] of connections) if (connection.expires <= now()) connections.delete(key);
  }, 60000); sweep.unref();
  const allowPrivateServers = options.allowPrivateServers ?? process.env.TOOKU_ALLOW_PRIVATE_NAVIDROME === 'true';
  const resolveTarget = options.resolveTarget ?? resolveNavidromeTarget;
  const trustedTarget = (target: string) => sameConfiguredServer(target, upstream);
  async function resolved(target: string) { return resolveTarget(target, trustedTarget(target) || allowPrivateServers); }
  async function protocolRequest(target: string, method: 'ping' | 'getUser', auth?: { u: string; t: string; s: string }) {
    const checked = await resolved(target); const url = new URL(`${checked.base}/rest/${method}.view`);
    const parameters = new URLSearchParams({ ...(auth ?? {}), ...(auth ? { username: auth.u } : {}), v: '1.16.1', c: 'Tooku', f: 'json' });
    return await new Promise<Record<string, unknown>>((resolveRequest, reject) => {
      const request = requestResolvedTarget(checked, url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(parameters.toString()) } }, (response) => {
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 1024 * 1024) chunks.push(chunk); else request.destroy(); });
        response.on('end', () => {
          if ((response.statusCode ?? 502) >= 400 || size > 1024 * 1024) { reject(new DataError(502, '无法验证音乐服务。')); return; }
          try { resolveRequest(object(object(JSON.parse(Buffer.concat(chunks).toString('utf8')))['subsonic-response'])); }
          catch { reject(new DataError(502, '未识别到 Navidrome 服务。')); }
        });
      });
      request.setTimeout(10000, () => request.destroy()); request.on('error', () => reject(new DataError(502, '无法连接音乐服务。'))); request.end(parameters.toString());
    });
  }
  async function verify(auth: { u: string; t: string; s: string }, target = upstream): Promise<string> {
    if (options.verify) return options.verify(auth, target);
    const result = await protocolRequest(target, 'getUser', auth);
    if (result.status !== 'ok') throw new DataError(401, '音乐服务认证未通过，请重新登录。');
    const username = object(result.user).username;
    if (typeof username !== 'string' || !username || username.length > 256) throw new DataError(502, '音乐服务未返回有效账号。');
    return username;
  }
  const ownerFor = (namespace: string, username: string) => createHash('sha256').update(JSON.stringify([namespace, username])).digest('hex');
  async function authenticate(req: IncomingMessage, force = false) {
    assertSameOrigin(req);
    const token = sessionCookie(req);
    const session = vault.session(token, now());
    if (!session) return;
    const server = session.serverId ? vault.server(session.serverId) : vault.ensureServer(session.upstream, now());
    if (!server || !server.aliases.includes(session.upstream)) { revokePlaybackSession(token); vault.deleteSession(token); return; }
    if (!session.serverId) { session.serverId = server.id; vault.updateSession(token, session); }
    if (req.headers['x-tooku-owner'] && req.headers['x-tooku-owner'] !== session.owner || req.headers['x-tooku-user'] && req.headers['x-tooku-user'] !== session.auth.u) throw new DataError(401, '浏览器登录账号已变化，请重新登录。');
    if (force || now() - session.verifiedAt > 15 * 60000) {
      try {
        if (ownerFor(server.namespace, await verify(session.auth, session.upstream)) !== session.owner) throw new DataError(401, '账号已变化，请重新登录。');
        session.verifiedAt = now(); vault.updateSession(token, session);
      } catch (error) { if (error instanceof DataError && error.status === 401) { revokePlaybackSession(token); vault.deleteSession(token); } throw error; }
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
      if (path === '/api/tooku/health' && req.method === 'GET') { send(200, { app: 'tooku', persistence: 1, serviceProtocol: tookuServiceProtocol }); return; }
      if (path === '/api/tooku/connection' && req.method === 'POST') {
        const ip = req.socket.remoteAddress ?? '';
        let rate = connectionAttempts.get(ip); if (!rate || rate.reset <= now()) { rate = { count: 0, reset: now() + 60000 }; connectionAttempts.set(ip, rate); }
        if (++rate.count > 30 || connectionAttempts.size > 10000) throw new DataError(429, '连接请求过于频繁，请稍后重试。');
        const data = await body(req);
        const candidate = normalizedClientBase(data.server);
        if (!candidate) throw new DataError(400, '服务器地址无效。');
        if (isManagedBase(req, candidate, upstream)) {
          if (data.purpose !== 'alias') { send(200, { managed: true }); return; }
          if (connections.size >= 10000) throw new DataError(429, '连接请求过于频繁，请稍后重试。');
          const connectionId = randomBytes(32).toString('base64url');
          connections.set(digest(connectionId), { upstream, expires: now() + 10 * 60000 });
          send(200, { managed: true, connectionId }); return;
        }
        const result = await protocolRequest(candidate, 'ping');
        const errorCode = Number(object(result.error).code);
        const authenticationRequired = result.status === 'failed' && [10, 40, 41, 42, 43, 44, 50].includes(errorCode);
        if (result.status !== 'ok' && !authenticationRequired) throw new DataError(502, '未识别到 Navidrome 服务。');
        if (connections.size >= 10000) throw new DataError(429, '连接请求过于频繁，请稍后重试。');
        const connectionId = randomBytes(32).toString('base64url');
        connections.set(digest(connectionId), { upstream: candidate, expires: now() + 10 * 60000 });
        send(200, { managed: true, connectionId }); return;
      }
      if (path === '/api/tooku/session' && req.method === 'POST') {
        const ip = req.socket.remoteAddress ?? '';
        let rate = attempts.get(ip); if (!rate || rate.reset <= now()) { rate = { count: 0, reset: now() + 60000 }; attempts.set(ip, rate); }
        if (++rate.count > 15 || sessions.size >= 10000 || attempts.size > 10000) throw new DataError(429, '请求过于频繁，请稍后重试。');
        const data = await body(req);
        if (typeof data.u !== 'string' || !data.u || data.u.length > 256 || typeof data.t !== 'string' || !/^[a-f0-9]{32}$/i.test(data.t) || typeof data.s !== 'string' || !/^[a-f0-9]{16,128}$/i.test(data.s)) throw new DataError(400, '认证参数无效。');
        const clientBase = normalizedClientBase(data.clientBase);
        let sessionUpstream = upstream;
        const connectionId = typeof data.connectionId === 'string' ? data.connectionId : '';
        if (clientBase && !isManagedBase(req, clientBase, upstream)) {
          const pending = /^[\w-]{43}$/.test(connectionId) ? connections.get(digest(connectionId)) : undefined;
          if (!pending || pending.expires <= now() || pending.upstream !== clientBase) throw new DataError(400, '服务器连接已过期，请重新检测。');
          sessionUpstream = pending.upstream;
        }
        const username = await verify({ u: data.u, t: data.t, s: data.s }, sessionUpstream);
        const server = vault.ensureServer(sessionUpstream, now());
        const owner = ownerFor(server.namespace, username);
        if (data.persistent === true) {
          const old = sessionCookie(req); revokePlaybackSession(old); const expires = now() + sessionLifetime;
          const token = vault.createSession({ owner, upstream: sessionUpstream, serverId: server.id, auth: { u: data.u, t: data.t, s: data.s }, nativeToken: typeof data.nativeToken === 'string' && data.nativeToken.length <= 8192 ? data.nativeToken : '', admin: data.admin === true, expires, verifiedAt: now(), clientBase }, old);
          if (connectionId) connections.delete(digest(connectionId));
          setCookie(req, res, token, sessionLifetime / 1000);
          send(200, { owner, username: data.u, admin: data.admin === true, persistent: true, clientBase, serviceProtocol: tookuServiceProtocol }); return;
        }
        const token = randomBytes(32).toString('base64url'); const expires = now() + 12 * 3600000;
        sessions.set(token, { owner, expires }); send(200, { token, owner, expires }); return;
      }
      const cookieSession = await authenticate(req, path === '/api/tooku/session' && req.method === 'GET');
      if (path === '/api/tooku/session' && req.method === 'GET') {
        if (!cookieSession) throw new DataError(401, '登录已过期，请重新登录。');
        send(200, { owner: cookieSession.owner, username: cookieSession.auth.u, admin: cookieSession.admin, persistent: true, clientBase: cookieSession.clientBase, serviceProtocol: tookuServiceProtocol }); return;
      }
      if (path === '/api/tooku/server' && req.method === 'GET') {
        if (!cookieSession?.serverId) throw new DataError(401, '登录已过期，请重新登录。');
        const server = vault.server(cookieSession.serverId); if (!server) throw new DataError(404, '音乐服务器记录不存在。');
        send(200, { id: server.id, address: cookieSession.upstream, primary: server.primary, aliases: server.aliases }); return;
      }
      if (path === '/api/tooku/server/aliases' && req.method === 'POST') {
        if (!cookieSession?.serverId) throw new DataError(401, '登录已过期，请重新登录。');
        const data = await body(req, 4096); const connectionId = typeof data.connectionId === 'string' ? data.connectionId : '';
        const pending = /^[\w-]{43}$/.test(connectionId) ? connections.get(digest(connectionId)) : undefined;
        if (data.confirm !== true || !pending || pending.expires <= now()) throw new DataError(400, '服务器连接已过期，请重新检测。');
        const server = vault.server(cookieSession.serverId); if (!server) throw new DataError(404, '音乐服务器记录不存在。');
        const username = await verify(cookieSession.auth, pending.upstream);
        if (ownerFor(server.namespace, username) !== cookieSession.owner) throw new DataError(409, '新地址的账号与当前服务器记录不一致。');
        const updated = vault.addServerAlias(server.id, pending.upstream, now()); connections.delete(digest(connectionId));
        send(200, { id: updated.id, address: cookieSession.upstream, primary: updated.primary, aliases: updated.aliases }); return;
      }
      if (path === '/api/tooku/server' && req.method === 'PATCH') {
        if (!cookieSession?.serverId) throw new DataError(401, '登录已过期，请重新登录。');
        const data = await body(req, 4096); const address = normalizedClientBase(data.primary);
        if (!address) throw new DataError(400, '服务器地址无效。');
        const updated = vault.setServerPrimary(cookieSession.serverId, address, now());
        send(200, { id: updated.id, address: cookieSession.upstream, primary: updated.primary, aliases: updated.aliases }); return;
      }
      if (path === '/api/tooku/server/aliases' && req.method === 'DELETE') {
        if (!cookieSession?.serverId) throw new DataError(401, '登录已过期，请重新登录。');
        const data = await body(req, 4096); const address = normalizedClientBase(data.address);
        if (data.confirm !== true || !address) throw new DataError(400, '服务器地址无效。');
        if (address === cookieSession.upstream) throw new DataError(409, '不能移除当前会话正在使用的地址。');
        const updated = vault.removeServerAlias(cookieSession.serverId, address, now());
        send(200, { id: updated.id, address: cookieSession.upstream, primary: updated.primary, aliases: updated.aliases }); return;
      }
      if (path === '/api/tooku/playback' && req.method === 'POST') {
        if (!cookieSession) throw new DataError(401, '登录已过期，请重新登录。');
        const data = await body(req, 4096);
        if (typeof data.id !== 'string' || data.id.length < 1 || data.id.length > 256 || [...data.id].some((value) => value.charCodeAt(0) <= 31 || value.charCodeAt(0) === 127) || !['original', 'compatible'].includes(String(data.mode))) throw new DataError(400, '播放参数无效。');
        revokePlaybackSession(cookieSession.token);
        for (const [key, grant] of playbackGrants) if (grant.expiresAt <= now()) revokeGrant(key, grant);
        if (playbackGrants.size >= 10000) throw new DataError(429, '播放请求过于频繁，请稍后重试。');
        const token = randomBytes(32).toString('base64url');
        const expiresAt = now() + playbackGrantLifetime;
        playbackGrants.set(digest(token), { owner: cookieSession.owner, session: digest(cookieSession.token), id: data.id, mode: data.mode as 'original' | 'compatible', expiresAt, requests: 0, active: 0, aborters: new Set() });
        send(200, { url: `/api/tooku-stream/${token}`, expiresAt }); return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''; const session = cookieSession ?? sessions.get(token);
      if (!session || session.expires <= now()) { sessions.delete(token); throw new DataError(401, 'Tooku 会话已失效，请重新连接同步。'); }
      if (path === '/api/tooku/session' && req.method === 'DELETE') { sessions.delete(token); if (cookieSession) { revokePlaybackSession(cookieSession.token); vault.deleteSession(cookieSession.token); } setCookie(req, res, '', 0); send(200, { ok: true }); return; }
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
  async function authorizePlayback(req: IncomingMessage, token: string) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new DataError(404, '播放授权不存在。');
    const key = digest(token); const grant = playbackGrants.get(key);
    if (!grant) throw new DataError(404, '播放授权不存在。');
    if (grant.expiresAt <= now()) { revokeGrant(key, grant); throw new DataError(410, '播放授权已过期。'); }
    const session = await authenticate(req);
    if (!session || session.owner !== grant.owner || digest(session.token) !== grant.session) throw new DataError(401, '播放授权与当前账号不匹配。');
    if (grant.requests >= playbackGrantRequestLimit || grant.active >= 3) throw new DataError(429, '播放请求过于频繁。');
    grant.requests++; grant.active++;
    let aborter: (() => void) | undefined; let released = false;
    return {
      id: grant.id, mode: grant.mode, expiresAt: grant.expiresAt, auth: session.auth, upstream: session.upstream,
      bindAbort(value: () => void) { aborter = value; grant.aborters.add(value); },
      release() { if (released) return; released = true; grant.active = Math.max(0, grant.active - 1); if (aborter) grant.aborters.delete(aborter); },
    };
  }
  return { handle, authenticate, authorizePlayback, recommendationCredentials,
    async resolveUpstream(target: string) { return resolved(target); },
    connectionTarget(req: IncomingMessage) {
      const token = req.headers['x-tooku-connection'];
      if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return;
      const connection = connections.get(digest(token));
      return connection && connection.expires > now() ? connection.upstream : undefined;
    },
    refreshNativeToken(token: string, value: string) { const session = vault.session(token, now()); if (session) { session.nativeToken = value; vault.updateSession(token, session); } },
    close() { clearInterval(sweep); sessions.clear(); connections.clear(); attempts.clear(); connectionAttempts.clear(); for (const [key, grant] of playbackGrants) revokeGrant(key, grant); store.close(); vault.close(); } };
}
