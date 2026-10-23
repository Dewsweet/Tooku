import { request as httpRequest, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { createUserApi } from './api.ts';
import { DataError } from './store.ts';

// Keep the native API proxy limited to the operations used for artist artwork.
export function isNavidromeProxyRequest(url: string, method = 'GET') {
  const path = url.split('?')[0];
  if (/%|\\|(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return false;
  if (path.startsWith('/nd/rest/')) return true;
  if (path === '/nd/auth/login') return method === 'POST';
  if (/^\/nd\/api\/artist\/[a-zA-Z0-9_-]+$/.test(path)) return method === 'GET';
  return /^\/nd\/api\/artist\/[a-zA-Z0-9_-]+\/image$/.test(path) && ['POST', 'DELETE'].includes(method);
}

export function createNavidromeProxy(upstream: string, users: ReturnType<typeof createUserApi>) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/nd/')) { next(); return; }
    if (!isNavidromeProxyRequest(req.url, req.method)) { res.writeHead(404); res.end(); return; }
    try {
      const session = await users.authenticate(req);
      // This flag is public and forces a session: expired cookies must not downgrade to anonymous requests.
      const target = new URL(`${upstream}${req.url.slice(3)}`);
      if (target.searchParams.has('tookuSession') && !session) { res.writeHead(401); res.end(); return; }
      if (session && target.searchParams.has('tookuUser') && target.searchParams.get('tookuUser') !== session.auth.u) { res.writeHead(401); res.end(); return; }
      target.searchParams.delete('tookuSession');
      target.searchParams.delete('tookuUser');
      const headers: OutgoingHttpHeaders = { ...req.headers, host: target.host }; delete headers.authorization; delete headers.cookie;
      if (session && req.url.startsWith('/nd/rest/')) {
        for (const [key, value] of Object.entries(session.auth)) target.searchParams.set(key, value);
      }
      if (session && req.url.startsWith('/nd/api/')) {
        headers['x-nd-authorization'] = `Bearer ${session.nativeToken}`;
      }
      const upstreamRequest = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers }, (reply) => {
        const replyHeaders = { ...reply.headers }; delete replyHeaders['set-cookie'];
        const refreshed = reply.headers['x-nd-authorization'];
        if (session && typeof refreshed === 'string' && refreshed.length <= 8192) users.refreshNativeToken(session.token, refreshed.replace(/^Bearer\s+/i, ''));
        if (session) delete replyHeaders['x-nd-authorization'];
        res.writeHead(reply.statusCode ?? 502, replyHeaders); reply.pipe(res);
        reply.on('error', () => res.destroy());
      });
      upstreamRequest.setTimeout(300000, () => upstreamRequest.destroy());
      upstreamRequest.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on('close', () => upstreamRequest.destroy()); req.pipe(upstreamRequest);
    } catch (error) { if (!res.headersSent) res.writeHead(error instanceof DataError ? error.status : 502); res.end(); }
  };
}
