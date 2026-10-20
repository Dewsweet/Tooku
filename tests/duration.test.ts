import { expect, it } from 'vitest';
import { approximateDuration } from '../src/domain/duration';

it('uses only approximate hours for long playlists and minutes for short playlists', () => {
  expect(approximateDuration(3600 + 23 * 60, 'hours')).toBe('约 1 小时');
  expect(approximateDuration(194 * 3600 + 50 * 60, 'hours')).toBe('约 195 小时');
  expect(approximateDuration(35 * 60, 'hours')).toBe('约 35 分钟');
  expect(approximateDuration(3599, 'hours')).toBe('约 60 分钟');
  expect(approximateDuration([{ id: 'a', title: '重复', artist: '歌手', duration: 3600 }, { id: 'a', title: '重复', artist: '歌手', duration: 3600 }], 'hours')).toBe('约 2 小时');
});

it('keeps album precision and does not invent durations for missing data', () => {
  expect(approximateDuration(3600 + 23 * 60)).toBe('约 1 小时 23 分钟');
  expect(approximateDuration(undefined, 'hours')).toBe('');
  expect(approximateDuration(0, 'hours')).toBe('');
  expect(approximateDuration(Number.NaN, 'hours')).toBe('');
});
