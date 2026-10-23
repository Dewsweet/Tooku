import { request as httpRequest, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { createUserApi } from './api.ts';
import { DataError } from './store.ts';

const hopByHopHeaders = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
];

function connectionHeaders(value: string | string[] | undefined) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function proxyRequestHeaders(req: IncomingMessage, host: string, preserveNativeAuth: boolean) {
  const headers: OutgoingHttpHeaders = { ...req.headers, host };
  const remove = [
    ...hopByHopHeaders,
    ...connectionHeaders(req.headers.connection),
    'authorization', 'cookie', 'forwarded', 'x-forwarded-for', 'x-forwarded-host',
    'x-forwarded-port', 'x-forwarded-proto', 'x-real-ip', 'x-tooku-owner', 'x-tooku-user',
  ];
  if (!preserveNativeAuth) remove.push('x-nd-authorization');
  for (const name of remove) delete headers[name];
  return headers;
}

function proxyResponseHeaders(headers: IncomingMessage['headers']) {
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
      const target = new URL(`${upstream}${relative}`);
      // This public marker opts into the Cookie session. Login and anonymous probes must not inherit an older account.
      const needsSession = target.searchParams.has('tookuSession');
      const session = needsSession ? await users.authenticate(req) : undefined;
      if (needsSession && !session) { res.writeHead(401); res.end(); return; }
      if (session && target.searchParams.has('tookuUser') && target.searchParams.get('tookuUser') !== session.auth.u) { res.writeHead(401); res.end(); return; }
      target.searchParams.delete('tookuSession');
      target.searchParams.delete('tookuUser');
      const nativeRequest = relative.startsWith('/api/');
      const headers = proxyRequestHeaders(req, target.host, nativeRequest && !session);
      if (session && relative.startsWith('/rest/')) {
        for (const [key, value] of Object.entries(session.auth)) target.searchParams.set(key, value);
      }
      if (session && relative.startsWith('/api/')) {
        headers['x-nd-authorization'] = `Bearer ${session.nativeToken}`;
      }
      const upstreamRequest = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers }, (reply) => {
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
