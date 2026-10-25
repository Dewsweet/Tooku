import { describe, expect, it } from 'vitest';
import { startupErrorMessage } from '../server/startupErrors';

describe('server startup recovery messages', () => {
  it('gives actionable recovery steps without suggesting destructive resets', () => {
    expect(startupErrorMessage(new Error('Tooku encryption key is missing; restore the original key file.'))).toContain('恢复原来的 tooku-secret.key');
    expect(startupErrorMessage(new Error('Tooku security database cannot be decrypted with this key.'))).toContain('同一份备份');
    expect(startupErrorMessage(new Error('Unsupported Tooku database version'))).toContain('同版或更新版本');
    expect(startupErrorMessage(new Error('database disk image is malformed'))).toContain('保留当前数据目录');
  });

  it('keeps an unexpected startup cause visible', () => {
    expect(startupErrorMessage(new Error('permission denied'))).toBe('启动数据检查失败：permission denied');
  });
});
