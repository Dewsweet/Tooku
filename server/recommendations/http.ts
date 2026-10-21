import type { IncomingMessage, ServerResponse } from 'node:http';
import { isListeningSeed, isRecommendationCredentials, isRecommendationSettings, isRecommendationSong, recommendationRecord } from '../../src/domain/recommendations.ts';
import { createRecommendationService } from './service.ts';
import { RecommendationError } from './network.ts';

export function createRecommendationsApi(service = createRecommendationService()) {
  const rates = new Map<string, { until: number; count: number }>(); const controllers = new Set<AbortController>();
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const path = req.url?.split('?')[0] ?? ''; if (!path.startsWith('/api/recommendations/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status: number, data: unknown) => { if (!res.destroyed) { res.statusCode = status; res.end(JSON.stringify(data)); } };
    const controller = new AbortController(); const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new RecommendationError('仅允许同源访问', 403);
      if (req.method !== 'POST' || !['generate', 'links', 'check'].some((action) => path === `/api/recommendations/${action}`)) throw new RecommendationError('接口不存在', 404);
      const now = Date.now(); for (const [ip, value] of rates) if (value.until < now) rates.delete(ip);
      const ip = req.socket.remoteAddress ?? ''; const rate = rates.get(ip) ?? { until: now + 60000, count: 0 }; rates.set(ip, rate);
      if (++rate.count > 16 || rates.size > 10000 || controllers.size >= 4) throw new RecommendationError('推荐请求过于频繁，请稍后再试', 429);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new RecommendationError('请求需要 JSON', 415);
      controllers.add(controller); res.on('close', disconnect);
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size <= 98304) chunks.push(chunk); else chunks.length = 0; }
      if (size > 98304) throw new RecommendationError('请求过大', 413);
      let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RecommendationError('JSON 格式无效', 400); }
      if (!recommendationRecord(body) || !isRecommendationSettings(body.settings) || !isRecommendationCredentials(body.credentials)) throw new RecommendationError('推荐配置无效', 400);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(path.endsWith('/generate') ? 100000 : path.endsWith('/check') ? 50000 : 20000)]);
      if (path.endsWith('/generate')) {
        if (!Array.isArray(body.seeds) || !body.seeds.length || body.seeds.length > body.settings.sampleSize || !body.seeds.every(isListeningSeed)
          || !Array.isArray(body.excluded) || body.excluded.length > 10 || !body.excluded.every((id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id))) throw new RecommendationError('收听样本无效', 400);
        send(200, await service.generate(body.seeds, body.settings, body.credentials, body.excluded, signal));
      } else if (path.endsWith('/links')) {
        if (!Array.isArray(body.songs) || body.songs.length > 10 || !body.songs.every(isRecommendationSong)) throw new RecommendationError('歌曲参数无效', 400);
        send(200, await service.links(body.songs, body.settings, body.credentials, signal));
      } else if (typeof body.target === 'string') send(200, await service.check(body.target, body.settings, body.credentials, signal));
      else throw new RecommendationError('检测参数无效', 400);
    } catch (error) {
      send(error instanceof RecommendationError ? error.status : 502, { error: error instanceof RecommendationError ? error.message : '推荐服务暂未完成，请稍后再试' });
    } finally { controllers.delete(controller); res.off('close', disconnect); }
  }
  return { handle, close() { for (const controller of controllers) controller.abort(); controllers.clear(); rates.clear(); } };
}
