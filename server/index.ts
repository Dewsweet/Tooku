import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserApi, upstreamUrl } from './api.ts';
import { createNavidromeProxy } from './navidromeProxy.ts';
import { createLyricsApi } from './lyrics/http.ts';
import { createRecommendationsApi } from './recommendations/http.ts';

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const upstream = upstreamUrl(process.env.NAVIDROME_UPSTREAM || 'http://127.0.0.1:44533');
const api = createUserApi({ upstream });
const lyrics = createLyricsApi();
const recommendations = createRecommendationsApi(undefined, api.recommendationCredentials);
const proxy = createNavidromeProxy(upstream, api);
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url?.split('?')[0] === '/__tooku/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ app: 'tooku', version: '0.1.0', persistence: 1 })); return; }
  if (req.url?.startsWith('/api/tooku/')) { await api.handle(req, res, () => { res.statusCode = 404; res.end(); }); return; }
  if (req.url?.startsWith('/api/lyrics/')) { await lyrics.handle(req, res, () => { res.statusCode = 404; res.end(); }); return; }
  if (req.url?.startsWith('/api/recommendations/')) { await recommendations.handle(req, res, () => { res.statusCode = 404; res.end(); }); return; }
  if (req.url?.startsWith('/api/navidrome/') || req.url?.startsWith('/nd/')) { await proxy(req, res, () => { res.writeHead(404); res.end(); }); return; }
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
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { recommendations.close(); server.close(() => { api.close(); lyrics.close(); process.exit(0); }); server.closeIdleConnections(); });
