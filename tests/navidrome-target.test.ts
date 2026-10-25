// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Agent, createServer } from 'node:http';
import { normalizeNavidromeTarget, requestResolvedTarget, resolveNavidromeTarget } from '../server/navidromeTarget';

describe('managed Navidrome targets', () => {
  it.each([true, false])('connects a pinned hostname and nondefault port with autoSelectFamily=%s', async (autoSelectFamily) => {
    const server = createServer((req, res) => { res.end(JSON.stringify({ host: req.headers.host, path: req.url })); });
    const agent = new Agent({ autoSelectFamily });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
      const base = `http://music.example.test:${address.port}/music`;
      const result = await new Promise<string>((resolve, reject) => {
        const request = requestResolvedTarget({ base, address: '127.0.0.1', family: 4 }, new URL(`${base}/rest/ping.view`), { agent }, (response) => {
          let body = ''; response.setEncoding('utf8'); response.on('data', (part) => { body += part; }); response.on('end', () => resolve(body)); response.on('error', reject);
        });
        request.setTimeout(2000, () => request.destroy(new Error('Timed out'))); request.on('error', reject); request.end();
      });
      expect(JSON.parse(result)).toEqual({ host: `music.example.test:${address.port}`, path: '/music/rest/ping.view' });
    } finally { agent.destroy(); await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); }); }
  });
  it('normalizes only credential-free HTTP(S) bases', () => {
    expect(normalizeNavidromeTarget('https://music.example.com/base/')).toBe('https://music.example.com/base');
    for (const value of ['file:///tmp/music', 'https://user:pass@example.com', 'https://example.com?q=1', 'https://example.com/#x']) {
      expect(() => normalizeNavidromeTarget(value)).toThrow('服务器地址无效');
    }
  });
  it('requires an explicit private-server policy and always blocks link-local metadata targets', async () => {
    await expect(resolveNavidromeTarget('http://127.0.0.1:4533')).rejects.toThrow('允许范围');
    await expect(resolveNavidromeTarget('http://127.0.0.1:4533', true)).resolves.toMatchObject({ address: '127.0.0.1', family: 4 });
    await expect(resolveNavidromeTarget('http://169.254.169.254/latest', true)).rejects.toThrow('允许范围');
    await expect(resolveNavidromeTarget('http://100.100.100.200/latest', true)).rejects.toThrow('允许范围');
    await expect(resolveNavidromeTarget('http://[::ffff:127.0.0.1]:4533')).rejects.toThrow('允许范围');
    await expect(resolveNavidromeTarget('http://[fd00:ec2::254]/latest', true)).rejects.toThrow('允许范围');
    await expect(resolveNavidromeTarget('http://[::1]:4533', true)).resolves.toMatchObject({ address: '::1', family: 6 });
    await expect(resolveNavidromeTarget('http://[fe80::1]:4533', true)).rejects.toThrow('允许范围');
  });
});
