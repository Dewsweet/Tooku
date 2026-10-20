import type { LyricCandidate, TrackDescriptor } from '../../src/domain/lyrics/types.ts';
const clean = (v: string) => v.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
function similarity(a: string, b: string) {
  a = clean(a); b = clean(b); if (!a || !b) return 0; if (a === b) return 1;
  const pairs = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const x = pairs(a); const y = pairs(b); return x.size + y.size ? 2 * [...x].filter((v) => y.has(v)).length / (x.size + y.size) : 0;
}
const version = (s: string) => [...s.toLowerCase().matchAll(/live|现场|伴奏|instrumental|off\s*vocal|翻唱|原唱|cover|tv\s*size|remix|重混/g)].map((m) => m[0].replace(/\s/g, '')).sort().join('|');
export function rankCandidates(track: TrackDescriptor, candidates: LyricCandidate[]) {
  return candidates.map((candidate) => {
    const title = similarity(track.title, candidate.title);
    const artist = Math.max(0, ...track.artists.flatMap((a) => candidate.artists.map((b) => similarity(a, b))));
    const delta = track.durationMs && candidate.durationMs ? Math.abs(track.durationMs - candidate.durationMs) : undefined;
    const conflict = version(track.title) !== version(candidate.title);
    const score = Math.max(0, title * .55 + artist * .3 + (delta === undefined ? 0 : Math.max(0, 1 - delta / 15000) * .1) + (track.album && candidate.album ? similarity(track.album, candidate.album) * .05 : 0) - (conflict ? .4 : 0));
    return { ...candidate, score, confident: title >= .95 && artist >= .9 && !conflict && delta !== undefined && delta <= 5000 };
  }).sort((a, b) => b.score - a.score).map((candidate, i, all) => ({ ...candidate, confident: candidate.confident && (i > 0 || !all[1] || candidate.score - all[1].score >= .08) }));
}
