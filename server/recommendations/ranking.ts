import { canUseLyricCandidate } from '../../src/domain/lyrics/matching.ts';
import { songKey, type ListeningSeed, type RecommendationSong } from '../../src/domain/recommendations.ts';

export interface Candidate { song: RecommendationSong; score: number; sources?: string[] }
const edition = /^(?:(?:album|original|studio)\s+version|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|专辑版|录音室版|原版|重制版)$/i;
function recordingTitle(title: string) {
  let result = title.normalize('NFKC').replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (full: string, round: string | undefined, square: string | undefined) => edition.test((round ?? square ?? '').trim()) ? '' : full).trim();
  const suffix = result.match(/\s+[-–—]\s+([^-–—]+)$/);
  if (suffix && edition.test(suffix[1].trim())) result = result.slice(0, suffix.index).trim();
  return result;
}
export function sameRecommendation(left: Pick<RecommendationSong, 'title' | 'artists'>, right: Pick<RecommendationSong, 'title' | 'artists'>) {
  const title = recordingTitle(left.title); const other = recordingTitle(right.title);
  // Only collapse known edition labels. Keep live, cover, remix and unknown annotations distinct.
  return songKey(title, []) === songKey(other, []) && canUseLyricCandidate({ ...left, title }, { ...right, title: other });
}
const names = (song: Pick<RecommendationSong, 'artists'>) => song.artists.map((artist) => songKey('', [artist]));
const albumKey = (song: Pick<RecommendationSong, 'album'>) => song.album?.trim() ? songKey(song.album, []) : '';

// Interleave performers so a run of album listens does not consume the whole request budget.
export function balancedSeeds(seeds: ListeningSeed[]) {
  const groups = new Map<string, ListeningSeed[]>();
  for (const seed of seeds) {
    const key = names(seed)[0]; const group = groups.get(key) ?? []; group.push(seed); groups.set(key, group);
  }
  const result: ListeningSeed[] = [];
  for (let i = 0; result.length < seeds.length; i++) for (const group of groups.values()) if (group[i]) result.push(group[i]);
  return result;
}

// Keep a slice of each listening source rather than taking one global popularity ranking.
export function candidatePool(candidates: Candidate[], seeds: ListeningSeed[], excluded: string[], limit = 180) {
  const blocked = new Set(excluded); const merged = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (blocked.has(candidate.song.id) || seeds.some((seed) => canUseLyricCandidate(seed, candidate.song))) continue;
    const current = merged.get(candidate.song.id);
    if (current) {
      current.score = Math.max(current.score, candidate.score);
      current.sources = [...new Set([...(current.sources ?? []), ...(candidate.sources ?? [])])];
    } else merged.set(candidate.song.id, { ...candidate, sources: [...candidate.sources ?? []] });
  }
  const selected: Candidate[] = []; const picked = new Set<string>(); const artistCounts = new Map<string, number>();
  const add = (candidate: Candidate) => {
    if (selected.length >= limit || picked.has(candidate.song.id) || names(candidate.song).some((name) => (artistCounts.get(name) ?? 0) >= 3)) return;
    selected.push(candidate); picked.add(candidate.song.id); names(candidate.song).forEach((name) => artistCounts.set(name, (artistCounts.get(name) ?? 0) + 1));
  };
  const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
  const sourceKeys = [...new Set(candidates.flatMap((candidate) => candidate.sources ?? []))];
  for (let round = 0; round < 3; round++) for (const key of sourceKeys) {
    const next = ranked.find((candidate) => candidate.sources?.includes(key) && !picked.has(candidate.song.id) && names(candidate.song).every((name) => (artistCounts.get(name) ?? 0) < 3));
    if (next) add(next);
  }
  ranked.forEach(add);
  return selected;
}

export function selectRecommendations(candidates: Candidate[], seeds: ListeningSeed[], exploration: number, excluded: string[] = [], count = 30, random: () => number = () => .5) {
  const pool = candidatePool(candidates, seeds, excluded, 240);
  const familiar = new Set(seeds.flatMap(names)); const heardAlbums = new Set(seeds.map(albumKey).filter(Boolean));
  const isNew = (candidate: Candidate) => names(candidate.song).every((name) => !familiar.has(name));
  const maximum = Math.max(1, ...pool.map((candidate) => candidate.score));
  const weights = new Map(pool.map((candidate) => [candidate.song.id, candidate.score / maximum * (.85 + random() * .3)]));
  const selected: RecommendationSong[] = []; const artists = new Set<string>(); const albums = new Set<string>(); const sources = new Map<string, number>();
  const pick = (discoverOnly: boolean) => {
    const available = pool.filter((candidate) => (!discoverOnly || isNew(candidate)) && !names(candidate.song).some((name) => artists.has(name)) && (!albumKey(candidate.song) || !albums.has(albumKey(candidate.song))));
    const utility = (candidate: Candidate) => {
      const coverage = Math.min(...(candidate.sources?.length ? candidate.sources.map((key) => sources.get(key) ?? 0) : [0]));
      return (weights.get(candidate.song.id) ?? 0) / (1 + coverage * .8) * (heardAlbums.has(albumKey(candidate.song)) ? .25 : 1);
    };
    available.sort((a, b) => utility(b) - utility(a)); const candidate = available[0];
    if (!candidate) return false;
    selected.push(candidate.song); names(candidate.song).forEach((name) => artists.add(name));
    if (albumKey(candidate.song)) albums.add(albumKey(candidate.song));
    candidate.sources?.forEach((key) => sources.set(key, (sources.get(key) ?? 0) + 1));
    return true;
  };
  while (selected.length < Math.ceil(count * exploration) && pick(true)) { /* Reserve space for new performers. */ }
  while (selected.length < count && pick(false)) { /* Keep diversity limits even when the pool is small. */ }
  return selected;
}
