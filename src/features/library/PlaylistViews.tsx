import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Play, Trash2, ListMusic, Folder, FolderPlus, MoreHorizontal, Shuffle, Pencil, ArrowUp, LockKeyhole } from 'lucide-react';
import { EntityArtwork } from '../../components/EntityArtwork';
import { Empty, IconButton, PageTitle, QueryState, TrackList, useApi } from '../../components/Common';
import { Modal } from '../../components/Modal';
import { useContextMenu, type MenuItem } from '../../components/Interactions';
import { errorMessage } from '../../state/session';
import type { Playlist, Track } from '../../domain/models';
import { approximateDuration } from '../../domain/duration';
import { playlistPermissions } from '../../domain/playlistPermissions';
import { player } from '../player/engine';
import { libraryItems, useLibrary, useMusicLibrary, type LibraryItem } from '../../state/library';
import { FolderEditor, PlaylistLocation } from './Organization';
import { CreatePlaylist } from './CreatePlaylist';
import { PlaylistDetailsEditor } from './PlaylistDetailsEditor';
import { PlaylistCoverPicker } from './PlaylistCoverPicker';

function playTracks(tracks: Track[], id: string, shuffle = false) { if (!tracks.length) return; player.replace(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0, { source: { kind: 'playlist', id }, ...(shuffle ? { shuffle: true } : {}) }); }

export function Playlists() {
  const api = useApi(); const navigate = useNavigate(); const menu = useContextMenu(); const [creating, setCreating] = useState<{ parent: string | null } | null>(null); const [folderEditor, setFolderEditor] = useState<{ id?: string; parent?: string | null } | null>(null); const [moving, setMoving] = useState<Playlist | null>(null);
  const { libraryId = '', defaultId = '', profile } = useMusicLibrary(); const [params] = useSearchParams(); const folder = profile.folders.find((f) => f.id === params.get('folder') && f.libraryId === libraryId); const parent = folder?.id ?? null;
  const query = useQuery({ queryKey: [api.identity, 'playlists'], queryFn: ({ signal }) => api.playlists(signal) }); const playlists = query.data ?? []; const items = libraryItems(profile, playlists, libraryId, parent, defaultId);
  const path: typeof profile.folders = []; let ancestor = folder; const visited = new Set<string>(); while (ancestor && !visited.has(ancestor.id)) { visited.add(ancestor.id); path.unshift(ancestor); ancestor = profile.folders.find((f) => f.id === ancestor!.parentId); }
  async function playPlaylist(id: string, shuffle = false) { const data = await api.playlist(id); playTracks(data.songs, id, shuffle); }
  const choices = (item: LibraryItem): MenuItem[] => item.kind === 'folder' ? [
    { label: '打开文件夹', icon: <Folder size={16} />, action: () => navigate(`/playlists?folder=${encodeURIComponent(item.folder.id)}`) },
    { label: '新建歌单', icon: <Plus size={16} />, action: () => setCreating({ parent: item.folder.id }) }, { label: '新建子文件夹', icon: <FolderPlus size={16} />, action: () => setFolderEditor({ parent: item.folder.id }) },
    { label: '管理文件夹', icon: <MoreHorizontal size={16} />, divider: true, action: () => setFolderEditor({ id: item.folder.id }) },
  ] : [
    { label: '打开歌单', icon: <ListMusic size={16} />, action: () => navigate(`/playlists/${encodeURIComponent(item.playlist.id)}`) },
    { label: '播放', icon: <Play size={16} />, action: () => playPlaylist(item.playlist.id) }, { label: '随机播放', icon: <Shuffle size={16} />, action: () => playPlaylist(item.playlist.id, true) },
    { label: '移动歌单', icon: <Folder size={16} />, divider: true, action: () => setMoving(item.playlist) },
  ];
  return <>
    <PageTitle title={folder?.name ?? '歌单'}><div className="button-row">
      <IconButton label="新建文件夹" disabled={!libraryId} onClick={() => setFolderEditor({ parent })}><FolderPlus size={20} /></IconButton>
      <button className="primary-button" disabled={!libraryId} onClick={() => setCreating({ parent })}><Plus size={17} />新建歌单</button>
    </div></PageTitle>
    {folder && <><div className="folder-breadcrumb"><Link draggable={false} to="/playlists" aria-label="返回 /">/</Link>{path.map((f, index) => <span key={f.id}>{index > 0 && ' / '}<Link draggable={false} to={`/playlists?folder=${encodeURIComponent(f.id)}`}>{f.name}</Link></span>)}</div>
      <Link draggable={false} className="organization-parent" to={folder.parentId ? `/playlists?folder=${encodeURIComponent(folder.parentId)}` : '/playlists'}><ArrowUp size={17} />上一级</Link></>}
    <QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    <div className="organization-grid" onDragStart={(event) => event.preventDefault()} onContextMenu={(e) => menu(e, [{ label: '在这里新建歌单', icon: <Plus size={16} />, action: () => setCreating({ parent }) }, { label: '在这里新建文件夹', icon: <FolderPlus size={16} />, action: () => setFolderEditor({ parent }) }])}>
      {items.map((item) => item.kind === 'folder' ? <article className="organization-folder-card" key={item.key} onContextMenu={(e) => { e.stopPropagation(); menu(e, choices(item)); }}>
        <Link draggable={false} to={`/playlists?folder=${encodeURIComponent(item.folder.id)}`}><span className="organization-folder-art"><Folder size={45} strokeWidth={1.4} /></span><h3>{item.folder.name}</h3></Link>
      </article> : <article className="playlist-card" key={item.key} onContextMenu={(e) => { e.stopPropagation(); menu(e, choices(item)); }}>
        <Link draggable={false} to={`/playlists/${encodeURIComponent(item.playlist.id)}`} className="playlist-card-link"><EntityArtwork id={item.playlist.id} name={item.playlist.name} kind="playlist" coverArt={item.playlist.coverArt} className="playlist-art" /><h3>{item.playlist.name}</h3></Link>
      </article>)}
    </div>
    {query.data && !items.length && <Empty title="还没有歌单" />}
    {creating && <CreatePlaylist parent={creating.parent} onClose={() => setCreating(null)} />}
    {folderEditor && <FolderEditor {...folderEditor} onClose={() => setFolderEditor(null)} />}
    {moving && <PlaylistLocation playlist={moving} onClose={() => setMoving(null)} />}
  </>;
}

