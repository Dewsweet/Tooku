import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Heart, ListMusic, Play, Clock3, Pause } from 'lucide-react';
import { AlbumGrid, Cover, Empty, QueryState, useApi } from '../components/Common';
import { ArtistGrid } from '../components/ArtistGrid';
import { FilterPills } from '../components/FilterPills';
import { player, usePlayer } from '../features/player/engine';
import { playlistPlacement, useMusicLibrary } from '../state/library';
import { useSession, errorMessage } from '../state/session';
import type { Playlist } from '../domain/models';
import './home.css';

export function Home() {
  const api = useApi(); const { active, libraryId, defaultId, profile, error: libraryError, isPending: libraryPending, refetch: reloadLibraries } = useMusicLibrary();
  const [filter, setFilter] = useState<'all' | 'playlists' | 'albums' | 'artists'>(profile.views[libraryId ?? ''] === 'albums' ? 'albums' : 'all'); const [busy, setBusy] = useState<string | null>(null);
  const current = usePlayer((s) => s.entries.find((e) => e.entryId === s.currentId)); const status = usePlayer((s) => s.status);
  const recent = useQuery({ queryKey: [api.identity, 'home', libraryId, 'newest'], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.albums('newest', 0, signal, libraryId) });
  const familiar = useQuery({ queryKey: [api.identity, 'home', libraryId, 'frequent'], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.albums('frequent', 0, signal, libraryId) });
  const playlists = useQuery({ queryKey: [api.identity, 'playlists'], queryFn: ({ signal }) => api.playlists(signal) });
  const artists = useQuery({ queryKey: [api.identity, 'artists', libraryId], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.artists(signal, libraryId) });
  const overview = useQuery({ queryKey: [api.identity, 'overview', libraryId], enabled: Boolean(libraryId), staleTime: 300000, queryFn: ({ signal }) => api.libraryOverview(libraryId!, signal) });
  const lists = playlists.data?.filter((p) => playlistPlacement(profile, p.id, defaultId ?? '').libraryId === libraryId) ?? [];
  const summary = overview.data;
  const stats = [summary && `${summary.albums.toLocaleString()} 张专辑`, summary?.songs !== null && summary && `${summary.songs?.toLocaleString()} 首歌曲`, artists.data && `${artists.data.length.toLocaleString()} 位歌手`].filter(Boolean);
  async function playList(playlist: Playlist) {
    if (busy) return; setBusy(playlist.id);
    try { const data = await api.playlist(playlist.id); if (data.songs.length) player.replace(data.songs); else useSession.getState().notify('这张歌单还没有歌曲。'); }
    catch (error) { useSession.getState().notify(errorMessage(error)); } finally { setBusy(null); }
  }
  return <div className="home-page"><FilterPills label="主页内容" options={([['all', '全部'], ['playlists', '歌单'], ['albums', '专辑'], ['artists', '歌手']] as const)} value={filter} onChange={setFilter} />
    <header className="home-welcome"><div><h1>现在就听</h1><p>{active?.name ?? '你的音乐'}{stats.length > 0 && <span> · {stats.join(' · ')}</span>}</p></div></header>
    <QueryState pending={libraryPending} error={libraryError} retry={() => reloadLibraries()} />
    {overview.error && <button className="overview-retry text-button" onClick={() => overview.refetch()}>概览暂不可用，点击重试</button>}
    <div className="home-shortcuts"><Link to="/favorites"><span className="shortcut-art liked-art"><Heart size={24} fill="currentColor" /></span><strong>收藏的歌曲</strong><ArrowUpRight size={17} /></Link><Link to="/playlists"><span className="shortcut-art lists-art"><ListMusic size={25} /></span><strong>我的歌单</strong><ArrowUpRight size={17} /></Link><Link to="/history"><span className="shortcut-art history-art"><Clock3 size={24} /></span><strong>最近在听</strong><ArrowUpRight size={17} /></Link></div>
    {current && filter === 'all' && <section className="home-resume"><Link to={current.track.albumId ? `/albums/${encodeURIComponent(current.track.albumId)}` : '/history'}><Cover id={current.track.coverArt} size={180} /><span><span>继续聆听</span><strong>{current.track.title}</strong><span>{current.track.artist}</span></span></Link><button aria-label={status === 'playing' ? '暂停当前歌曲' : '继续播放当前歌曲'} onClick={() => player.toggle()}>{status === 'playing' ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button></section>}
    {filter !== 'albums' && filter !== 'artists' && <section className="home-section"><div className="home-section-heading"><h2>你的歌单</h2><Link to="/playlists">查看全部<ArrowUpRight size={16} /></Link></div><QueryState pending={playlists.isPending} error={playlists.error} retry={() => playlists.refetch()} />{lists.length ? <div className="home-playlist-grid">{lists.slice(0, 6).map((list) => <article className="home-playlist" key={list.id}><Link to={`/playlists/${encodeURIComponent(list.id)}`}>{list.coverArt ? <Cover id={list.coverArt} size={180} /> : <span className="home-list-art"><ListMusic size={26} /></span>}<span><strong>{list.name}</strong><span>{list.songCount ?? 0} 首</span></span></Link><button disabled={Boolean(busy)} aria-label={`播放歌单 ${list.name}`} onClick={() => playList(list)}><Play size={18} fill="currentColor" /></button></article>)}</div> : playlists.data && <div className="home-empty-list"><ListMusic size={24} /><span>给喜欢的散歌一个位置</span><Link to="/playlists">创建歌单<ArrowUpRight size={16} /></Link></div>}</section>}
    {filter !== 'playlists' && filter !== 'artists' && <><section className="home-section"><div className="home-section-heading"><h2>最近加入</h2><Link to="/albums">查看全部<ArrowUpRight size={16} /></Link></div><QueryState pending={recent.isLoading} error={recent.error} retry={() => recent.refetch()} />{recent.data?.length ? <AlbumGrid albums={recent.data.slice(0, 8)} /> : recent.data && <Empty title="这个音乐库还没有专辑" />}</section>{!!familiar.data?.length && <section className="home-section"><div className="home-section-heading"><h2>常听的专辑</h2><Link to="/albums?sort=frequent">查看全部<ArrowUpRight size={16} /></Link></div><AlbumGrid albums={familiar.data.slice(0, 4)} /></section>}{familiar.error && <div className="home-section"><QueryState pending={false} error={familiar.error} retry={() => familiar.refetch()} /></div>}</>}
    {filter === 'artists' && <section className="home-section"><div className="home-section-heading"><h2>歌手</h2><Link to="/artists">查看全部<ArrowUpRight size={16} /></Link></div><QueryState pending={artists.isLoading} error={artists.error} retry={() => artists.refetch()} />{artists.data?.length ? <ArtistGrid artists={artists.data.slice(0, 12)} /> : artists.data && <Empty title="这个音乐库还没有歌手" />}</section>}
  </div>;
}
