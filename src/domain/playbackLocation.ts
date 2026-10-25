import type { PlaybackSource, QueueEntry, Track } from './models';

export interface TrackLocation {
  identity: string; source: PlaybackSource; trackId: string; sourceIndex?: number;
}
export function playbackDestination(entry: QueueEntry, albumId = entry.track.albumId) {
  const source = entry.source?.kind === 'playlist' || entry.source?.kind === 'album'
    ? entry.source : albumId ? { kind: 'album' as const, id: albumId } : undefined;
  if (!source) return undefined;
  return {
    pathname: `/${source.kind === 'playlist' ? 'playlists' : 'albums'}/${encodeURIComponent(source.id)}`,
    source, trackId: entry.track.id,
    ...(source === entry.source && entry.sourceIndex !== undefined ? { sourceIndex: entry.sourceIndex } : {}),
  };
}
export function locateTrackIndex(tracks: Track[], trackId: string, sourceIndex?: number) {
  if (sourceIndex !== undefined && tracks[sourceIndex]?.id === trackId) return sourceIndex;
  // A source can have changed since playback began; find the nearest remaining occurrence.
  let found = -1;
  for (let index = 0; index < tracks.length; index++) {
    if (tracks[index].id === trackId && (found < 0 || sourceIndex !== undefined && Math.abs(index - sourceIndex) < Math.abs(found - sourceIndex))) found = index;
  }
  return found;
}
