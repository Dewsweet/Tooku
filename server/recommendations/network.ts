import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { validModelBase } from '../../src/domain/recommendations.ts';

export class RecommendationError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}
export async function limitedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new RecommendationError(response.status === 429 ? '来源请求过于频繁，请稍后再试' : [401, 403].includes(response.status) ? '来源认证未通过，请检查凭据或权限' : '来源暂时不可用');
  const reader = response.body?.getReader(); if (!reader) throw new RecommendationError('来源响应格式无效');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1048576) { await reader.cancel(); throw new RecommendationError('来源响应超过大小限制'); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof RecommendationError) throw error; throw new RecommendationError('来源响应格式无效'); }
  finally { reader.releaseLock(); }
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const [first, second = '0'] = address.toLowerCase().split(':');
    const prefix = Number.parseInt(first, 16); const subnet = Number.parseInt(second || '0', 16);
    return prefix >= 0x2000 && prefix <= 0x3fff && !(prefix === 0x2001 && (subnet < 0x200 || subnet === 0xdb8)) && prefix !== 0x2002 && prefix !== 0x3fff;
  }
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99))
    && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) && !(a === 203 && b === 0 && c === 113);
}
export async function resolveModelEndpoint(base: string, resolver: (hostname: string, options: { all: true; verbatim: true }) => Promise<{ address: string; family: number }[]> = lookup) {
  if (!base || !validModelBase(base)) throw new RecommendationError('模型地址需为不含凭据或查询参数的 HTTPS 地址', 400);
  const url = new URL(base);
  if (url.port && url.port !== '443') throw new RecommendationError('模型地址仅支持 HTTPS 默认端口', 400);
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) throw new RecommendationError('模型地址需解析到公网地址', 400);
  return { url, address: addresses[0] };
}
export async function modelCompletion(base: string, key: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
  // Pin the checked DNS result to this connection. Never follow model redirects with a key.
  signal.throwIfAborted();
  let cancel = () => {};
  const canceled = new Promise<never>((_resolve, reject) => { cancel = () => reject(new RecommendationError('模型请求已取消或超时')); signal.addEventListener('abort', cancel, { once: true }); });
  const destination = await Promise.race([resolveModelEndpoint(base), canceled]).finally(() => signal.removeEventListener('abort', cancel));
  const { url, address } = destination;
  signal.throwIfAborted();
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const fail = () => reject(new RecommendationError(signal.aborted ? '模型请求已取消或超时' : '模型请求失败，请检查接口和模型配置'));
    const req = request(url, { method: 'POST', signal,
      lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'Content-Length': Buffer.byteLength(body) },
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new RecommendationError(response.statusCode === 429 ? '模型请求过于频繁，请稍后再试' : '模型认证或请求未通过，请检查接口和模型配置')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1048576) req.destroy(); else chunks.push(chunk); });
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new RecommendationError('模型响应格式无效')); } });
      response.on('error', fail);
    });
    req.setTimeout(15000, () => req.destroy()); req.on('error', fail); req.end(body);
  });
}
