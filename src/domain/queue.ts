import type { PlaybackSource, QueueEntry, Track } from './models';

// A full source list has sequential positions; [] explicitly means unknown positions.
export const entriesFor = (tracks: Track[], source?: PlaybackSource, sourceIndices?: readonly number[]): QueueEntry[] => tracks.map((track, index) => {
  const sourceIndex = sourceIndices ? sourceIndices[index] : index;
  return { entryId: crypto.randomUUID(), track, ...(source ? { source: { ...source }, ...(sourceIndex !== undefined ? { sourceIndex } : {}) } : {}) };
});
export const samePlaybackSource = (a?: PlaybackSource, b?: PlaybackSource) => Boolean(a && b && a.kind === b.kind && a.id === b.id && a.libraryId === b.libraryId);
export function moveEntry(entries: QueueEntry[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= entries.length || to >= entries.length) return entries;
  const copy = [...entries]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy;
}
export function nextEntry(entries: QueueEntry[], currentId: string | null, repeat: 'off' | 'all' | 'one', natural = false) {
  const index = entries.findIndex((e) => e.entryId === currentId);
  if (!entries.length) return null;
  if (natural && repeat === 'one' && index >= 0) return currentId;
  if (index + 1 < entries.length) return entries[index + 1].entryId;
  return repeat === 'all' ? entries[0].entryId : null;
}
export function shuffled(entries: QueueEntry[], currentId: string | null, random = Math.random) {
  const current = entries.find((e) => e.entryId === currentId);
  const remaining = entries.filter((e) => e.entryId !== currentId);
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  return current ? [current, ...remaining] : remaining;
}
export function lyricIndex(starts: Array<number | undefined>, timeMs: number) {
  let low = 0; let high = starts.length - 1; let result = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if ((starts[middle] ?? Infinity) <= timeMs) { result = middle; low = middle + 1; } else high = middle - 1;
  }
  return result;
}
export function shouldScrobble(listened: number, duration?: number, ended = false) {
  if (!duration || !Number.isFinite(duration)) return listened >= 240;
  if (duration < 30) return ended && listened >= Math.max(0, duration - 1);
  return listened >= Math.min(duration / 2, 240);
}
