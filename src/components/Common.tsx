import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Music2, LoaderCircle, RefreshCw, Play, Plus, Heart, ListPlus, ListMusic, Disc3, Mic2, ChevronUp, ChevronDown, X, Copy } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession, queryClient, errorMessage } from '../state/session';
import type { Album, Track } from '../domain/models';
import { player } from '../features/player/engine';
import type { MusicApi } from '../api/client';
import { AlbumLink, ArtistLinks } from './TrackLinks';
import { usePlayer } from '../features/player/engine';
import { useContextMenu, type MenuItem } from './Interactions';
import { TrackColumns, columnVariables } from './TrackColumns';
import { normalizeTrackColumns, usePreferences } from '../state/preferences';
import { startInternalDrag } from './dragPreview';

export function useApi() { const api = useSession((s) => s.api); if (!api) throw new Error('请先连接服务。'); return api; }
export function IconButton({ label, children, ...props }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="icon-button" aria-label={label} data-tooltip={label} {...props}>{children}</button>;
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
  const api = useApi(); const [busy, setBusy] = useState<string | null>(null); const menu = useContextMenu(); const navigate = useNavigate();
  return <div className="album-grid">{albums.map((album) => <article className="album-card" key={album.id} onContextMenu={(e) => menu(e, [{ label: '播放专辑', icon: <Play size={16} />, action: async () => { const detail = await api.album(album.id); if (detail.songs.length) player.replace(detail.songs); } }, { label: '加入播放队列', icon: <Plus size={16} />, action: async () => { const detail = await api.album(album.id); player.append(detail.songs); } }, { label: '查看专辑', icon: <Disc3 size={16} />, action: () => navigate(`/albums/${encodeURIComponent(album.id)}`) }])}>
    <div className="album-art"><Link to={`/albums/${encodeURIComponent(album.id)}`} aria-label={`查看专辑 ${album.name}`}><Cover id={album.coverArt} /></Link><button className="art-hover" aria-label={`播放专辑 ${album.name}`} disabled={busy === album.id} onClick={async () => { setBusy(album.id); try { const detail = await api.album(album.id); if (detail.songs.length) player.replace(detail.songs); else useSession.getState().notify('这张专辑还没有可播放的歌曲。'); } catch (e) { useSession.getState().notify(errorMessage(e)); } finally { setBusy(null); } }}>{busy === album.id ? <LoaderCircle size={20} className="spin" /> : <Play size={24} fill="currentColor" />}</button></div>
    <Link className="album-name" to={`/albums/${encodeURIComponent(album.id)}`}>{album.name}</Link><p>{album.artist}</p>
  </article>)}</div>;
}
export async function toggleFavorite(api: MusicApi, track: Track) {
  try { await api.star(track.id, Boolean(track.starred)); await queryClient.invalidateQueries({ queryKey: [api.identity] }); }
  catch (error) { useSession.getState().notify(errorMessage(error)); }
}
export function TrackList({ tracks, addToPlaylist, onReorder, onRemove, saving = false }: { tracks: Track[]; addToPlaylist?: (track: Track) => void; onReorder?: (from: number, to: number) => void; onRemove?: (index: number) => void; saving?: boolean }) {
  const api = useApi(); const [busy, setBusy] = useState<string | null>(null); const menu = useContextMenu(); const navigate = useNavigate(); const id = useId(); const drag = useRef<{ index: number; signature: string } | null>(null); const [over, setOver] = useState<number | null>(null); const columns = usePreferences((s) => s.trackColumns);
  const releasePreview = useRef<(() => void) | null>(null);
  useEffect(() => () => { drag.current = null; releasePreview.current?.(); }, []);
  const current = usePlayer((s) => s.entries.find((e) => e.entryId === s.currentId)?.track.id);
  const favorites = useQuery({ queryKey: [api.identity, 'favorites'], queryFn: ({ signal }) => api.favorites(signal) });
  const starredIds = new Set(favorites.data?.songs.map((song) => song.id));
  const isStarred = (track: Track) => favorites.data ? starredIds.has(track.id) : Boolean(track.starred);
  const favorite = async (track: Track) => { setBusy(track.id); await toggleFavorite(api, { ...track, starred: isStarred(track) ? 'true' : undefined }); setBusy(null); };
  const rowMenu = (track: Track, index: number): MenuItem[] => [
    { label: '播放', icon: <Play size={16} />, action: () => player.replace(tracks, index) },
    { label: '下一首播放', icon: <ListPlus size={16} />, action: () => { player.append([track], true); useSession.getState().notify('已加入下一首播放'); } },
    { label: '加入播放队列', icon: <Plus size={16} />, action: () => { player.append([track]); useSession.getState().notify('已添加到队列'); } },
    ...(addToPlaylist ? [{ label: '添加到歌单', icon: <ListMusic size={16} />, action: () => addToPlaylist(track) }] : []),
    { label: isStarred(track) ? '取消收藏' : '收藏歌曲', icon: <Heart size={16} />, divider: true, disabled: busy === track.id, action: () => favorite(track) },
    ...(track.albumId ? [{ label: '查看专辑', icon: <Disc3 size={16} />, action: () => navigate(`/albums/${encodeURIComponent(track.albumId!)}`) }] : []),
    ...(track.artistId ? [{ label: '查看歌手', icon: <Mic2 size={16} />, action: () => navigate(`/artists/${encodeURIComponent(track.artistId!)}`) }] : []),
    { label: '复制歌曲信息', icon: <Copy size={16} />, action: () => navigator.clipboard.writeText(`${track.title} · ${track.artist}`) },
    ...(onReorder ? [{ label: '上移', icon: <ChevronUp size={16} />, divider: true, disabled: saving || index === 0, action: () => onReorder(index, index - 1) }, { label: '下移', icon: <ChevronDown size={16} />, disabled: saving || index === tracks.length - 1, action: () => onReorder(index, index + 1) }] : []),
    ...(onRemove ? [{ label: '从歌单移除', icon: <X size={16} />, danger: true, disabled: saving, action: () => onRemove(index) }] : []),
  ];
  return <div className="track-list" role="list" aria-label="歌曲列表" aria-busy={saving} style={columnVariables(normalizeTrackColumns(columns)) as CSSProperties}><TrackColumns />{tracks.map((track, index) => <div className={`track-row ${track.id === current ? 'is-current' : ''} ${over === index ? 'track-drop-before' : ''}`} role="listitem" tabIndex={0} key={`${track.id}-${index}`} draggable={Boolean(onReorder && !saving)} onContextMenu={(e) => menu(e, rowMenu(track, index))} onDoubleClick={(e) => { if (!(e.target instanceof Element) || !e.target.closest('button, a, input')) player.replace(tracks, index); }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); player.replace(tracks, index); } }} onDragStart={(e) => { if (!onReorder || saving) { e.preventDefault(); return; } drag.current = { index, signature: JSON.stringify(tracks.map((t) => t.id)) }; releasePreview.current?.(); releasePreview.current = startInternalDrag(e.dataTransfer, 'application/x-tooku-track', id, `${track.title} · ${track.artist}`); }} onDragOver={(e) => { if (!onReorder || saving || drag.current === null || !e.dataTransfer.types.includes('application/x-tooku-track')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(e.clientY > e.currentTarget.getBoundingClientRect().top + e.currentTarget.offsetHeight / 2 ? index + 1 : index); }} onDrop={(e) => { if (!onReorder || saving || drag.current === null || e.dataTransfer.getData('application/x-tooku-track') !== id) return; e.preventDefault(); e.stopPropagation(); if (drag.current.signature !== JSON.stringify(tracks.map((t) => t.id))) { drag.current = null; setOver(null); useSession.getState().notify('列表已更新，请重新拖动。'); return; } const from = drag.current.index; const insertion = over ?? index; const to = insertion > from ? insertion - 1 : insertion; drag.current = null; setOver(null); releasePreview.current?.(); if (from !== to) onReorder(from, to); }} onDragEnd={() => { drag.current = null; setOver(null); releasePreview.current?.(); }}>
    <button className="track-number-play" aria-label={`播放 ${track.title}`} onClick={() => player.replace(tracks, index)}><span>{index + 1}</span><Play size={15} fill="currentColor" /></button>
    <div className="track-info"><Cover id={track.coverArt} size={100} className="track-cover" /><div className="track-copy"><button className="track-title" onClick={() => player.replace(tracks, index)}>{track.title}</button><span className="track-subtitle"><ArtistLinks track={track} /></span></div></div>
    <div className="track-artist"><ArtistLinks track={track} /></div><div className="track-album"><AlbumLink track={track} /></div>
    <span className="track-duration">{formatTime(track.duration)}</span>
    <div className={`track-actions ${isStarred(track) ? 'has-favorite' : ''}`}><IconButton label={`${isStarred(track) ? '取消收藏' : '收藏'} ${track.title}`} disabled={busy === track.id} aria-pressed={isStarred(track)} onClick={() => favorite(track)}><Heart size={16} fill={isStarred(track) ? 'currentColor' : 'none'} /></IconButton></div>
  </div>)}{over === tracks.length && <div className="track-drop-end" />}</div>;
}
