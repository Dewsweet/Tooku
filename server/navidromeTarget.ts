import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions, type ClientRequest, type IncomingMessage } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { getCACertificates } from 'node:tls';
import { DataError } from './store.ts';
import { NavidromeConnectionError } from './navidromeErrors.ts';

export function navidromeCertificateAuthorities() { return [...new Set([...getCACertificates('default'), ...getCACertificates('system')])]; }
const secureAgent = new Agent({ ca: navidromeCertificateAuthorities(), rejectUnauthorized: true, keepAlive: true, autoSelectFamily: true });

export interface ResolvedNavidromeTarget {
  base: string;
  address: string;
  family: 4 | 6;
  addresses?: { address: string; family: 4 | 6 }[];
}

export function normalizeNavidromeTarget(input: unknown) {
  if (typeof input !== 'string' || input.length > 2048) throw new DataError(400, '服务器地址无效。');
  let url: URL;
  try { url = new URL(input); }
  catch { throw new DataError(400, '服务器地址无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new DataError(400, '服务器地址无效。');
  return url.href.replace(/\/+$/, '');
}

function ipv4Parts(address: string) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : undefined;
}

function blockedAddress(address: string, allowPrivate: boolean) {
  if (isIP(address) === 4) {
    const parts = ipv4Parts(address)!; const [a, b] = parts;
    if (['100.100.100.200', '168.63.129.16', '192.0.0.192'].includes(address)) return true;
    if (a === 0 || a >= 224 || a === 169 && b === 254) return true;
    const privateAddress = a === 10 || a === 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
    return privateAddress && !allowPrivate;
  }
  const value = address.toLowerCase().split('%')[0];
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) return blockedAddress(mapped, allowPrivate);
    const words = mapped.split(':');
    if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
      const high = Number.parseInt(words[0], 16); const low = Number.parseInt(words[1], 16);
      return blockedAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, allowPrivate);
    }
  }
  if (['fd00:ec2::254'].includes(value)) return true;
  if (value === '::' || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return true;
  const privateAddress = value === '::1' || value.startsWith('fc') || value.startsWith('fd');
  return privateAddress && !allowPrivate;
}

export async function resolveNavidromeTarget(input: unknown, allowPrivate = false, resolve = lookup): Promise<ResolvedNavidromeTarget> {
  const base = normalizeNavidromeTarget(input); const url = new URL(base);
  if (url.hostname.toLowerCase() === 'localhost') {
    if (!allowPrivate) throw new NavidromeConnectionError('private');
    return { base, address: '127.0.0.1', family: 4 };
  }
  const literal = isIP(url.hostname.replace(/^\[|\]$/g, ''));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await (async () => {
    if (literal) return [{ address: url.hostname.replace(/^\[|\]$/g, ''), family: literal as 4 | 6 }];
    try {
      return await Promise.race([resolve(url.hostname, { all: true, verbatim: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new NavidromeConnectionError('dns')), 3000); })]);
    } catch { throw new NavidromeConnectionError('dns'); }
    finally { clearTimeout(timer); }
  })();
  if (!addresses.length || addresses.some((entry) => blockedAddress(entry.address, allowPrivate))) throw new NavidromeConnectionError('policy');
  const selected = addresses[0];
  return { base, address: selected.address, family: selected.family as 4 | 6, addresses: addresses.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 })) };
}

export function requestResolvedTarget(target: ResolvedNavidromeTarget, url: URL, options: RequestOptions, reply: (response: IncomingMessage) => void): ClientRequest {
  if (!url.href.startsWith(`${target.base}/`) && url.href !== target.base) throw new DataError(400, '代理目标无效。');
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return request(url, {
    ...options,
    ...(url.protocol === 'https:' && options.agent === undefined ? { agent: secureAgent } : {}),
    lookup: (_hostname, options, callback) => options.all
      ? callback(null, target.addresses ?? [{ address: target.address, family: target.family }])
      : callback(null, target.address, target.family),
  }, reply);
}
