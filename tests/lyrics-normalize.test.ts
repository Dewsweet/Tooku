import { describe, expect, it } from 'vitest';
import { normalizeLyrics, parseLyricTrack } from '../src/domain/lyrics/normalize';
import { isLyricsSettings, defaultLyricsSettings, type LyricDocument, type LyricLayout } from '../src/domain/lyrics/types';
import { rankCandidates } from '../server/lyrics/matching';

const document = (text: string): LyricDocument => ({ version: 1, source: 'local', recordId: 'song', tracks: [{ role: 'original', text }] });
const edit = (layout: LyricLayout) => ({ layout, hash: 'test' });
describe('bilingual lyric normalization', () => {
  it('parses BOM, metadata, entities, repeated timestamps and offsets without inventing timing', () => {
    expect(parseLyricTrack({ role: 'original', offsetMs: 100, text: '\ufeff[ar:test]\r\n[offset:500]\r\n[00:01.25][00:04]hello &amp; world\r\n[00:05]\r\nplain' })).toEqual([
      { text: 'hello & world', startMs: 850 }, { text: 'hello & world', startMs: 3600 }, { text: '', startMs: 4600 }, { text: 'plain' },
    ]);
    expect(normalizeLyrics(document('hello\n你好')).synced).toBe(false);
  });
  it.each(['  ', ' / ', '\u3000\u3000'])('groups consistent inline text separated by %j', (separator) => {
    const result = normalizeLyrics(document(`[00:01]hello world${separator}你好世界\n[00:02]stay here${separator}留在这里`));
    expect(result.lines).toEqual([{ text: 'hello world', startMs: 1000, translation: ['你好世界'] }, { text: 'stay here', startMs: 2000, translation: ['留在这里'] }]);
  });
  it('preserves English spacing and Japanese Han text when language or layout is ambiguous', () => {
    for (const text of ['one  two\nthree  four', '夢 / 世界\n自由 / 孤独', 'hello / 你好\nnormal sentence']) {
      expect(normalizeLyrics(document(text)).lines.map((l) => l.text)).toEqual(text.split('\n'));
    }
  });
  it('groups alternating lines and repeated-time halves while retaining original timestamps', () => {
    const expected = [{ text: 'hello', startMs: 1000, translation: ['你好'] }, { text: 'world', startMs: 2000, translation: ['世界'] }];
    expect(normalizeLyrics(document('[00:01]hello\n[00:01]你好\n[00:02]world\n[00:02]世界')).lines).toEqual(expected);
    expect(normalizeLyrics(document('[00:01]hello\n[00:02]world\n[00:01]你好\n[00:02]世界')).lines).toEqual(expected);
  });
  it('lets manual correction group static halves and a custom separator; original mode preserves text', () => {
    const raw = document('hello\nworld\n你好\n世界');
    expect(normalizeLyrics(raw).lines).toHaveLength(4);
    expect(normalizeLyrics(raw, edit('halves')).lines).toEqual([{ text: 'hello', translation: ['你好'] }, { text: 'world', translation: ['世界'] }]);
    const inline = document('夢|梦想');
    expect(normalizeLyrics(inline, { ...edit('inline'), separator: '|' }).lines[0]).toEqual({ text: '夢', translation: ['梦想'] });
    expect(normalizeLyrics(inline, edit('original')).lines[0].text).toBe('夢|梦想');
  });
  it('aligns separate translations with bounded drift and preserves unpaired translation text', () => {
    const doc = document('[00:01]hello\n[00:02]world');
    doc.tracks.push({ role: 'translation', text: '[00:01.20]你好\n[00:02.80]未配对' }, { role: 'romanization', text: '[00:01]he lo\n[00:09]unmatched' });
    const result = normalizeLyrics(doc);
    expect(result.lines[0]).toEqual({ text: 'hello', startMs: 1000, translation: ['你好'], romanization: ['he lo'] });
    expect(result.lines[1].translation).toBeUndefined();
    expect(result.lines[2]).toEqual({ text: '未配对', startMs: 2800 });
    expect(doc.tracks[2].text).toContain('unmatched');
  });
  it('does not pair adjacent rapid cues or discard identical-time repeated originals', () => {
    const doc = document('[00:01]hello\n[00:01.30]world\n[00:01.30]repeat');
    doc.tracks.push({ role: 'translation', text: '[00:01.16]未知' });
    const result = normalizeLyrics(doc);
    expect(result.lines).toHaveLength(4);
    expect(result.lines.some((l) => l.translation)).toBe(false);
  });
});

describe('matching and persisted choices', () => {
  const track = { title: 'Song', artists: ['Artist'], album: 'Album', durationMs: 180000 };
  const candidate = { provider: 'netease' as const, id: '123', ...track };
  it('automatically accepts a unique version, but rejects covers, live versions and missing duration', () => {
    expect(rankCandidates(track, [candidate])[0].confident).toBe(true);
    for (const change of [{ artists: ['Other'] }, { title: 'Song (Live)' }, { durationMs: undefined }]) expect(rankCandidates(track, [{ ...candidate, ...change }])[0].confident).toBe(false);
    expect(rankCandidates(track, [candidate, { ...candidate, id: '456' }])[0].confident).toBe(false);
  });
  it('validates optional choices without allowing URLs, secrets or unknown schema fields', () => {
    expect(isLyricsSettings(defaultLyricsSettings)).toBe(true);
    const tracks = { song: { mode: 'qq', bindings: { qq: 'abc123' }, edits: { local: { layout: 'inline', hash: 'a', delayMs: -100, showTranslation: true } } } };
    expect(isLyricsSettings({ ...defaultLyricsSettings, tracks })).toBe(true);
    for (const choice of [{ mode: 'qq', token: 'secret' }, { mode: 'qq', bindings: { qq: 'https://example.test/path' } }, { mode: 'auto', edits: { local: { layout: 'bad', hash: 'a' } } }]) expect(isLyricsSettings({ ...defaultLyricsSettings, tracks: { song: choice } })).toBe(false);
    expect(isLyricsSettings({ ...defaultLyricsSettings, order: ['qq', 'qq'] })).toBe(false);
  });
});
