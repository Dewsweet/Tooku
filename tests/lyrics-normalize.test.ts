import { describe, expect, it } from 'vitest';
import { normalizeLyrics, parseLyricTrack } from '../src/domain/lyrics/normalize';
import { isCandidate, isLyricsSettings, defaultLyricsSettings, type LyricDocument, type LyricLayout } from '../src/domain/lyrics/types';
import { rankCandidates } from '../server/lyrics/matching';
import { lyricWordProgress } from '../src/domain/lyrics/words';

const document = (text: string): LyricDocument => ({ version: 1, source: 'local', recordId: 'song', tracks: [{ role: 'original', text }] });
const edit = (layout: LyricLayout) => ({ layout, hash: 'test' });

describe('local enhanced LRC words', () => {
  it('preserves real word timing, an explicit ending marker, offsets and repeated lines', () => {
    const lyrics = normalizeLyrics(document('[offset:100]\n[00:01][00:05]<00:01.00>你<00:01.50>好 <00:02.00>世界<00:03.00>'));
    expect(lyrics.lines[0]).toEqual({ text: '你好 世界', startMs: 900, words: [
      { text: '你', startMs: 900, endMs: 1400 }, { text: '好 ', startMs: 1400, endMs: 1900 }, { text: '世界', startMs: 1900, endMs: 2900 },
    ] });
    expect(lyrics.lines[1].words?.[0].startMs).toBe(4900);
    expect(lyricWordProgress(lyrics.lines[0].words![0], 1150)).toBe(.5);
    expect(lyricWordProgress(lyrics.lines[0].words![0], 800)).toBe(0);
    expect(lyricWordProgress(lyrics.lines[0].words![0], 2000)).toBe(1);
  });
  it('parses word tags in structured local lines and keeps translations separate', () => {
    const doc: LyricDocument = { version: 1, source: 'local', recordId: 'song', tracks: [
      { role: 'original', offsetMs: -200, lines: [{ startMs: 1000, text: '<00:01>Hello <00:02>world<00:03>\n你好世界' }] },
    ] };
    const line = normalizeLyrics(doc).lines[0];
    expect(line.text).toBe('Hello world'); expect(line.translation).toEqual(['你好世界']);
    expect(line.words).toEqual([{ text: 'Hello ', startMs: 800, endMs: 1800 }, { text: 'world', startMs: 1800, endMs: 2800 }]);
  });
  it('keeps invalid word timelines readable and never invents timestamps for plain lyrics', () => {
    for (const text of ['[00:01]<00:02>hello<00:01>world', '[00:01]prefix <00:02>hello']) {
      const line = normalizeLyrics(document(text)).lines[0]; expect(line.words).toBeUndefined(); expect(line.text).not.toContain('<00:');
    }
    expect(normalizeLyrics(document('[00:01]普通逐行歌词')).lines[0]).toEqual({ text: '普通逐行歌词', startMs: 1000 });
    expect(lyricWordProgress({ text: '尾词', startMs: 1000 }, 1500, 2000)).toBe(.5);
    expect(normalizeLyrics(document('<00:01>只有<00:02>逐词')).lines[0].startMs).toBe(1000);
  });
  it('retains original word timing when a bilingual translation shares its text field', () => {
    const line = normalizeLyrics(document('[00:01]<00:01>Hello <00:02>world / 你好世界')).lines[0];
    expect(line.text).toBe('Hello world'); expect(line.translation).toEqual(['你好世界']);
    expect(line.words?.map((word) => word.text).join('')).toBe(line.text); expect(line.words?.[1].startMs).toBe(2000);
  });
});
describe('bilingual lyric normalization', () => {
  it.each([
    ['English', 'I', 'Hello world'], ['French', 'À bientôt', 'Écoute-moi'], ['Russian', 'Привет', 'Добрый вечер'],
    ['Greek', 'Καλημέρα', 'Σε αγαπώ'], ['Arabic', 'مرحبا', 'أحبك'], ['Thai', 'สวัสดี', 'ฉันรักคุณ'],
    ['Vietnamese', 'Ở đây', 'Tôi yêu em'], ['Korean', '안녕하세요', '사랑해요'],
  ])('groups four common bilingual formats for %s', (_language, first, second) => {
    const samples = [
      `[00:01]${first}  你好\n[00:03]${second}  世界`,
      `[00:01]${first}/ 你好\n[00:03]${second}／世界`,
      `[00:00]作词：示例\n[00:01]${first}\n[00:01]你好\n[00:02]\n[00:03]${second}\n[00:03]世界`,
      `[00:01]${first}\n[00:03]${second}\n[00:01.10]你好\n[00:03.10]世界`,
      `${first}\n${second}\n你好\n世界`,
    ];
    for (const sample of samples) {
      const lyrics = normalizeLyrics(document(sample));
      expect(lyrics.lines.find((line) => line.text === first)?.translation, sample).toEqual(['你好']);
      expect(lyrics.lines.find((line) => line.text === second)?.translation, sample).toEqual(['世界']);
    }
  });
  it('handles bilingual newlines inside structured tag fields with their original timestamps', () => {
    const doc: LyricDocument = { version: 1, source: 'local', recordId: 'song', tracks: [{ role: 'original', offsetMs: -100, lines: [{ text: 'Écoute-moi\r\n听我说', startMs: 1000 }, { text: 'Привет\n你好', startMs: 3000 }] }] };
    expect(normalizeLyrics(doc).lines).toEqual([{ text: 'Écoute-moi', startMs: 900, translation: ['听我说'] }, { text: 'Привет', startMs: 2900, translation: ['你好'] }]);
  });
  it('groups isolated well-formed lines and Japanese Han exceptions without losing unpaired text', () => {
    const result = normalizeLyrics(document('[00:01]こんにちは/你好\n[00:03]さようなら / 再见\n[00:05]夢/梦想\n[00:07]unpaired'));
    expect(result.lines.map((line) => line.text)).toEqual(['こんにちは', 'さようなら', '夢', 'unpaired']);
    expect(result.lines[2].translation).toEqual(['梦想']);
    expect(normalizeLyrics(document('Hello  my world    你好世界')).lines[0]).toEqual({ text: 'Hello  my world', translation: ['你好世界'] });
    expect(normalizeLyrics(document('hello / 你好\nnormal sentence')).lines[0].translation).toEqual(['你好']);
  });
  it('does not pair an incomplete static translation block by shifting all following lines', () => {
    const result = normalizeLyrics(document('hello\nworld\nagain\n你好\n世界'));
    expect(result.lines.map((line) => line.text)).toEqual(['hello', 'world', 'again', '你好', '世界']);
    expect(result.lines.some((line) => line.translation)).toBe(false);
  });
  it.each(['[00:00]纯音乐，请欣赏', '[00:00]此歌曲为没有填词的纯音乐，请您欣赏', '[00:00][Instrumental]', '[00:00]暂无歌词', '[00:00]No lyrics available', '[00:00]作曲：示例\n[00:01]'])('normalizes empty/placeholder lyrics to an empty body: %s', (text) => {
    expect(normalizeLyrics(document(text)).lines).toEqual([]);
  });
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
    for (const text of ['one  two\nthree  four', '夢 / 世界\n自由 / 孤独']) {
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
    expect(normalizeLyrics(raw).lines).toHaveLength(2);
    expect(normalizeLyrics(raw, edit('original')).lines).toHaveLength(4);
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
  it('accepts nearby editions and strong metadata without duration, but rejects other songs and versions', () => {
    expect(rankCandidates(track, [candidate])[0].confident).toBe(true);
    for (const change of [{ artists: ['Other'] }, { title: 'Song (Live)' }, { durationMs: 250000 }]) expect(rankCandidates(track, [{ ...candidate, ...change }])[0].confident).toBe(false);
    expect(rankCandidates(track, [{ ...candidate, durationMs: undefined }])[0].confident).toBe(true);
    expect(rankCandidates(track, [candidate, { ...candidate, id: '456', durationMs: 185000 }])[0].confident).toBe(true);
  });
  it('validates optional choices without allowing URLs, secrets or unknown schema fields', () => {
    expect(isLyricsSettings(defaultLyricsSettings)).toBe(true);
    const tracks = { song: { mode: 'qq', bindings: { qq: 'abc123' }, edits: { local: { layout: 'inline', hash: 'a', delayMs: -100, showTranslation: true } } } };
    expect(isLyricsSettings({ ...defaultLyricsSettings, tracks })).toBe(true);
    for (const choice of [{ mode: 'qq', token: 'secret' }, { mode: 'qq', bindings: { qq: 'https://example.test/path' } }, { mode: 'auto', edits: { local: { layout: 'bad', hash: 'a' } } }]) expect(isLyricsSettings({ ...defaultLyricsSettings, tracks: { song: choice } })).toBe(false);
    expect(isLyricsSettings({ ...defaultLyricsSettings, order: ['qq', 'qq'] })).toBe(false);
  });
  it.each([
    ['Ceui／小高光太郎／スミイ酸', ['Ceui']],
    ['Duca (デュッカ)', ['Duca']],
    ['Duca', ['デュッカ（Duca）']],
    ['Daniel Lanois / Daryl Johnson / Rhiannon Giddens', ['Daniel Lanois', 'Daryl Johnson', 'Rhiannon Giddens']],
    ['戸松遥、井口裕香、相坂优歌、五十嵐裕美、渕上舞、户田惠', ['戸松遥', '井口裕香', '相坂優歌', '五十嵐裕美', '渕上舞', '戸田めぐみ']],
    ['Singer feat. Guest', ['Guest']],
  ])('matches artist lists and aliases in the tag %s', (artist, artists) => {
    const local = { ...track, artists: [artist] };
    expect(rankCandidates(local, [{ ...candidate, artists }])[0].confident).toBe(true);
    expect(rankCandidates(local, [{ ...candidate, artists, durationMs: undefined }])[0].confident).toBe(true);
    expect(rankCandidates(local, [{ ...candidate, artists, title: 'Song (Live)' }])[0].confident).toBe(false);
    expect(rankCandidates(local, [{ ...candidate, artists, durationMs: 250000 }])[0].confident).toBe(false);
  });
  it('does not match a fragment of a band name or unrelated performers just because the title and time agree', () => {
    const local = { ...track, artists: ['AC/DC'] };
    expect(rankCandidates(local, [{ ...candidate, artists: ['AC/DC'] }])[0].confident).toBe(true);
    for (const artists of [['AC'], ['DC'], ['Other']]) expect(rankCandidates(local, [{ ...candidate, artists }])[0].confident).toBe(false);
  });
  it.each(['風になる (幻化成风)', '風になる（幻化成风）'])('matches a translated title and a platform-provided localized artist alias (%s)', (title) => {
    const local = { title, artists: ['辻亚弥乃'], durationMs: 276000 };
    const remote = { ...candidate, title: '風になる', artists: ['つじあやの'], durationMs: 276600 };
    expect(rankCandidates(local, [remote])[0].confident).toBe(false);
    expect(rankCandidates(local, [{ ...remote, artistAliases: ['Tsuji Ayano', '辻亚弥乃'] }])[0].confident).toBe(true);
    expect(rankCandidates(local, [{ ...remote, artistAliases: ['另一个歌手'] }])[0].confident).toBe(false);
    expect(rankCandidates(local, [{ ...remote, artistAliases: ['辻亚弥乃'], title: '風になる (Live)' }])[0].confident).toBe(false);
  });
  it('validates the optional platform alias field without requiring it from older responses', () => {
    expect(isCandidate(candidate)).toBe(true);
    expect(isCandidate({ ...candidate, artistAliases: ['别名'] })).toBe(true);
    for (const artistAliases of ['别名', [123], ['x'.repeat(257)], Array(21).fill('别名')]) expect(isCandidate({ ...candidate, artistAliases })).toBe(false);
  });
});
