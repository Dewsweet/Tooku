// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeNavidromeTarget, resolveNavidromeTarget } from '../server/navidromeTarget';

describe('managed Navidrome targets', () => {
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
