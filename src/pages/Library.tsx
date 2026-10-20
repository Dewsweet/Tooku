import { ArtistGrid } from '../components/ArtistGrid';
import { AutoLoadMore } from '../components/AutoLoadMore';
import { Select } from '../components/Select';
import { useCallback, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Play, Heart, Shuffle } from 'lucide-react';
import { AlbumGrid, Cover, Empty, PageTitle, QueryState, TrackList, useApi } from '../components/Common';
import { useMusicLibrary } from '../state/library';
import { player } from '../features/player/engine';
import { queryClient, useSession, errorMessage } from '../state/session';
import type { Track } from '../domain/models';
import { approximateDuration } from '../domain/duration';
import './album-browse.css';

export { ArtistDetail } from './ArtistDetail';

export function Albums() {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const [params] = useSearchParams(); const [type, setType] = useState(params.get('sort') === 'frequent' ? 'frequent' : 'newest');
  const query = useInfiniteQuery({ queryKey: [api.identity, 'albums', libraryId, type], enabled: Boolean(libraryId), initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.albums(type, pageParam, signal, libraryId), getNextPageParam: (last, pages, offset) => {
      if (last.length < 30) return undefined;
      const seen = new Set(pages.slice(0, -1).flatMap((page) => page.map((album) => album.id)));
      return last.some((album) => !seen.has(album.id)) ? offset + last.length : undefined;
    } });
  const { fetchNextPage, hasNextPage, isFetching, isError } = query;
  const loadNext = useCallback(() => { if (hasNextPage && !isFetching && !isError) void fetchNextPage({ cancelRefetch: false }); }, [fetchNextPage, hasNextPage, isFetching, isError]);
  const albums = [...new Map(query.data?.pages.flat().map((album) => [album.id, album])).values()];
  return <div className="album-browse">
    <PageTitle title="专辑"><Select aria-label="专辑排序" value={type} onChange={setType}>
      <option value="newest">最近添加</option><option value="alphabeticalByName">专辑名称</option>
      <option value="alphabeticalByArtist">歌手名称</option><option value="frequent">经常播放</option><option value="random">随机发现</option>
    </Select></PageTitle>
    <QueryState pending={query.isLoading} error={!query.data ? query.error : null} retry={() => query.refetch()} />
    {query.data && <AlbumGrid albums={albums} />}
    {query.data && !albums.length && <Empty title="还没有专辑" />}
    <AutoLoadMore enabled={Boolean(query.hasNextPage && !query.isFetching && !query.isError)} load={loadNext} />
    <QueryState pending={query.isFetchingNextPage} error={query.data ? query.error : null} retry={() => query.isFetchNextPageError ? query.fetchNextPage() : query.refetch()} />
  </div>;
}
export function AlbumDetail({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const { id = '' } = useParams(); const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: [api.identity, 'album', id], queryFn: ({ signal }) => api.album(id, signal) }); const album = query.data;
  async function star() { if (!album) return; setBusy(true); try { await api.star(album.id, Boolean(album.starred), 'album'); await queryClient.invalidateQueries({ queryKey: [api.identity] }); } catch (error) { useSession.getState().notify(errorMessage(error)); } finally { setBusy(false); } }
  return <><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{album && <><div className="detail-hero"><Cover id={album.coverArt} className="detail-cover" /><div><div className="eyebrow">专辑</div><h1>{album.name}</h1>{album.artistId ? <Link className="detail-artist" to={`/artists/${encodeURIComponent(album.artistId)}`}>{album.artist}</Link> : <p className="detail-artist">{album.artist}</p>}<p className="muted">{[album.year, `${album.songs.length} 首歌曲`, approximateDuration(album.duration ?? album.songs)].filter(Boolean).join(' · ')}</p><div className="button-row"><button className="primary-button" disabled={!album.songs.length} onClick={() => player.replace(album.songs)}><Play size={17} fill="currentColor" />播放全部</button><button className="subtle-button" disabled={!album.songs.length} onClick={() => { player.replace(album.songs, Math.floor(Math.random() * album.songs.length)); player.shuffle(); }}><Shuffle size={17} />随机播放</button><button className="subtle-button" disabled={busy} aria-pressed={Boolean(album.starred)} onClick={star}><Heart size={17} fill={album.starred ? 'currentColor' : 'none'} />{album.starred ? '已收藏' : '收藏'}</button></div></div></div><TrackList tracks={album.songs} addToPlaylist={addToPlaylist} /></>}</>;
}
export function Artists() {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const query = useQuery({ queryKey: [api.identity, 'artists', libraryId], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.artists(signal, libraryId) });
  return <><PageTitle title="歌手" /><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} /><ArtistGrid artists={query.data ?? []} />{query.data && !query.data.length && <Empty title="还没有歌手" />}</>;
}
