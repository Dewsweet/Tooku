import { ArtistGrid } from '../components/ArtistGrid';
import { DensityGrid, GridDensitySelect } from '../components/GridDensity';
import { PlaybackButtons } from '../components/PlaybackButtons';
import { Select } from '../components/Select';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { AlbumGrid, Cover, Empty, IconButton, PageTitle, QueryState, TrackList, useApi } from '../components/Common';
import { useMusicLibrary } from '../state/library';
import { player } from '../features/player/engine';
import { queryClient, useSession, errorMessage } from '../state/session';
import type { Track } from '../domain/models';
import { approximateDuration } from '../domain/duration';
import './album-browse.css';

export { ArtistDetail } from './ArtistDetail';

export function Albums() {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const [params] = useSearchParams(); const [type, setType] = useState(params.get('sort') === 'frequent' ? 'frequent' : 'newest');
  const query = useQuery({ queryKey: [api.identity, 'all-albums', libraryId, type], enabled: Boolean(libraryId),
    queryFn: ({ signal }) => api.allAlbums(type, signal, libraryId) });
  const albums = query.data ?? [];
  return <div className="album-browse" data-density-layout="albums">
    <PageTitle title="专辑"><div className="browse-controls"><Select aria-label="专辑排序" value={type} onChange={setType}>
      <option value="newest">最近添加</option><option value="alphabeticalByName">专辑名称</option>
      <option value="alphabeticalByArtist">歌手名称</option><option value="frequent">经常播放</option><option value="random">随机发现</option>
    </Select><GridDensitySelect kind="albums" /></div></PageTitle>
    <QueryState pending={query.isLoading} error={query.error} retry={() => query.refetch()} />
    {query.data && <DensityGrid kind="albums"><AlbumGrid albums={albums} /></DensityGrid>}
    {query.data && !albums.length && <Empty title="还没有专辑" />}
  </div>;
}
export function AlbumDetail({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const { id = '' } = useParams(); const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: [api.identity, 'album', id], queryFn: ({ signal }) => api.album(id, signal) }); const album = query.data;
  async function star() { if (!album) return; setBusy(true); try { await api.star(album.id, Boolean(album.starred), 'album'); await queryClient.invalidateQueries({ queryKey: [api.identity] }); } catch (error) { useSession.getState().notify(errorMessage(error)); } finally { setBusy(false); } }
  return <><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{album && <><div className="detail-hero"><Cover id={album.coverArt} className="detail-cover" /><div><div className="eyebrow">专辑</div><h1>{album.name}</h1>{album.artistId ? <Link className="detail-artist" to={`/artists/${encodeURIComponent(album.artistId)}`}>{album.artist}</Link> : <p className="detail-artist">{album.artist}</p>}<p className="muted">{[album.year, `${album.songs.length} 首歌曲`, approximateDuration(album.duration ?? album.songs)].filter(Boolean).join(' · ')}</p><div className="button-row entity-controls"><PlaybackButtons disabled={!album.songs.length} play={() => player.replace(album.songs, 0, { source: { kind: 'album', id } })} shuffle={() => player.replace(album.songs, Math.floor(Math.random() * album.songs.length), { source: { kind: 'album', id }, shuffle: true })} shuffleLabel="随机播放专辑" /><IconButton label={album.starred ? '取消收藏专辑' : '收藏专辑'} disabled={busy} aria-pressed={Boolean(album.starred)} onClick={star}><Heart size={21} fill={album.starred ? 'currentColor' : 'none'} /></IconButton></div></div></div><TrackList tracks={album.songs} source={{ kind: 'album', id }} addToPlaylist={addToPlaylist} /></>}</>;
}
export function Artists() {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const query = useQuery({ queryKey: [api.identity, 'artists', libraryId], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.artists(signal, libraryId) });
  return <div data-density-layout="artists"><PageTitle title="歌手"><GridDensitySelect kind="artists" /></PageTitle><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} /><DensityGrid kind="artists"><ArtistGrid artists={query.data ?? []} /></DensityGrid>{query.data && !query.data.length && <Empty title="还没有歌手" />}</div>;
}
