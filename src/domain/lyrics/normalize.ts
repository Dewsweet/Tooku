import type { Lyrics, LyricLine, LyricWord } from '../models.ts';
import type { LyricDocument, LyricEdit, RawLyricTrack } from './types.ts';
import { parseLyricWords } from './words.ts';

export function lyricHash(input: unknown) {
  let hash = 2166136261;
  for (const c of JSON.stringify(input)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|apos|#39|#(\d+)|#x([\da-f]+));/gi, (entity, dec, hex) => {
  const known: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
  const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : 0;
  return known[entity.toLowerCase()] ?? (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity);
});
export function parseLyricTrack(track: RawLyricTrack): LyricLine[] {
  const offset = track.offsetMs ?? 0;
  if (track.lines) return track.lines.flatMap((line) => decode(line.text).replace(/\r\n?/g, '\n').split('\n').map((text) => {
    const parsed = parseLyricWords(text, offset);
    return { ...parsed, ...(line.startMs === undefined ? parsed.words?.length ? { startMs: parsed.words[0].startMs } : {} : { startMs: line.startMs + offset }) };
  }));
  const text = decode(track.text ?? '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const embedded = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0);
  return text.split('\n').flatMap((raw) => {
    if (/^\s*\[(?:ar|ti|al|by|re|ve|length|offset|tool):/i.test(raw)) return [];
    const times = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const value = raw.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    const parsed = parseLyricWords(value, offset - embedded);
    if (!times.length) return parsed.text ? [{ ...parsed, ...(parsed.words?.length ? { startMs: parsed.words[0].startMs } : {}) }] : [];
    const firstTime = Number(times[0][1]) * 60000 + Number(times[0][2]) * 1000 + Number((times[0][3] ?? '').padEnd(3, '0'));
    return times.map((m) => {
      const time = Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] ?? '').padEnd(3, '0'));
      const shift = time - firstTime;
      return { ...parsed, ...(parsed.words ? { words: parsed.words.map((word) => ({ ...word, startMs: word.startMs + shift, ...(word.endMs === undefined ? {} : { endMs: word.endMs + shift }) })) } : {}), startMs: time - embedded + offset };
    });
  });
}
// Han alone cannot distinguish Japanese from Chinese. All other letter scripts,
// including accented Latin, Cyrillic, Greek, Arabic and Thai, can supply evidence.
const chinese = (text: string) => /\p{Script=Han}/u.test(text) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
const foreign = (text: string) => [...text].some((char) => /\p{L}/u.test(char) && !/\p{Script=Han}/u.test(char));
const originalLike = (text: string) => foreign(text) && !chinese(text);
const credit = (text: string) => /^(?:作词|作曲|编曲|演唱|歌手|制作人?|混音|录音|母带|翻译|译者|歌词|词|曲|lyrics|composer|artist)\s*[:：]/i.test(text);
const marker = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const instrumental = (text: string) => /^(?:纯音乐(?:请欣赏)?|此歌曲为没有填词的纯音乐(?:请您欣赏)?|instrumental(?:only)?|instrumentaltrack)$/.test(marker(text));
const noLyrics = (text: string) => /^(?:暂无歌词|无歌词|没有歌词|此歌曲暂无歌词|该音乐没有歌词(?:请欣赏)?|nolyrics(?:available|found)?)$/.test(marker(text));
const content = (line: LyricLine) => Boolean(line.text.trim()) && !credit(line.text);

function originalWords(words: LyricWord[] | undefined, text: string) {
  if (!words || !words.map((word) => word.text).join('').startsWith(text)) return undefined;
  let remaining = text.length;
  return words.flatMap((word) => {
    if (remaining <= 0) return [];
    const value = word.text.slice(0, remaining); remaining -= value.length;
    return [{ ...word, text: value }];
  });
}

