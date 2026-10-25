import type { LyricWord } from '../models.ts';

const timestamp = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const milliseconds = (match: RegExpMatchArray) => Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number((match[3] ?? '').padEnd(3, '0'));

// Enhanced LRC uses absolute word timestamps. Never infer word timing from plain text.
export function parseLyricWords(text: string, offsetMs: number): { text: string; words?: LyricWord[] } {
  const matches = [...text.matchAll(timestamp)];
  if (!matches.length) return { text: text.trim() };
  const plain = text.replace(timestamp, '').trim();
  const words: LyricWord[] = [];
  // An untimed prefix or a backward timeline is still readable, but not animated.
  let valid = !text.slice(0, matches[0].index).trim();
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]; const next = matches[i + 1];
    const startMs = milliseconds(match) + offsetMs;
    const endMs = next ? milliseconds(next) + offsetMs : undefined;
    const value = text.slice(match.index + match[0].length, next?.index ?? text.length);
    if (Number(match[2]) >= 60 || endMs !== undefined && endMs < startMs) valid = false;
    if (value) words.push({ text: value, startMs, ...(endMs === undefined ? {} : { endMs }) });
  }
  if (!valid || !words.length) return { text: plain };
  words[0].text = words[0].text.trimStart(); words[words.length - 1].text = words.at(-1)!.text.trimEnd();
  return { text: plain, words: words.filter((word) => word.text) };
}

export function lyricWordProgress(word: LyricWord, timeMs: number, nextLineMs?: number) {
  if (timeMs < word.startMs) return 0;
  const end = word.endMs ?? nextLineMs;
  return end !== undefined && end > word.startMs ? Math.max(0, Math.min(1, (timeMs - word.startMs) / (end - word.startMs))) : 1;
}
