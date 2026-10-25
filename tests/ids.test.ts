import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from '../src/domain/ids';
import { entriesFor } from '../src/domain/queue';

const browserCrypto = globalThis.crypto;
function withoutNativeUuid() {
  vi.stubGlobal('crypto', { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('IDs on LAN HTTP pages', () => {
  it('uses the native UUID API when available', () => {
    const randomUUID = vi.fn(() => 'native-id');
    vi.stubGlobal('crypto', { randomUUID });
    expect(createId()).toBe('native-id');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('uses cryptographic random bytes with UUID v4 version and variant bits', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('preserves distinct repeated queue occurrences without randomUUID', () => {
    withoutNativeUuid();
    const track = { id: 'same', title: '同一首歌', artist: '歌手' };
    const entries = entriesFor(Array.from({ length: 128 }, () => track), { kind: 'playlist', id: 'playlist' });
    expect(new Set(entries.map((entry) => entry.entryId)).size).toBe(128);
    expect(entries.every((entry) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.entryId))).toBe(true);
    expect(entries[127].sourceIndex).toBe(127);
  });

  it('initializes the player module without randomUUID or creating audio', async () => {
    withoutNativeUuid();
    const audio = vi.fn(); vi.stubGlobal('Audio', audio);
    const { player } = await import('../src/features/player/engine');
    expect(player).toBeDefined();
    expect(audio).not.toHaveBeenCalled();
  });
});
