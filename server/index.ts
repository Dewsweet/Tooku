import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserApi, upstreamUrl } from './api.ts';
import { isNavidromeProxyRequest } from './navidromeProxy.ts';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const upstream = upstreamUrl(process.env.NAVIDROME_UPSTREAM || 'http://127.0.0.1:44533');
const api = createUserApi({ upstream });
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url?.split('?')[0] === '/__tooku/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ app: 'tooku', version: '0.1.0', persistence: 1 })); return; }
  if (req.url?.startsWith('/api/tooku/')) { await api.handle(req, res, () => { res.statusCode = 404; res.end(); }); return; }
  if (req.url?.startsWith('/nd/') && !isNavidromeProxyRequest(req.url, req.method)) { res.writeHead(404); res.end(); return; }
  if (req.url && isNavidromeProxyRequest(req.url, req.method)) {
    const target = new URL(`${upstream}${req.url.slice(3)}`);
    const headers = { ...req.headers, host: target.host }; delete headers.authorization; delete headers.cookie;
    const upstreamRequest = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers }, (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res);
      reply.on('error', () => res.destroy());
    });
    upstreamRequest.setTimeout(300000, () => upstreamRequest.destroy());
    upstreamRequest.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => upstreamRequest.destroy()); req.pipe(upstreamRequest); return;
  }
  try {
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let filename = resolve(root, `.${pathname}`);
    if (filename !== root && !filename.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
    let exists = await stat(filename).catch(() => null);
    if (!exists?.isFile()) {
      if (pathname.startsWith('/assets/') || extname(pathname)) { res.writeHead(404); res.end(); return; }
      filename = resolve(root, 'index.html'); exists = await stat(filename);
    }
    res.setHeader('Content-Type', types[extname(filename)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', exists.size);
    res.setHeader('Cache-Control', filename.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable');
    if (req.method === 'HEAD') res.end(); else createReadStream(filename).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
server.requestTimeout = 30000; server.headersTimeout = 15000;
const port = Number(process.env.TOOKU_PORT || 18733);
server.listen(port, process.env.TOOKU_HOST || '127.0.0.1', () => console.log(`Tooku listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(() => { api.close(); process.exit(0); }); server.closeIdleConnections(); });
