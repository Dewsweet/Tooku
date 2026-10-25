import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { artistSearchNames, normalizeArtistName } from '../src/domain/artistNames.ts';

type Source = 'netease' | 'qq';
type Sample = { name: string; group: string };
export interface Candidate { id: string; name: string; aliases: string[]; imageUrl?: string }
interface ProbeResult extends Sample { source: Source; queries: string[]; queryCount: number; match: string; image: string; candidates: Candidate[]; errors: string[] }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const imageHosts = /^(?:p\d+\.music\.126\.net|y\.gtimg\.cn)$/i;

function publicImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !imageHosts.test(url.hostname) || url.username || url.password || url.port || url.hash) return;
    url.protocol = 'https:';
    // Keep only known public image resizing parameters in experiment output.
    for (const key of [...url.searchParams.keys()]) if (!['param', 'max_age'].includes(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return; }
}

export function parseCandidates(source: Source, value: unknown): Candidate[] {
  const data = object(value);
  if (data.code !== (source === 'netease' ? 200 : 0)) throw new Error('upstream-business-error');
  const list = source === 'netease' ? object(data.result).artists : object(object(data.data).singer).list;
  if (list !== undefined && !Array.isArray(list)) throw new Error('unexpected-response');
  return (Array.isArray(list) ? list : []).flatMap((value) => {
    const artist = object(value);
    const id = source === 'netease' ? (typeof artist.id === 'number' ? String(artist.id) : text(artist.id)) : text(artist.singerMID);
    const name = text(source === 'netease' ? artist.name : artist.singerName);
    if (!id || !name) return [];
    return [{ id, name, aliases: source === 'netease' ? strings(artist.alias) : [], imageUrl: publicImage(source === 'netease' ? artist.picUrl || artist.img1v1Url : artist.singerPic) }];
  });
}

export function matchCandidates(name: string, candidates: Candidate[]) {
  const normalized = normalizeArtistName(name);
  const direct = candidates.filter((artist) => [artist.name, ...artist.aliases].some((alias) => normalizeArtistName(alias) === normalized));
  if (direct.length) return { kind: direct.length === 1 ? 'direct-name' : 'ambiguous', candidates: direct };
  const variants = new Set(artistSearchNames(name).slice(1).map(normalizeArtistName));
  const derived = candidates.filter((artist) => [artist.name, ...artist.aliases].some((alias) => variants.has(normalizeArtistName(alias))));
  return { kind: derived.length === 1 ? 'derived-name' : derived.length ? 'ambiguous' : 'unmatched', candidates: derived };
}

async function search(source: Source, name: string): Promise<Candidate[]> {
  const url = source === 'netease'
    ? `https://music.163.com/api/search/get?${new URLSearchParams({ s: name, type: '100', limit: '5' })}`
    : `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${new URLSearchParams({ w: name, t: '9', p: '1', n: '5', format: 'json' })}`;
  const response = await fetch(url, { headers: { Accept: 'application/json', Referer: source === 'netease' ? 'https://music.163.com/' : 'https://y.qq.com/' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`http-${response.status}`);
  const body = await response.text();
  if (body.length > 1024 * 1024) throw new Error('oversized-response');
  return parseCandidates(source, JSON.parse(body));
}

async function checkImage(url?: string) {
  if (!url) return 'missing';
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(10000) });
    return response.ok && response.headers.get('content-type')?.startsWith('image/') ? 'reachable' : `http-${response.status}`;
  } catch { return 'unavailable'; }
}

const samples: Sample[] = [
  ...['周杰伦', '王菲', '陈奕迅', '邓丽君', '窦唯', '草东没有派对', '万能青年旅店', '陈粒'].map((name) => ({ name, group: '中文' })),
  ...['宇多田ヒカル', '米津玄師', '椎名林檎', '坂本龍一', '久石譲', '中島みゆき', 'ヨルシカ', 'S.E.N.S.'].map((name) => ({ name, group: '日文/日本艺名' })),
  ...['아이유', '태연', '김광석', '악동뮤지션', '이문세', '이수현'].map((name) => ({ name, group: '韩文' })),
  ...['李娜', 'LISA'].map((name) => ({ name, group: '同名/短名' })),
  ...['宇多田光（宇多田ヒカル）', '中岛美雪（中島みゆき）', '坂本龙一（坂本龍一）', '久石让（久石譲）', '椎名林檎（しいな りんご）', '李知恩（아이유）'].map((name) => ({ name, group: '组合名' })),
];

async function main() {
  const input = process.argv[2];
  const selected: unknown = input ? JSON.parse(await readFile(resolve(input), 'utf8')) : samples;
  if (!Array.isArray(selected) || selected.length > 50 || !selected.every((item) => typeof item?.name === 'string' && item.name.length > 0 && item.name.length <= 120 && typeof item.group === 'string')) throw new Error('Expected at most 50 {name, group} samples');
  const selectedSamples: Sample[] = selected.map((item) => ({ name: item.name, group: item.group }));
  const results: ProbeResult[] = [];
  for (const sample of selectedSamples) {
    for (const source of ['netease', 'qq'] as const) {
      const queries = artistSearchNames(sample.name);
      const candidates = new Map<string, Candidate>();
      const errors: string[] = [];
      let queryCount = 0;
      for (const query of queries) {
        queryCount++;
        try { for (const candidate of await search(source, query)) candidates.set(candidate.id, candidate); }
        catch (error) { errors.push(error instanceof SyntaxError ? 'invalid-json' : error instanceof Error && /^(http-\d+|upstream-business-error|unexpected-response|oversized-response)$/.test(error.message) ? error.message : 'request-failed'); }
        await delay(200);
      }
      const match = matchCandidates(sample.name, [...candidates.values()]);
      const image = match.candidates.length === 1 ? await checkImage(match.candidates[0].imageUrl) : 'not-selected';
      const result = { ...sample, source, queries, queryCount, match: match.kind, image, candidates: match.candidates, errors };
      results.push(result);
      console.log(JSON.stringify({ name: sample.name, source, match: match.kind, image, errors }));
    }
  }
  const summary = (['netease', 'qq'] as const).map((source) => {
    const rows = results.filter((item) => item.source === source);
    return { source, samples: rows.length, directName: rows.filter((item) => item.match === 'direct-name').length, derivedName: rows.filter((item) => item.match === 'derived-name').length, ambiguous: rows.filter((item) => item.match === 'ambiguous').length, reachableImages: rows.filter((item) => item.image === 'reachable').length, requestErrors: rows.filter((item) => item.errors.length).length };
  });
  const output = resolve('.local/artist-artwork-probe.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ testedAt: new Date().toISOString(), note: 'Public samples; name/alias candidates only, identity and image content not visually verified. No login or Navidrome changes.', summary, results }, null, 2));
  console.log(JSON.stringify({ output, summary }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
