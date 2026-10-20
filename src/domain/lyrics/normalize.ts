import type { Lyrics, LyricLine } from '../models.ts';
import type { LyricDocument, LyricEdit, RawLyricTrack } from './types.ts';

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
  if (track.lines) return track.lines.map((l) => ({ ...l, ...(l.startMs === undefined ? {} : { startMs: l.startMs + offset }) }));
  const text = decode(track.text ?? '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const embedded = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0);
  return text.split('\n').flatMap((raw) => {
    if (/^\s*\[(?:ar|ti|al|by|re|ve|length|offset|tool):/i.test(raw)) return [];
    const times = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const value = raw.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    if (!times.length) return value ? [{ text: value }] : [];
    return times.map((m) => ({ text: value, startMs: Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] ?? '').padEnd(3, '0')) - embedded + offset }));
  });
}
// Script hints alone are insufficient: Japanese also contains Han characters.
const chinese = (s: string) => /\p{Script=Han}/u.test(s) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s);
const foreign = (s: string) => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z]{2}/u.test(s);
function inlineParts(text: string, separator?: string) {
  const parts = separator ? text.split(separator) : text.split(/\s+\/\s+|[ \t\u3000]{2,}/);
  return parts.length === 2 && parts.every((p) => p.trim()) ? parts.map((p) => p.trim()) : null;
}
function attach(base: LyricLine[], other: LyricLine[], role: 'translation' | 'romanization') {
  const used = new Set<number>();
  const targets = base.slice();
  const times = [...new Set(targets.flatMap((l) => l.startMs === undefined ? [] : [l.startMs]))].sort((a, b) => a - b);
  const tolerances = new Map(times.map((time, i) => [time, Math.min(300, ...[times[i - 1], times[i + 1]].filter((n) => n !== undefined).map((n) => Math.abs(n - time) / 3))]));
  for (const line of other) {
    if (!line.text.trim()) continue;
    let index = -1; let distance = Infinity;
    if (line.startMs !== undefined) targets.forEach((target, i) => {
      if (used.has(i) || target.startMs === undefined) return;
      const difference = Math.abs(target.startMs - line.startMs!);
      const tolerance = tolerances.get(target.startMs) ?? 300;
      if (difference <= tolerance && difference < distance) { index = i; distance = difference; }
    });
    else if (targets.every((l) => l.startMs === undefined) && targets.length === other.length) index = other.indexOf(line);
    if (index >= 0) { used.add(index); base[index][role] = [...(base[index][role] ?? []), line.text]; }
    else if (role === 'translation') base.push({ text: line.text, startMs: line.startMs });
  }
}
export function normalizeLyrics(document: LyricDocument, edit?: LyricEdit): Lyrics {
  const originals = document.tracks.filter((t) => t.role === 'original').flatMap(parseLyricTrack);
  const translations = document.tracks.filter((t) => t.role === 'translation').flatMap(parseLyricTrack);
  const romanization = document.tracks.filter((t) => t.role === 'romanization').flatMap(parseLyricTrack);
  const lines = originals.filter((l) => l.text.trim() || l.startMs !== undefined).map((l) => ({ ...l }));
  const layout = edit?.layout ?? 'auto';
  if (!translations.length && layout !== 'original') {
    const populated = lines.filter((l) => l.text.trim());
    const pairs = populated.map((l) => inlineParts(l.text, edit?.separator));
    const reliableInline = pairs.length > 1 && pairs.filter((p) => p && foreign(p[0]) && chinese(p[1])).length >= pairs.length * .8;
    if (layout === 'inline' || layout === 'auto' && reliableInline) {
      for (const line of lines) { const pair = inlineParts(line.text, edit?.separator); if (pair && (layout === 'inline' || foreign(pair[0]) && chinese(pair[1]))) { line.text = pair[0]; line.translation = [pair[1]]; } }
    } else {
      const half = edit?.splitAt ?? Math.floor(lines.length / 2);
      const left = lines.slice(0, half); const right = lines.slice(half);
      const halves = left.length > 1 && left.length === right.length && left.every((l) => foreign(l.text)) && right.every((l) => chinese(l.text)) && left.every((l, i) => l.startMs !== undefined && l.startMs === right[i].startMs);
      const alternating = lines.length >= 4 && lines.length % 2 === 0 && lines.every((l, i) => i % 2 ? chinese(l.text) : foreign(l.text)) && lines.every((l, i) => !(i % 2) || l.startMs === undefined || l.startMs === lines[i - 1].startMs);
      if (layout === 'halves' || layout === 'auto' && halves) {
        if (left.length === right.length) { left.forEach((l, i) => { l.translation = [right[i].text]; }); lines.splice(0, lines.length, ...left); }
      } else if (layout === 'alternating' || layout === 'auto' && alternating) {
        const grouped: LyricLine[] = [];
        for (let i = 0; i < lines.length; i += 2) grouped.push({ ...lines[i], ...(lines[i + 1] ? { translation: [lines[i + 1].text] } : {}) });
        lines.splice(0, lines.length, ...grouped);
      }
    }
  }
  lines.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  attach(lines, translations, 'translation'); attach(lines, romanization, 'romanization');
  // Same timestamp original/translation pairs also occur interleaved among blank cues.
  if (layout === 'auto' && !translations.length) for (let i = lines.length - 1; i > 0; i--) {
    const previous = lines[i - 1]; const current = lines[i];
    if (previous.startMs !== undefined && previous.startMs === current.startMs && foreign(previous.text) && chinese(current.text) && !previous.translation) { previous.translation = [current.text]; lines.splice(i, 1); }
  }
  lines.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  return { lines, synced: lines.some((l) => l.startMs !== undefined), offsetMs: 0, instrumental: document.instrumental, document };
}
