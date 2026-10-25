import { requestResolvedTarget, type ResolvedNavidromeTarget } from './navidromeTarget.ts';
import { connectionFailure, NavidromeConnectionError } from './navidromeErrors.ts';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Bounded probe; redirects are never followed, especially with authentication. */
export function requestNavidromeProtocol(target: ResolvedNavidromeTarget, method: 'ping' | 'getUser', auth?: { u: string; t: string; s: string }): Promise<Record<string, unknown>> {
  const url = new URL(`${target.base}/rest/${method}.view`);
  const parameters = new URLSearchParams({ ...(auth ?? {}), ...(auth ? { username: auth.u } : {}), v: '1.16.1', c: 'Tooku', f: 'json' });
  const body = auth ? parameters.toString() : undefined;
  if (!auth) url.search = parameters.toString();
  return new Promise((resolve, reject) => {
    const request = requestResolvedTarget(target, url, {
      method: auth ? 'POST' : 'GET',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, (response) => {
      const status = response.statusCode ?? 502;
      if (status >= 300 && status < 400) { fail(new NavidromeConnectionError('redirect')); response.destroy(); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { fail(new NavidromeConnectionError('size')); response.destroy(); }
        else chunks.push(chunk);
      });
      response.on('error', (error) => fail(connectionFailure(error)));
      response.on('aborted', () => fail(new NavidromeConnectionError('interrupted')));
      response.on('end', () => {
        let result: Record<string, unknown>;
        try { result = object(object(JSON.parse(Buffer.concat(chunks).toString('utf8')))['subsonic-response']); }
        catch { fail(new NavidromeConnectionError(status >= 400 ? 'http' : 'protocol', status)); return; }
        const code = object(result.error).code;
        const requiresAccount = result.status === 'failed' && typeof code === 'number' && [10, 40, 41, 42, 43, 44, 50].includes(code);
        if (status >= 400 && !([401, 403].includes(status) && requiresAccount)) { fail(new NavidromeConnectionError('http', status)); return; }
        if (result.status !== 'ok' && !requiresAccount) { fail(new NavidromeConnectionError('protocol')); return; }
        clearTimeout(deadline); resolve(result);
      });
    });
    const deadline = setTimeout(() => fail(new NavidromeConnectionError('timeout')), 8000);
    function fail(error: NavidromeConnectionError) { clearTimeout(deadline); reject(error); request.destroy(); }
    request.on('error', (error) => fail(connectionFailure(error)));
    request.end(body);
  });
}
