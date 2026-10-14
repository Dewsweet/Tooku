import { Link } from 'react-router-dom';
import type { Track } from '../domain/models';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../state/session';

export function ArtistLinks({ track, resolve = false }: { track: Track; resolve?: boolean }) {
  const api = useSession((s) => s.api);
  const missing = !track.artistId && !track.artists?.some((a) => a.id);
  const query = useQuery({ queryKey: [api?.identity, 'song', track.id], enabled: Boolean(api && resolve && missing), queryFn: ({signal}) => api!.song(track.id, signal) });
  const source = resolve && missing && query.data?.id ? query.data : track;
  const artists = source.artists?.length ? source.artists : [{ id: source.artistId, name: source.artist }];
  return <>{artists.map((artist, index) => <span key={`${artist.id ?? artist.name}-${index}`}>{index > 0 && ' / '}{artist.id ? <Link to={`/artists/${encodeURIComponent(artist.id)}`} title={`查看歌手 ${artist.name}`}>{artist.name}</Link> : <span>{artist.name}</span>}</span>)}</>;
}
export function AlbumLink({ track, title = false }: { track: Track; title?: boolean }) {
  const text = title ? track.title : track.album ?? '—';
  return track.albumId ? <Link to={`/albums/${encodeURIComponent(track.albumId)}`} title={`查看专辑 ${track.album ?? track.title}`}>{text}</Link> : <span>{text}</span>;
}
