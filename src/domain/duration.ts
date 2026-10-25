import type { Track } from './models';

export function approximateDuration(value: number | Track[] | undefined, precision: 'minutes' | 'hours' = 'minutes') {
  const seconds = Array.isArray(value) ? value.reduce((sum, track) => sum + (track.duration ?? 0), 0) : value ?? 0;
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60)); const hours = Math.floor(minutes / 60); const remainder = minutes % 60;
  if (precision === 'hours') return seconds >= 3600 ? `约 ${Math.max(1, Math.round(seconds / 3600))} 小时` : `约 ${minutes} 分钟`;
  return `约 ${hours ? `${hours} 小时${remainder ? ' ' : ''}` : ''}${remainder ? `${remainder} 分钟` : ''}`;
}
