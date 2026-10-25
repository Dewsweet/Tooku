import { describe, expect, it } from 'vitest';
import { entriesFor, lyricIndex, moveEntry, nextEntry, shouldScrobble, shuffled } from '../src/domain/queue';
import type { Track } from '../src/domain/models';

const songs: Track[] = [{ id: 'a', title: '同一首歌', artist: '歌手' }, { id: 'a', title: '同一首歌', artist: '歌手' }, { id: 'b', title: '下一首', artist: '歌手' }];
describe('queue identity and listening semantics', () => {
  it('keeps duplicate songs as independent occurrences', () => { const entries = entriesFor(songs); expect(new Set(entries.map((e) => e.entryId)).size).toBe(3); expect(entries.map((e) => e.track.id)).toEqual(['a', 'a', 'b']); expect(nextEntry(entries, entries[0].entryId, 'off')).toBe(entries[1].entryId); });
  it('reorders the selected occurrence without dropping duplicates', () => { const entries = entriesFor(songs); expect(moveEntry(entries, 1, 2).map((e) => e.entryId)).toEqual([entries[0].entryId, entries[2].entryId, entries[1].entryId]); expect(moveEntry(entries, -1, 4)).toBe(entries); });
  it('distinguishes natural repeat-one from user skipping', () => { const entries = entriesFor(songs); expect(nextEntry(entries, entries[0].entryId, 'one', true)).toBe(entries[0].entryId); expect(nextEntry(entries, entries[0].entryId, 'one', false)).toBe(entries[1].entryId); });
  it('stops at the end or wraps only when repeating all', () => { const entries = entriesFor(songs); expect(nextEntry(entries, entries[2].entryId, 'off')).toBeNull(); expect(nextEntry(entries, entries[2].entryId, 'all')).toBe(entries[0].entryId); expect(nextEntry([], null, 'all')).toBeNull(); });
  it('shuffle preserves the current occurrence and the complete multiset', () => { const entries = entriesFor(songs); const result = shuffled(entries, entries[1].entryId, () => 0); expect(result[0]).toBe(entries[1]); expect(result.map((e) => e.entryId).sort()).toEqual(entries.map((e) => e.entryId).sort()); });
  it('finds the correct lyric before the first line and at boundaries', () => { expect(lyricIndex([1000, 2000, 5000], 999)).toBe(-1); expect(lyricIndex([1000, 2000, 5000], 2000)).toBe(1); expect(lyricIndex([], 50)).toBe(-1); });
  it('does not count a seek as listening and requires short songs to end', () => { expect(shouldScrobble(10, 200)).toBe(false); expect(shouldScrobble(100, 200)).toBe(true); expect(shouldScrobble(19.5, 20)).toBe(false); expect(shouldScrobble(19.5, 20, true)).toBe(true); expect(shouldScrobble(10, 20, true)).toBe(false); expect(shouldScrobble(239, undefined)).toBe(false); });
});