function inlineParts(text: string, separator?: string, manual = false, allowHan = false) {
  if (separator) {
    const parts = text.split(separator).map((part) => part.trim());
    return parts.length === 2 && parts.every(Boolean) ? parts : null;
  }
  const candidates = [...text.matchAll(/\s*[/／]\s*|[ \t\u3000]{2,}/g)].map((match) => [text.slice(0, match.index).trim(), text.slice(match.index + match[0].length).trim()]).filter((parts) => parts.every(Boolean));
  if (manual) return candidates.at(-1) ?? null;
  return candidates.reverse().find((parts) => (originalLike(parts[0]) || allowHan && chinese(parts[0])) && chinese(parts[1])) ?? null;
}
function attach(base: LyricLine[], other: LyricLine[], role: 'translation' | 'romanization') {
  const targets = base.filter((line) => line.text.trim());
  const used = new Set<number>();
  const times = [...new Set(targets.flatMap((line) => line.startMs === undefined ? [] : [line.startMs]))].sort((a, b) => a - b);
  const tolerances = new Map(times.map((time, i) => [time, Math.min(300, ...[times[i - 1], times[i + 1]].filter((n) => n !== undefined).map((n) => Math.abs(n - time) / 3))]));
  let previousTime: number | undefined; let previousIndex = -1;
  for (const [order, line] of other.entries()) {
    if (!line.text.trim()) continue;
    let index = -1; let distance = Infinity;
    if (line.startMs !== undefined && line.startMs === previousTime && previousIndex >= 0) index = previousIndex;
    else if (line.startMs !== undefined) targets.forEach((target, i) => {
      if (used.has(i) || target.startMs === undefined) return;
      const difference = Math.abs(target.startMs - line.startMs!);
      if (difference <= (tolerances.get(target.startMs) ?? 300) && difference < distance) { index = i; distance = difference; }
    });
    else if (targets.every((target) => target.startMs === undefined) && targets.length === other.length) index = order;
    if (index >= 0) { used.add(index); targets[index][role] = [...(targets[index][role] ?? []), line.text]; }
    else if (role === 'translation') base.push({ text: line.text, startMs: line.startMs });
    previousTime = line.startMs; previousIndex = index;
  }
}
function halves(lines: LyricLine[], splitAt?: number, manual = false) {
  const populated = lines.filter(content);
  if (!manual && (populated.length < 4 || populated.length % 2)) return false;
  const cut = manual ? splitAt ?? Math.floor(lines.length / 2) : lines.indexOf(populated[populated.length / 2]);
  if (cut < 1 || cut >= lines.length) return false;
  const left = lines.slice(0, cut); const right = lines.slice(cut);
  if (!manual) {
    const before = left.filter(content); const after = right.filter(content);
    const languages = before.filter((part) => originalLike(part.text)).length >= before.length * .65 && after.every((part) => chinese(part.text));
    const timed = populated.some((part) => part.startMs !== undefined);
    const rewind = after[0].startMs !== undefined && before.at(-1)?.startMs !== undefined && after[0].startMs < before.at(-1)!.startMs!;
    if (!languages || timed && !rewind) return false;
  }
  if (manual) {
    left.forEach((line, i) => { if (right[i]) line.translation = [right[i].text]; });
    lines.splice(0, lines.length, ...left, ...right.slice(left.length));
  } else {
    const originals = left.filter(content); const translations = right.filter(content);
    if (originals.every((line) => line.startMs === undefined) && translations.every((line) => line.startMs === undefined)) originals.forEach((line, i) => { line.translation = [translations[i].text]; });
    else attach(left, translations, 'translation');
    lines.splice(0, lines.length, ...left, ...right.filter((line) => line.text.trim() && credit(line.text)));
  }
  return true;
}
function bilingual(lines: LyricLine[], edit?: LyricEdit) {
  const layout = edit?.layout ?? 'auto';
  if (layout === 'original') return;
  if (layout === 'halves') { halves(lines, edit?.splitAt, true); return; }
  if (layout === 'alternating') {
    const grouped: LyricLine[] = [];
    for (let i = 0; i < lines.length; i += 2) grouped.push({ ...lines[i], ...(lines[i + 1] ? { translation: [lines[i + 1].text] } : {}) });
    lines.splice(0, lines.length, ...grouped); return;
  }
  const populated = lines.filter(content);
  const strong = populated.filter((line) => inlineParts(line.text)).length;
  const delimited = populated.filter((line) => inlineParts(line.text, undefined, true)).length;
  const allowHan = strong >= 2 && strong >= delimited * .6;
  for (const line of lines) {
    const parts = inlineParts(line.text, edit?.separator, layout === 'inline', allowHan);
    if (parts) {
      line.text = parts[0]; line.translation = [parts[1]];
      // Inline translations do not share the original word clock.
      if (line.words) { const words = originalWords(line.words, line.text); if (words?.length) line.words = words; else delete line.words; }
    }
  }
  if (layout === 'inline') return;
  if (!lines.some((line) => line.translation) && halves(lines)) return;
  const adjacent = populated.slice(0, -1).filter((line, i) => originalLike(line.text) && chinese(populated[i + 1].text)).length;
  const consistent = adjacent >= 2 && adjacent >= populated.length / 2 * .7;
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i]; if (!content(current) || current.translation) continue;
    let next = i + 1; while (next < lines.length && !lines[next].text.trim()) next++;
    const translation = lines[next]; if (!translation || !chinese(translation.text)) continue;
    const sameTime = current.startMs !== undefined && current.startMs === translation.startMs;
    const source = originalLike(current.text) || consistent && sameTime && chinese(current.text);
    const near = current.startMs === undefined || translation.startMs === undefined || Math.abs(current.startMs - translation.startMs) <= 300;
    const timedPair = current.startMs !== undefined && translation.startMs !== undefined && near;
    if (source && (timedPair || consistent || populated.length === 2 && near)) { current.translation = [translation.text]; lines.splice(next, 1); }
  }
}
export function normalizeLyrics(document: LyricDocument, edit?: LyricEdit): Lyrics {
  const originals = document.tracks.filter((track) => track.role === 'original').flatMap(parseLyricTrack);
  const translations = document.tracks.filter((track) => track.role === 'translation').flatMap(parseLyricTrack);
  const romanization = document.tracks.filter((track) => track.role === 'romanization').flatMap(parseLyricTrack);
  const sourceLines = [...originals, ...translations].filter((line) => line.text.trim());
  const isInstrumental = document.instrumental || sourceLines.some((line) => instrumental(line.text));
  const lines = originals.filter((line) => !instrumental(line.text) && !noLyrics(line.text)).map((line) => ({ ...line }));
  if (!translations.length) bilingual(lines, edit);
  lines.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  attach(lines, translations.filter((line) => !instrumental(line.text) && !noLyrics(line.text)), 'translation');
  attach(lines, romanization, 'romanization');
  lines.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  if (!lines.some(content)) lines.length = 0;
  return { lines, synced: lines.some((line) => line.startMs !== undefined), offsetMs: 0, instrumental: isInstrumental && !lines.some(content), document };
}
