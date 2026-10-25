import type { IncomingMessage, ServerResponse } from 'node:http';

export const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' blob: http: https:",
  "connect-src 'self' http: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

const permissionsPolicy = 'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()';

function singleHeader(value: string | string[] | undefined) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function trustedProxyEnabled() {
  return process.env.TOOKU_TRUST_PROXY === 'true';
}

export function requestUsesHttps(req: IncomingMessage) {
  if ((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted === true) return true;
  const forwarded = singleHeader(req.headers['x-forwarded-proto']);
  return trustedProxyEnabled() && forwarded?.toLowerCase() === 'https';
}

export function requestAllowsSecureCookie(req: IncomingMessage) {
  if (process.env.TOOKU_COOKIE_SECURE === 'true' || requestUsesHttps(req)) return true;
  const origin = singleHeader(req.headers.origin);
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' && sameOriginRequest(req);
  } catch {
    return false;
  }
}

export function sameOriginRequest(req: IncomingMessage) {
  if (singleHeader(req.headers['sec-fetch-site'])?.toLowerCase() === 'cross-site') return false;
  const origin = singleHeader(req.headers.origin);
  if (!origin) return true;
  const host = singleHeader(req.headers.host);
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy);
  res.setHeader('Permissions-Policy', permissionsPolicy);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (process.env.TOOKU_HSTS === 'true' && requestUsesHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
}
