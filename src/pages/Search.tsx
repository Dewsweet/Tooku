import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, ListMusic, Play, Plus, Search as SearchIcon } from 'lucide-react';
import { AlbumGrid, Cover, Empty, IconButton, QueryState, useApi } from '../components/Common';
import { EntityArtwork } from '../components/EntityArtwork';
import { ArtistLinks } from '../components/TrackLinks';
import { playlistPlacement, useMusicLibrary } from '../state/library';
import { errorMessage, useSession } from '../state/session';
import { player } from '../features/player/engine';
import type { Track } from '../domain/models';

const filters = [['all', '全部'], ['playlists', '歌单'], ['artists', '歌手'], ['songs', '歌曲'], ['albums', '专辑']] as const;
export function Search({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const { libraryId, profile, defaultId } = useMusicLibrary(); const [params, setParams] = useSearchParams(); const term = params.get('q')?.trim() ?? '';
  const filter = filters.some(([id]) => id === params.get('type')) ? params.get('type')! : 'all'; const [busy, setBusy] = useState<string | null>(null);
  const query = useInfiniteQuery({ queryKey: [api.identity, 'search', term, libraryId], enabled: Boolean(term && libraryId), initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.search(term, pageParam, signal, libraryId), getNextPageParam: (last, pages) => Math.max(last.songs.length, last.albums.length, last.artists.length) === 30 ? pages.length * 30 : undefined });
  const browseSongs = useInfiniteQuery({ queryKey: [api.identity, 'browse-songs', libraryId], enabled: Boolean(!term && filter === 'songs' && libraryId), initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.songs(pageParam, signal, libraryId), getNextPageParam: (last, pages) => last.length === 50 ? pages.length * 50 : undefined });
  const playlists = useQuery({ queryKey: [api.identity, 'playlists'], queryFn: ({ signal }) => api.playlists(signal) });
  const recent = useQuery({ queryKey: [api.identity, 'home', libraryId, 'newest'], enabled: Boolean(!term && filter !== 'songs' && filter !== 'playlists' && libraryId), queryFn: ({ signal }) => api.albums('newest', 0, signal, libraryId) });
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()];
  const songs = unique(term ? query.data?.pages.flatMap((p) => p.songs) ?? [] : browseSongs.data?.pages.flat() ?? []);
  const albums = unique(query.data?.pages.flatMap((p) => p.albums) ?? []); const artists = unique(query.data?.pages.flatMap((p) => p.artists) ?? []);
  const lists = playlists.data?.filter((p) => playlistPlacement(profile, p.id, defaultId ?? '').libraryId === libraryId && (!term || p.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) ?? [];
  const featured = filter === 'all' && term ? artists[0] : undefined;
  const loading = term ? query.isLoading : filter === 'songs' ? browseSongs.isLoading : false; const error = term ? query.error : filter === 'songs' ? browseSongs.error : null;
  const show = (type: string) => filter === 'all' || filter === type;
  const hasResults = Boolean(show('songs') && songs.length || show('albums') && albums.length || show('artists') && artists.length || show('playlists') && lists.length);
  const page = term ? query : browseSongs;
  async function playPlaylist(id: string) {
    if (busy) return; setBusy(id);
    try { const data = await api.playlist(id); if (data.songs.length) player.replace(data.songs, 0, { source: { kind: 'playlist', id } }); else useSession.getState().notify('这张歌单还没有歌曲。'); }
    catch (e) { useSession.getState().notify(errorMessage(e)); } finally { setBusy(null); }
  }
  return <div className="search-page"><div className="search-filters" role="group" aria-label="搜索分类">{filters.map(([id, name]) => <button key={id} aria-pressed={filter === id} onClick={() => { const next = new URLSearchParams(params); if (id === 'all') next.delete('type'); else next.set('type', id); setParams(next, { replace: true }); }}>{name}</button>)}</div>
    {featured && <section className="search-spotlight"><Link className="search-spotlight-person" to={`/artists/${encodeURIComponent(featured.id)}`}><EntityArtwork id={featured.id} name={featured.name} kind="artist" coverArt={featured.coverArt} /><span><h1>{featured.name}</h1><span>歌手</span></span></Link><Link className="subtle-button" to={`/artists/${encodeURIComponent(featured.id)}`}>查看歌手<ArrowUpRight size={17} /></Link></section>}
    <QueryState pending={loading} error={error} retry={() => term ? query.refetch() : browseSongs.refetch()} />
    {(term || filter === 'songs' || filter === 'playlists') && <div className="search-results" role="list" aria-label="搜索结果">
      {show('playlists') && lists.slice(0, filter === 'all' ? 5 : undefined).map((list) => <article className="search-result-row" role="listitem" key={`playlist-${list.id}`}><Link className="search-row-art" to={`/playlists/${encodeURIComponent(list.id)}`}><EntityArtwork id={list.id} name={list.name} kind="playlist" coverArt={list.coverArt} /></Link><div className="search-row-copy"><Link to={`/playlists/${encodeURIComponent(list.id)}`}>{list.name}</Link><span>{list.owner ?? '我的歌单'} · {list.songCount ?? 0} 首</span></div><span className="search-kind">歌单</span><IconButton label={`播放歌单 ${list.name}`} disabled={Boolean(busy)} onClick={() => playPlaylist(list.id)}><Play size={18} fill="currentColor" /></IconButton></article>)}
      {show('songs') && songs.slice(0, filter === 'all' ? 8 : undefined).map((song, index) => <article className="search-result-row" role="listitem" key={`song-${song.id}`}><button className="search-row-art" aria-label={`播放 ${song.title}`} onClick={() => player.replace(songs, index, { source: { kind: 'collection', id: 'search', libraryId } })}><Cover id={song.coverArt} size={160} /></button><div className="search-row-copy"><button onClick={() => player.replace(songs, index, { source: { kind: 'collection', id: 'search', libraryId } })}>{song.title}</button><span><ArtistLinks track={song} /></span></div><span className="search-kind">歌曲</span><div className="search-row-actions"><IconButton label={`添加 ${song.title} 到队列`} onClick={() => { player.append([song], false, { kind: 'collection', id: 'search', libraryId }); useSession.getState().notify('已添加到队列'); }}><Plus size={20} /></IconButton><IconButton label={`添加 ${song.title} 到歌单`} onClick={() => addToPlaylist(song)}><ListMusic size={18} /></IconButton></div></article>)}
      {show('albums') && albums.slice(0, filter === 'all' ? 5 : undefined).map((album) => <article className="search-result-row" role="listitem" key={`album-${album.id}`}><Link className="search-row-art" to={`/albums/${encodeURIComponent(album.id)}`}><Cover id={album.coverArt} size={160} /></Link><div className="search-row-copy"><Link to={`/albums/${encodeURIComponent(album.id)}`}>{album.name}</Link><span>{album.artist}</span></div><span className="search-kind">专辑</span><Link className="icon-button" aria-label={`查看专辑 ${album.name}`} to={`/albums/${encodeURIComponent(album.id)}`}><ArrowUpRight size={18} /></Link></article>)}
      {show('artists') && artists.filter((a) => a.id !== featured?.id).map((artist) => <article className="search-result-row" role="listitem" key={`artist-${artist.id}`}><Link className="search-row-art" to={`/artists/${encodeURIComponent(artist.id)}`}><EntityArtwork id={artist.id} name={artist.name} kind="artist" coverArt={artist.coverArt} /></Link><div className="search-row-copy"><Link to={`/artists/${encodeURIComponent(artist.id)}`}>{artist.name}</Link><span>歌手</span></div><span className="search-kind">歌手</span><Link className="icon-button" aria-label={`查看歌手 ${artist.name}`} to={`/artists/${encodeURIComponent(artist.id)}`}><ArrowUpRight size={18} /></Link></article>)}
    </div>}
    {show('playlists') && playlists.error && <QueryState pending={false} error={playlists.error} retry={() => playlists.refetch()} />}
    {!loading && !error && (term || filter === 'songs' || filter === 'playlists') && !hasResults && !playlists.isPending && <Empty title={term ? '没有找到匹配的音乐' : '这里暂时没有内容'}>试试其他关键词，或切换搜索分类。</Empty>}
    {!term && filter !== 'songs' && filter !== 'playlists' && <><div className="search-browse-heading"><SearchIcon size={22} /><h1>浏览音乐</h1></div><QueryState pending={recent.isLoading} error={recent.error} retry={() => recent.refetch()} />{recent.data && <AlbumGrid albums={recent.data.slice(0, 12)} />}</>}
    {(term || filter === 'songs') && page.hasNextPage && <button className="load-more subtle-button" disabled={page.isFetchingNextPage} onClick={() => page.fetchNextPage()}>加载更多结果</button>}
    {term && filter === 'all' && hasResults && <p className="search-filter-hint">选择上方分类，查看完整结果</p>}
  </div>;
}
