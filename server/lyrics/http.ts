import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDescriptor, isProvider, opaqueId, record, type ProviderId } from '../../src/domain/lyrics/types.ts';
import { createLyricsService, type LyricsService } from './service.ts';
import { LyricsError } from './providers.ts';
import { sameOriginRequest } from '../security.ts';

export function createLyricsApi(service: LyricsService = createLyricsService()) {
  const attempts = new Map<string, { until: number; count: number }>();
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = req.url?.split('?')[0] ?? ''; if (!path.startsWith('/api/lyrics/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, data: unknown) => { if (!res.destroyed) { res.statusCode = status; res.end(JSON.stringify(data)); } };
    try {
      if (!sameOriginRequest(req)) { send(403, { error: '仅允许同源访问' }); return; }
      if (['/api/lyrics/health', '/api/lyrics/status'].includes(path) && req.method === 'GET') { send(200, service.status()); return; }
      if (!['/api/lyrics/search', '/api/lyrics/fetch', '/api/lyrics/check'].includes(path) || req.method !== 'POST') { send(404, { error: '接口不存在' }); return; }
      if (!service.status().enabled) throw new LyricsError('disabled');
      const time = Date.now(); const ip = req.socket.remoteAddress ?? '';
      for (const [key, value] of attempts) if (value.until < time) attempts.delete(key);
      const rate = attempts.get(ip) ?? { until: time + 60000, count: 0 }; attempts.set(ip, rate);
      if (++rate.count > 60 || attempts.size > 10000) throw new LyricsError('rate-limited');
      if (!req.headers['content-type']?.startsWith('application/json')) { send(415, { error: '请求需要 JSON' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const part of req) { size += part.length; if (size <= 8192) chunks.push(part); else chunks.length = 0; }
      if (size > 8192) { send(413, { error: '请求过大' }); return; }
      let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(400, { error: 'JSON 无效' }); return; }
      if (!record(body) || body.refresh !== undefined && typeof body.refresh !== 'boolean') { send(400, { error: '参数无效' }); return; }
      const ids: ProviderId[] = Array.isArray(body.providers) && body.providers.length > 0 && body.providers.length <= 2 && body.providers.every(isProvider) && new Set(body.providers).size === body.providers.length ? body.providers : [];
      if (path.endsWith('/check') && ids.length) { send(200, await service.check(ids)); return; }
      if (path.endsWith('/search') && ids.length && isDescriptor(body.track) && (body.keyword === undefined || typeof body.keyword === 'string' && body.keyword.trim().length > 0 && body.keyword.length <= 512)) { send(200, await service.search(body.track, ids, body.refresh === true, body.keyword)); return; }
      if (path.endsWith('/fetch') && isProvider(body.provider) && opaqueId(body.id) && /^[a-zA-Z0-9]+$/.test(body.id)) { send(200, await service.lyrics(body.provider, body.id, body.refresh === true)); return; }
      send(400, { error: '参数无效' });
    } catch (e) { const error = e instanceof LyricsError ? e : new LyricsError('unavailable'); send(error.code === 'disabled' ? 503 : error.code === 'rate-limited' ? 429 : 502, { error: error.message, code: error.code }); }
  }
  return { handle, close() { attempts.clear(); service.close(); } };
}