export function PlaylistDetail({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const { id = '' } = useParams();
  return <PlaylistDetailContent key={id} addToPlaylist={addToPlaylist} />;
}
function PlaylistDetailContent({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const queryClient = useQueryClient(); const { id = '' } = useParams(); const navigate = useNavigate(); const menu = useContextMenu(); const [moving, setMoving] = useState(false); const [editing, setEditing] = useState(false); const [deleting, setDeleting] = useState(false); const [busy, setBusy] = useState(false); const saving = useRef(false); const [error, setError] = useState('');
  const query = useQuery({ queryKey: [api.identity, 'playlist', id], queryFn: ({ signal }) => api.playlist(id, signal) }); const data = query.data;
  const permissions = data ? playlistPermissions(data, api.username) : { canEdit: false, canReorder: false };
  const owned = permissions.canEdit;
  const readonlyHint = !owned ? '当前账号没有编辑权限，仍可播放和浏览。' : '曲目由 Navidrome 自动维护，不能在此增删或排序。来自 m3u/m3u8 的歌单，请修改原文件后重新扫描。';
  async function saveOrder(songs: Track[]) {
    if (!data || !permissions.canReorder || saving.current) return; saving.current = true; setBusy(true); setError('');
    try { const saved = await api.savePlaylist(id, data.name, songs.map((s) => s.id), data.changed); queryClient.setQueryData([api.identity, 'playlist', id], saved); await queryClient.invalidateQueries({ queryKey: [api.identity, 'playlists'] }); }
    catch (e) { setError(errorMessage(e)); } finally { saving.current = false; setBusy(false); }
  }
  function reorder(from: number, to: number) { if (!data || from === to || to < 0 || to >= data.songs.length) return; const songs = [...data.songs]; const [song] = songs.splice(from, 1); songs.splice(to, 0, song); void saveOrder(songs); }
  const options: MenuItem[] = data ? [
    ...(owned ? [{ label: '歌单信息与封面', icon: <Pencil size={16} />, disabled: busy, action: () => setEditing(true) }] : []),
    { label: '加入播放队列', icon: <Plus size={16} />, disabled: !data.songs.length, action: () => player.append(data.songs, false, { kind: 'playlist', id }) },
    { label: '移动歌单', icon: <Folder size={16} />, action: () => setMoving(true) },
    ...(owned ? [{ label: '删除歌单', icon: <Trash2 size={16} />, danger: true, divider: true, disabled: busy, action: () => { setError(''); setDeleting(true); } }] : []),
  ] : [];
  return <><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{data && <><div className="entity-detail-hero playlist-detail-hero" onContextMenu={(e) => menu(e, options)}><PlaylistCoverPicker playlist={data} editable={owned} disabled={busy} fallback={data.songs[0]?.coverArt} /><PageTitle title={data.name}><div className="playlist-summary">{data.comment && <p>{data.comment}</p>}<span>{data.owner ?? '我的歌单'} · {data.songs.length} 首歌曲{approximateDuration(data.duration ?? data.songs, 'hours') && ` · ${approximateDuration(data.duration ?? data.songs, 'hours')}`}</span></div><div className="button-row playlist-controls">{!permissions.canReorder && <span className="playlist-readonly" role="status" tabIndex={0} data-tooltip={readonlyHint} aria-label={readonlyHint}><LockKeyhole size={15} aria-hidden="true" />{owned ? '自动维护歌单' : '只读歌单'}</span>}<button className="primary-button" disabled={!data.songs.length} onClick={() => playTracks(data.songs, id)}><Play size={18} fill="currentColor" />播放</button><IconButton label="随机播放歌单" disabled={!data.songs.length} onClick={() => playTracks(data.songs, id, true)}><Shuffle size={21} /></IconButton><IconButton label="歌单选项" onClick={(e) => menu(e, options)}><MoreHorizontal size={22} /></IconButton></div></PageTitle></div>{error && <div role="alert" className="form-error"><p>{error}</p><button type="button" className="text-button" disabled={busy} onClick={() => { void query.refetch(); setError(''); }}>重新读取服务器歌单</button></div>}{data.songs.length ? <TrackList tracks={data.songs} source={{ kind: 'playlist', id }} addToPlaylist={addToPlaylist} saving={busy} onReorder={permissions.canReorder ? reorder : undefined} onRemove={permissions.canReorder ? (index) => { void saveOrder(data.songs.filter((_, i) => i !== index)); } : undefined} /> : <Empty title="歌单还没有歌曲" />}{editing && owned && <PlaylistDetailsEditor key={data.id} playlist={data} onClose={() => setEditing(false)} />}{moving && <PlaylistLocation playlist={data} onClose={() => setMoving(false)} />}</>}{deleting && <Modal title="删除这张歌单？" onClose={() => !busy && setDeleting(false)}><p>将删除“{data?.name}”。音乐文件不会被删除。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="button-row"><button className="subtle-button" disabled={busy} onClick={() => setDeleting(false)}>保留歌单</button><button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await api.request('deletePlaylist', { id }, undefined, true); await queryClient.invalidateQueries({ queryKey: [api.identity, 'playlists'] }); useLibrary.getState().change(api.identity, (p) => ({ ...p, placements: Object.fromEntries(Object.entries(p.placements).filter(([key]) => key !== id)) })); navigate('/playlists'); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>删除歌单</button></div></Modal>}</>;
}
