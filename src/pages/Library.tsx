import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Play, Heart, Shuffle } from 'lucide-react';
import { AlbumGrid, Cover, Empty, PageTitle, QueryState, TrackList, useApi } from '../components/Common';
import { Playlists } from './Playlists';
import { useLibrary, useMusicLibrary } from '../state/library';
import { player } from '../features/player/engine';
import { queryClient, useSession, errorMessage } from '../state/session';
import type { Track } from '../domain/models';

export function Home({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const { libraryId, profile } = useMusicLibrary(); const view = profile.views[libraryId ?? ''] ?? 'playlists';
  return <><div className="library-home-tabs" role="tablist" aria-label="音乐库视图">{([['playlists','歌单'],['songs','歌曲'],['albums','专辑']] as const).map(([value,label]) => <button role="tab" aria-selected={view === value} key={value} onClick={() => libraryId && useLibrary.getState().change(api.identity, (p) => ({...p, views: {...p.views, [libraryId]: value}}))}>{label}</button>)}</div>{view === 'albums' ? <Albums /> : view === 'songs' ? <Songs addToPlaylist={addToPlaylist} /> : <Playlists />}</>;
}
export function Songs({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const { libraryId } = useMusicLibrary();
  const query = useInfiniteQuery({ queryKey: [api.identity, 'songs', libraryId], enabled: Boolean(libraryId), initialPageParam: 0, queryFn: ({pageParam,signal}) => api.songs(pageParam,signal,libraryId), getNextPageParam: (last,pages) => last.length === 50 ? pages.length * 50 : undefined });
  const songs = query.data?.pages.flat() ?? [];
  return <><PageTitle title="歌曲"><button className="primary-button" disabled={!songs.length} onClick={() => player.replace(songs)}><Play size={17} fill="currentColor" />播放</button></PageTitle><QueryState pending={query.isLoading} error={query.error} retry={() => query.refetch()} />{songs.length ? <TrackList tracks={songs} addToPlaylist={addToPlaylist} /> : query.data && <Empty title="还没有歌曲" />}{query.hasNextPage && <button className="load-more subtle-button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>加载更多</button>}</>;
}
export function Albums() {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const [type, setType] = useState('newest');
  const query = useInfiniteQuery({ queryKey: [api.identity, 'albums', libraryId, type], enabled: Boolean(libraryId), initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.albums(type, pageParam, signal, libraryId), getNextPageParam: (last, pages) => last.length === 30 ? pages.length * 30 : undefined });
  return <><PageTitle title="专辑"><select aria-label="专辑排序" value={type} onChange={(e) => setType(e.target.value)}><option value="newest">最近添加</option><option value="alphabeticalByName">专辑名称</option><option value="alphabeticalByArtist">歌手名称</option><option value="frequent">经常播放</option><option value="random">随机发现</option></select></PageTitle><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{query.data && <AlbumGrid albums={query.data.pages.flat()} />}{query.data && !query.data.pages[0].length && <Empty title="还没有专辑" />}{query.hasNextPage && <button className="load-more subtle-button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? '正在加载…' : '加载更多专辑'}</button>}</>;
}
export function AlbumDetail({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const { id = '' } = useParams(); const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: [api.identity, 'album', id], queryFn: ({ signal }) => api.album(id, signal) }); const album = query.data;
  async function star() { if (!album) return; setBusy(true); try { await api.star(album.id, Boolean(album.starred), 'album'); await queryClient.invalidateQueries({ queryKey: [api.identity] }); } catch (error) { useSession.getState().notify(errorMessage(error)); } finally { setBusy(false); } }
  return <><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{album && <><div className="detail-hero"><Cover id={album.coverArt} className="detail-cover" /><div><div className="eyebrow">专辑</div><h1>{album.name}</h1>{album.artistId ? <Link className="detail-artist" to={`/artists/${encodeURIComponent(album.artistId)}`}>{album.artist}</Link> : <p className="detail-artist">{album.artist}</p>}<p className="muted">{[album.year, `${album.songs.length} 首歌曲`].filter(Boolean).join(' · ')}</p><div className="button-row"><button className="primary-button" disabled={!album.songs.length} onClick={() => player.replace(album.songs)}><Play size={17} fill="currentColor" />播放全部</button><button className="subtle-button" disabled={!album.songs.length} onClick={() => { player.replace(album.songs); player.shuffle(); }}><Shuffle size={17} />随机播放</button><button className="subtle-button" disabled={busy} aria-pressed={Boolean(album.starred)} onClick={star}><Heart size={17} fill={album.starred ? 'currentColor' : 'none'} />{album.starred ? '已收藏' : '收藏'}</button></div></div></div><TrackList tracks={album.songs} addToPlaylist={addToPlaylist} /></>}</>;
}
export function Artists() {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const query = useQuery({ queryKey: [api.identity, 'artists', libraryId], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.artists(signal, libraryId) });
  return <><PageTitle title="歌手" /><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} /><div className="artist-grid">{query.data?.map((artist) => <Link to={`/artists/${encodeURIComponent(artist.id)}`} className="artist-card" key={artist.id}><Cover id={artist.coverArt} /><h3>{artist.name}</h3><p className="muted">{artist.albumCount ?? '—'} 张专辑</p></Link>)}</div>{query.data && !query.data.length && <Empty title="还没有歌手" />}</>;
}
export function ArtistDetail() {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const { id = '' } = useParams(); const query = useQuery({ queryKey: [api.identity, 'artist', id, libraryId], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.artist(id, signal, libraryId) }); const [busy, setBusy] = useState(false);
  const favorites = useQuery({ queryKey: [api.identity, 'favorites'], queryFn: ({ signal }) => api.favorites(signal) }); const starred = Boolean(favorites.data?.artists.some((a) => a.id === id));
  return <><PageTitle title={query.data?.name ?? '歌手'}><button className="subtle-button" disabled={busy} aria-pressed={starred} onClick={async () => { setBusy(true); try { await api.star(id, starred, 'artist'); await queryClient.invalidateQueries({ queryKey: [api.identity] }); } catch (e) { useSession.getState().notify(errorMessage(e)); } finally { setBusy(false); } }}><Heart size={17} fill={starred ? 'currentColor' : 'none'} />{starred ? '已收藏' : '收藏歌手'}</button></PageTitle><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{query.data && <AlbumGrid albums={query.data.albums} />}</>;
}
