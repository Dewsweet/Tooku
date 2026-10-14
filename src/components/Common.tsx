import { useState, type ReactNode } from 'react';
import { Music2, LoaderCircle, RefreshCw, Play, Plus, Heart, ListPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession, queryClient, errorMessage } from '../state/session';
import type { Album, Track } from '../domain/models';
import { player } from '../features/player/engine';
import type { MusicApi } from '../api/client';

export function useApi() { const api = useSession((s) => s.api); if (!api) throw new Error('请先连接服务。'); return api; }
export function IconButton({ label, children, ...props }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}
export function Cover({ id, className = '', size = 400 }: { id?: string; className?: string; size?: number }) {
  const api = useSession((s) => s.api); const [failed, setFailed] = useState<string>(); const src = api?.coverUrl(id, size);
  return <div className={`cover ${className}`}>{src && failed !== src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} /> : <Music2 aria-hidden="true" />}</div>;
}
export function formatTime(seconds?: number) { if (!seconds || !Number.isFinite(seconds)) return '0:00'; const value = Math.max(0, Math.floor(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><Music2 size={36} /><h3>{title}</h3>{children && <p>{children}</p>}</div>; }
export function QueryState({ pending, error, retry }: { pending: boolean; error: unknown; retry?: () => void }) {
  if (pending) return <div className="loading" role="status"><LoaderCircle className="spin" size={22} /> 正在加载音乐…</div>;
  if (error) return <div className="error-panel" role="alert"><p>{errorMessage(error)}</p>{retry && <button className="subtle-button" onClick={retry}><RefreshCw size={16} />重试</button>}</div>;
  return null;
}
export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return <header className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1></div>{children}</header>;
}
export function AlbumGrid({ albums }: { albums: Album[] }) {
  const api = useApi(); const [busy, setBusy] = useState<string | null>(null);
  return <div className="album-grid">{albums.map((album) => <article className="album-card" key={album.id}>
    <div className="album-art"><Link to={`/albums/${encodeURIComponent(album.id)}`} aria-label={`查看专辑 ${album.name}`}><Cover id={album.coverArt} /></Link><button className="art-hover" aria-label={`播放专辑 ${album.name}`} disabled={busy === album.id} onClick={async () => { setBusy(album.id); try { const detail = await api.album(album.id); if (detail.songs.length) player.replace(detail.songs); else useSession.getState().notify('这张专辑还没有可播放的歌曲。'); } catch (e) { useSession.getState().notify(errorMessage(e)); } finally { setBusy(null); } }}>{busy === album.id ? <LoaderCircle size={20} className="spin" /> : <Play size={24} fill="currentColor" />}</button></div>
    <Link className="album-name" to={`/albums/${encodeURIComponent(album.id)}`}>{album.name}</Link><p>{album.artist}</p>
  </article>)}</div>;
}
export async function toggleFavorite(api: MusicApi, track: Track) {
  try { await api.star(track.id, Boolean(track.starred)); await queryClient.invalidateQueries({ queryKey: [api.identity] }); }
  catch (error) { useSession.getState().notify(errorMessage(error)); }
}
export function TrackList({ tracks, addToPlaylist, actions }: { tracks: Track[]; addToPlaylist?: (track: Track) => void; actions?: (track: Track, index: number) => ReactNode }) {
  const api = useApi(); const [busy, setBusy] = useState<string | null>(null);
  const favorites = useQuery({ queryKey: [api.identity, 'favorites'], queryFn: ({ signal }) => api.favorites(signal) });
  const starredIds = new Set(favorites.data?.songs.map((song) => song.id));
  return <div className="track-list" role="list" aria-label="歌曲列表">{tracks.map((track, index) => <div className="track-row" role="listitem" key={`${track.id}-${index}`}>
    <span className="track-number">{index + 1}</span><IconButton label={`播放 ${track.title}`} onClick={() => player.replace([track])}><Play size={16} fill="currentColor" /></IconButton>
    <Cover id={track.coverArt} size={100} className="track-cover" />
    <div className="track-info"><span className="track-title">{track.title}</span><span className="track-subtitle">{track.artist}{track.album && ` · ${track.album}`}</span></div>
    <span className="track-duration">{formatTime(track.duration)}</span>
    {actions ? actions(track, index) : <div className="track-actions">
      <IconButton label={`${(favorites.data ? starredIds.has(track.id) : track.starred) ? '取消收藏' : '收藏'} ${track.title}`} disabled={busy === track.id} aria-pressed={favorites.data ? starredIds.has(track.id) : Boolean(track.starred)} onClick={async () => { setBusy(track.id); await toggleFavorite(api, { ...track, starred: (favorites.data ? starredIds.has(track.id) : track.starred) ? 'true' : undefined }); setBusy(null); }}><Heart size={16} fill={(favorites.data ? starredIds.has(track.id) : track.starred) ? 'currentColor' : 'none'} /></IconButton>
      <IconButton label={`下一首播放 ${track.title}`} onClick={() => { player.append([track], true); useSession.getState().notify('已加入下一首播放'); }}><ListPlus size={17} /></IconButton>
      <IconButton label={`添加 ${track.title} 到队列`} onClick={() => { player.append([track]); useSession.getState().notify('已添加到队列'); }}><Plus size={17} /></IconButton>
      {addToPlaylist && <button className="text-button" onClick={() => addToPlaylist(track)}>歌单</button>}
    </div>}
  </div>)}</div>;
}
