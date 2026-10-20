import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLyricsService } from '../server/lyrics/service.ts';
import { normalizeLyrics } from '../src/domain/lyrics/normalize.ts';
import { providerIds } from '../src/domain/lyrics/types.ts';

const service = createLyricsService({ filename: ':memory:', intervalMs: 300 });
const report: object[] = [];
try {
  for (const provider of providerIds) {
    const started = Date.now();
    const search = await service.search({ title: '海阔天空', artists: ['Beyond'], durationMs: 324000 }, [provider], true);
    report.push({ provider, operation: 'search', candidates: search.candidates.length, errors: search.errors, elapsedMs: Date.now() - started, top: search.candidates.slice(0, 3).map((c) => ({ id: c.id, title: c.title, artists: c.artists, durationMs: c.durationMs, confident: c.confident })) });
    try {
      const fetched = await service.lyrics(provider, provider === 'netease' ? '186016' : '0039MnYb0qxYhV', true);
      const lyrics = normalizeLyrics(fetched.document);
      report.push({ provider, operation: 'lyrics', lines: lyrics.lines.length, translations: lyrics.lines.filter((l) => l.translation?.length).length, synced: lyrics.synced });
    } catch (e) { report.push({ provider, operation: 'lyrics', error: e instanceof Error ? e.message : 'unavailable' }); }
  }
  const folder = resolve('.local'); mkdirSync(folder, { recursive: true });
  const result = { checkedAt: new Date().toISOString(), status: service.status(), results: report };
  writeFileSync(resolve(folder, 'lyrics-probe.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { service.close(); }
