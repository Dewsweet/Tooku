import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { locateTrackIndex, type TrackLocation } from '../domain/playbackLocation';
import { isPlaybackSource, isSourceIndex } from '../domain/userData';
import type { PlaybackSource, Track } from '../domain/models';

function readLocation(state: unknown): TrackLocation | undefined {
  if (!state || typeof state !== 'object' || !('tookuTrack' in state)) return;
  const target = state.tookuTrack;
  if (!target || typeof target !== 'object' || !('identity' in target) || typeof target.identity !== 'string'
    || !('source' in target) || !isPlaybackSource(target.source) || !('trackId' in target) || typeof target.trackId !== 'string') return;
  return { identity: target.identity, source: target.source, trackId: target.trackId,
    ...('sourceIndex' in target && isSourceIndex(target.sourceIndex) ? { sourceIndex: target.sourceIndex } : {}) };
}
export function useTrackLocation(tracks: Track[], source: PlaybackSource | undefined, identity: string) {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const handled = useRef<string | undefined>(undefined);
  const target = readLocation(location.state);
  const index = target?.identity === identity && source?.kind === target.source.kind && source?.id === target.source.id
    ? locateTrackIndex(tracks, target.trackId, target.sourceIndex) : -1;
  useEffect(() => {
    if (index < 0 || handled.current === location.key) return;
    // Let the workspace route reset finish before positioning its own scroll viewport.
    const frame = requestAnimationFrame(() => {
      const row = ref.current?.querySelector<HTMLElement>(`[data-track-index="${index}"]`);
      const viewport = row?.closest<HTMLElement>('.content');
      if (!row || !viewport) return;
      const top = viewport.scrollTop + row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (viewport.clientHeight - row.offsetHeight) / 2;
      viewport.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      row.focus({ preventScroll: true });
      handled.current = location.key;
    });
    return () => cancelAnimationFrame(frame);
  }, [index, location.key]);
  return { ref, locatedIndex: index };
}
