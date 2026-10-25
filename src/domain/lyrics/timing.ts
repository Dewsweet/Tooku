import type { Lyrics } from '../models';
import { lyricIndex } from '../queue';
import type { LyricEdit } from './types';

// Audio uses seconds; source and user lyric delays use milliseconds.
export function lyricTiming(lyrics: Lyrics | undefined, position: number, globalDelayMs: number, edit?: LyricEdit) {
  const delayMs = (lyrics?.offsetMs ?? 0) + globalDelayMs + (edit?.delayMs ?? 0);
  const index = lyrics?.synced ? lyricIndex(lyrics.lines.map((line) => line.startMs), position * 1000 - delayMs) : -1;
  return { delayMs, index };
}

export function currentLyricLines(lyrics: Lyrics | undefined, index: number) {
  if (!lyrics) return [];
  // Untimed lyrics remain browsable; never invent a timeline for them.
  if (!lyrics.synced) return lyrics.lines;
  const current = lyrics.lines[index];
  if (!current) return [];
  let first = index;
  while (first > 0 && lyrics.lines[first - 1].startMs === current.startMs) first--;
  return lyrics.lines.slice(first, index + 1);
}
