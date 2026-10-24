import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';
import type { createUserApi } from './api.ts';
import { DataError } from './store.ts';
import { requestResolvedTarget } from './navidromeTarget.ts';

const hopByHopHeaders = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
];

function connectionHeaders(value: string | string[] | undefined) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function proxyRequestHeaders(req: IncomingMessage, host: string, preserveNativeAuth: boolean) {
  const headers: OutgoingHttpHeaders = { ...req.headers, host };
  const remove = [
    ...hopByHopHeaders,
    ...connectionHeaders(req.headers.connection),
    'authorization', 'cookie', 'forwarded', 'x-forwarded-for', 'x-forwarded-host',
    'x-forwarded-port', 'x-forwarded-proto', 'x-real-ip', 'x-tooku-owner', 'x-tooku-user', 'x-tooku-connection',
  ];
  if (!preserveNativeAuth) remove.push('x-nd-authorization');
  for (const name of remove) delete headers[name];
  return headers;
}

export function proxyResponseHeaders(headers: IncomingMessage['headers']) {
  const result: OutgoingHttpHeaders = { ...headers };
  const remove = [...hopByHopHeaders, ...connectionHeaders(headers.connection), 'set-cookie', 'server', 'x-powered-by'];
  for (const name of remove) delete result[name];
  return result;
}

function uploadPolicy(req: IncomingMessage, relative: string) {
  if (req.method === 'POST' && relative === '/auth/login') {
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return { status: 415 };
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > 65536) return { status: 413 };
    return { limit: 65536 };
  }
  if (req.method === 'POST' && /^\/api\/artist\/[a-zA-Z0-9_-]+\/image$/.test(relative)) {
    const limit = 2 * 1024 * 1024 + 65536;
    if (!/^multipart\/form-data\s*;.*\bboundary=/i.test(req.headers['content-type'] ?? '')) return { status: 415 };
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > limit) return { status: 413 };
    return { limit };
  }
  return {};
}

// Keep the native API proxy limited to the operations used for artist artwork.
export function isNavidromeProxyRequest(url: string, method = 'GET') {
  const path = url.split('?')[0];
  if (/%|\\|(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return false;
  const relative = path.startsWith('/api/navidrome/') ? path.slice('/api/navidrome'.length) : path.startsWith('/nd/') ? path.slice('/nd'.length) : '';
  if (/^\/rest\/(?:stream|download)(?:\.(?:view|json|xml))?$/i.test(relative)) return false;
  if (relative.startsWith('/rest/')) return true;
  if (relative === '/auth/login') return method === 'POST';
  if (/^\/api\/artist\/[a-zA-Z0-9_-]+$/.test(relative)) return method === 'GET';
  return /^\/api\/artist\/[a-zA-Z0-9_-]+\/image$/.test(relative) && ['POST', 'DELETE'].includes(method);
}

export function createNavidromeProxy(upstream: string, users: ReturnType<typeof createUserApi>) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const requestUrl = req.url ?? '';
    const prefix = requestUrl.startsWith('/api/navidrome/') ? '/api/navidrome' : requestUrl.startsWith('/nd/') ? '/nd' : '';
    if (!prefix) { next(); return; }
    if (!isNavidromeProxyRequest(requestUrl, req.method)) { res.writeHead(404); res.end(); return; }
    try {
      const relative = requestUrl.slice(prefix.length);
      const policy = uploadPolicy(req, relative.split('?')[0]);
      if (policy.status) { res.writeHead(policy.status); res.end(); return; }
      // This public marker opts into the Cookie session. Login and anonymous probes must not inherit an older account.
      const requested = new URL(relative, 'http://tooku.invalid');
      const needsSession = requested.searchParams.has('tookuSession');
      const session = needsSession ? await users.authenticate(req) : undefined;
      if (needsSession && !session) { res.writeHead(401); res.end(); return; }
      if (session && requested.searchParams.has('tookuUser') && requested.searchParams.get('tookuUser') !== session.auth.u) { res.writeHead(401); res.end(); return; }
      if (session && requested.searchParams.has('tookuOwner') && requested.searchParams.get('tookuOwner') !== session.owner) { res.writeHead(401); res.end(); return; }
      const pendingTarget = session ? undefined : users.connectionTarget(req);
      if (req.headers['x-tooku-connection'] && !pendingTarget) { res.writeHead(401); res.end(); return; }
      if (pendingTarget && !['/rest/ping.view', '/rest/getOpenSubsonicExtensions.view', '/auth/login'].includes(requested.pathname)) { res.writeHead(403); res.end(); return; }
      const checked = await users.resolveUpstream(session?.upstream ?? pendingTarget ?? upstream);
      const target = new URL(`${checked.base}${relative}`);
      target.searchParams.delete('tookuSession');
      target.searchParams.delete('tookuUser');
      target.searchParams.delete('tookuOwner');
      const nativeRequest = relative.startsWith('/api/');
      const headers = proxyRequestHeaders(req, target.host, nativeRequest && !session);
      if (session && relative.startsWith('/rest/')) {
        for (const [key, value] of Object.entries(session.auth)) target.searchParams.set(key, value);
      }
      if (session && relative.startsWith('/api/')) {
        headers['x-nd-authorization'] = `Bearer ${session.nativeToken}`;
      }
      const upstreamRequest = requestResolvedTarget(checked, target, { method: req.method, headers }, (reply) => {
        const replyHeaders = proxyResponseHeaders(reply.headers);
        const refreshed = reply.headers['x-nd-authorization'];
        if (session && typeof refreshed === 'string' && refreshed.length <= 8192) users.refreshNativeToken(session.token, refreshed.replace(/^Bearer\s+/i, ''));
        if (session) delete replyHeaders['x-nd-authorization'];
        res.writeHead(reply.statusCode ?? 502, replyHeaders); reply.pipe(res);
        reply.on('error', () => res.destroy());
      });
      upstreamRequest.setTimeout(300000, () => upstreamRequest.destroy());
      upstreamRequest.on('error', () => { if (res.writableEnded || res.destroyed) return; if (!res.headersSent) res.writeHead(502); res.end(); });
      const bodyLimit = policy.limit;
      if (bodyLimit) {
        let received = 0;
        req.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received <= bodyLimit) return;
          req.unpipe(upstreamRequest); upstreamRequest.destroy(); req.resume();
          if (!res.headersSent) res.writeHead(413); res.end();
        });
      }
      res.on('close', () => upstreamRequest.destroy()); req.pipe(upstreamRequest);
    } catch (error) { if (!res.writableEnded && !res.destroyed) { if (!res.headersSent) res.writeHead(error instanceof DataError ? error.status : 502); res.end(); } }
  };
}

