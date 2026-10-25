import { playbackDestination } from '../domain/playbackLocation';
import { Link } from 'react-router-dom';
import type { QueueEntry, Track } from '../domain/models';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../state/session';

export function ArtistLinks({ track, resolve = false }: { track: Track; resolve?: boolean }) {
  const api = useSession((s) => s.api);
  const missing = !track.artistId && !track.artists?.some((a) => a.id);
  const query = useQuery({ queryKey: [api?.identity, 'song', track.id], enabled: Boolean(api && resolve && missing), queryFn: ({signal}) => api!.song(track.id, signal) });
  const source = resolve && missing && query.data?.id ? query.data : track;
  const artists = source.artists?.length ? source.artists : [{ id: source.artistId, name: source.artist }];
  return <>{artists.map((artist, index) => <span key={`${artist.id ?? artist.name}-${index}`}>{index > 0 && ' / '}{artist.id ? <Link to={`/artists/${encodeURIComponent(artist.id)}`}>{artist.name}</Link> : <span>{artist.name}</span>}</span>)}</>;
}
export function AlbumLink({ track, title = false }: { track: Track; title?: boolean }) {
  const text = title ? track.title : track.album ?? '—';
  return track.albumId ? <Link to={`/albums/${encodeURIComponent(track.albumId)}`}>{text}</Link> : <span>{text}</span>;
}

export function PlaybackSourceLink({ entry }: { entry: QueueEntry }) {
  const api = useSession((state) => state.api);
  const knownSource = entry.source?.kind === 'album' || entry.source?.kind === 'playlist';
  const detail = useQuery({ queryKey: [api?.identity, 'song', entry.track.id],
    enabled: Boolean(api && !knownSource && !entry.track.albumId),
    queryFn: ({ signal }) => api!.song(entry.track.id, signal),
  });
  const destination = playbackDestination(entry, entry.track.albumId ?? detail.data?.albumId);
  return destination && api ? <Link to={destination.pathname} state={{ tookuTrack: {
    identity: api.identity, source: destination.source, trackId: destination.trackId, sourceIndex: destination.sourceIndex,
  } }}>{entry.track.title}</Link> : <span>{entry.track.title}</span>;
}
