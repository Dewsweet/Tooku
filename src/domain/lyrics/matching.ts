import type { LyricCandidate, TrackDescriptor } from './types.ts';

const clean = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
function similarity(left: string, right: string) {
  left = clean(left); right = clean(right);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const pairs = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));
  const a = pairs(left); const b = pairs(right);
  return a.size + b.size ? 2 * [...a].filter((value) => b.has(value)).length / (a.size + b.size) : 0;
}
const version = (text: string) => [...text.toLowerCase().matchAll(/\blive\b|现场|伴奏|\binstrumental\b|off\s*vocal|翻唱|原唱|\bcover\b|tv\s*size|\bremix\b|重混/g)].map((m) => m[0].replace(/\s/g, '')).sort().join('|');
function comparison(track: TrackDescriptor, candidate: LyricCandidate) {
  const base = (title: string) => title.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, '').trim();
  return {
    title: Math.max(similarity(track.title, candidate.title), similarity(base(track.title), base(candidate.title))),
    artist: Math.max(0, ...track.artists.flatMap((artist) => candidate.artists.map((other) => similarity(artist, other)))),
    delta: track.durationMs && candidate.durationMs ? Math.abs(track.durationMs - candidate.durationMs) : undefined,
    conflict: version(track.title) !== version(candidate.title),
  };
}
export function canUseLyricCandidate(track: TrackDescriptor, candidate: LyricCandidate) {
  const { title, artist, delta, conflict } = comparison(track, candidate);
  if (conflict || title < .8 || artist < .65) return false;
  // Nearby editions are usable without asking the listener to pick an album release.
  const tolerance = Math.min(15000, Math.max(10000, (track.durationMs ?? 0) * .05));
  return delta === undefined ? title >= .95 && artist >= .9 : delta <= tolerance;
}
export function rankCandidates(track: TrackDescriptor, candidates: LyricCandidate[]) {
  return candidates.map((candidate) => {
    const { title, artist, delta, conflict } = comparison(track, candidate);
    const score = Math.max(0, title * .55 + artist * .3 + (delta === undefined ? 0 : Math.max(0, 1 - delta / 15000) * .1) + (track.album && candidate.album ? similarity(track.album, candidate.album) * .05 : 0) - (conflict ? .4 : 0));
    return { ...candidate, score, confident: canUseLyricCandidate(track, candidate) };
  }).sort((a, b) => b.score - a.score);
}