export function createPlaybackProxy(_upstream: string, users: ReturnType<typeof createUserApi>) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/tooku-stream/')) { next(); return; }
    const token = path.slice('/api/tooku-stream/'.length);
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const range = req.headers.range;
    if (range !== undefined && (typeof range !== 'string' || range.length > 128 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))) { res.writeHead(416); res.end(); return; }
    let access: Awaited<ReturnType<typeof users.authorizePlayback>> | undefined;
    try {
      access = await users.authorizePlayback(req, token);
      const checked = await users.resolveUpstream(access.upstream);
      const target = new URL(`${checked.base}/rest/stream.view`);
      for (const [key, value] of Object.entries({ ...access.auth, id: access.id, v: '1.16.1', c: 'Tooku', ...(access.mode === 'compatible' ? { format: 'mp3', maxBitRate: '320' } : {}) })) target.searchParams.set(key, value);
      const headers = proxyRequestHeaders(req, target.host, false);
      const upstreamRequest = requestResolvedTarget(checked, target, { method: req.method, headers }, (reply) => {
        const replyHeaders = proxyResponseHeaders(reply.headers);
        delete replyHeaders.location; delete replyHeaders['content-location']; delete replyHeaders['content-disposition'];
        // Keep the grant opaque to extensions that classify responses solely by media MIME.
        // Preserve the upstream bytes and Range framing while masking its media type.
        replyHeaders['content-type'] = 'application/octet-stream';
        replyHeaders['cache-control'] = 'private, no-store';
        replyHeaders['content-disposition'] = 'inline';
        replyHeaders['cross-origin-resource-policy'] = 'same-origin';
        replyHeaders['referrer-policy'] = 'no-referrer';
        replyHeaders['x-content-type-options'] = 'nosniff';
        if ((reply.statusCode ?? 502) >= 300 && (reply.statusCode ?? 502) < 400) {
          delete replyHeaders['content-length']; delete replyHeaders['content-range'];
          reply.resume(); res.writeHead(502, replyHeaders); res.end(); return;
        }
        res.writeHead(reply.statusCode ?? 502, replyHeaders);
        if (req.method === 'HEAD') { reply.resume(); res.end(); }
        else reply.pipe(res);
        reply.on('error', () => res.destroy());
      });
      const finish = () => access?.release();
      access.bindAbort(() => upstreamRequest.destroy());
      upstreamRequest.setTimeout(300000, () => upstreamRequest.destroy());
      upstreamRequest.on('error', () => { if (!res.writableEnded && !res.destroyed) { if (!res.headersSent) res.writeHead(502); res.end(); } });
      upstreamRequest.once('close', finish);
      res.on('close', () => upstreamRequest.destroy());
      upstreamRequest.end();
    } catch (error) {
      access?.release();
      if (!res.writableEnded && !res.destroyed) { if (!res.headersSent) res.writeHead(error instanceof DataError ? error.status : 502); res.end(); }
    }
  };
}
