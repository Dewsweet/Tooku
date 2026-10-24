import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('browser storage fallback', () => {
  it('keeps persisted state usable in memory when localStorage is denied', async () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new DOMException('denied', 'SecurityError'); },
      setItem() { throw new DOMException('denied', 'SecurityError'); },
      removeItem() { throw new DOMException('denied', 'SecurityError'); },
    });
    const { browserJsonStorage, browserStorageWarning, browserStorageWriteRevision } = await import('../src/storage/browserStorage');
    const storage = browserJsonStorage<{ value: number }>();
    const before = browserStorageWriteRevision();
    await storage.setItem('fixture', { state: { value: 7 }, version: 1 });
    expect(await storage.getItem('fixture')).toEqual({ state: { value: 7 }, version: 1 });
    expect(browserStorageWriteRevision()).toBeGreaterThan(before);
    expect(browserStorageWarning()).toContain('显示偏好仅在本次打开期间有效');
  });

  it('distinguishes unavailable IndexedDB playback caches', async () => {
    const { browserStorageWarning, markIndexedDbUnavailable } = await import('../src/storage/browserStorage');
    markIndexedDbUnavailable();
    expect(browserStorageWarning()).toContain('队列、历史和离线副本');
  });

  it('ignores malformed persisted JSON instead of failing store initialization', async () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => '{broken-json', setItem: vi.fn(), removeItem });
    const { browserJsonStorage, browserStorageWarning } = await import('../src/storage/browserStorage');
    expect(await browserJsonStorage<{ value: number }>().getItem('broken')).toBeNull();
    expect(removeItem).toHaveBeenCalledWith('broken');
    expect(browserStorageWarning()).toContain('已忽略损坏缓存');
  });
});
