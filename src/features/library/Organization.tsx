import { Select } from '../../components/Select';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Folder, Plus, ListMusic, MoreHorizontal, Trash2, FolderPlus } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { IconButton, useApi, QueryState } from '../../components/Common';
import { descendants, folderPath, libraryItems, playlistPlacement, removeFolder, reparentFolder, useLibrary, useMusicLibrary } from '../../state/library';
import type { Playlist } from '../../domain/models';
import { CreatePlaylist } from './CreatePlaylist';
import { useOrganizationDrag } from './useOrganizationDrag';
import { useContextMenu, type MenuItem } from '../../components/Interactions';

export function FolderEditor({ id, parent = null, onClose }: { id?: string; parent?: string | null; onClose: () => void }) {
  const api = useApi(); const { libraryId, profile } = useMusicLibrary(); const change = useLibrary((s) => s.change); const navigate = useNavigate();
  const existing = profile.folders.find((f) => f.id === id); const [name, setName] = useState(existing?.name ?? ''); const [parentId, setParentId] = useState(existing?.parentId ?? parent); const [error, setError] = useState('');
  const forbidden = id ? descendants(profile.folders, id) : new Set();
  function save(event: FormEvent) {
    event.preventDefault(); if (!libraryId || !name.trim()) return;
    if (profile.folders.some((f) => f.id !== id && f.libraryId === libraryId && f.parentId === parentId && f.name === name.trim())) { setError('这个位置已经有同名文件夹。'); return; }
    change(api.identity, (p) => id ? { ...reparentFolder(p, id, parentId), folders: reparentFolder(p, id, parentId).folders.map((f) => f.id === id ? { ...f, name: name.trim() } : f) } : { ...p, folders: [...p.folders, { id: crypto.randomUUID(), name: name.trim(), libraryId, parentId }] }); onClose();
  }
  return <Modal title={id ? '管理文件夹' : '新建文件夹'} onClose={onClose}><form onSubmit={save}><label>名称<input required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>{id && <label>位置<Select aria-label="文件夹位置" value={parentId ?? ''} onChange={(value) => setParentId(value || null)}><option value="">/</option>{profile.folders.filter((f) => f.libraryId === libraryId && !forbidden.has(f.id)).map((f) => <option key={f.id} value={f.id}>{folderPath(profile.folders, f.id)}</option>)}</Select></label>}{error && <p role="alert" className="form-error">{error}</p>}<div className="button-row"><button className="primary-button" disabled={!name.trim()}>保存</button>{id && <button type="button" className="subtle-button" data-tooltip="歌单与子文件夹会移到上一级，不删除服务器歌单" onClick={() => { change(api.identity, (p) => removeFolder(p, id)); onClose(); navigate('/playlists'); }}><Trash2 size={16} />删除文件夹</button>}</div></form></Modal>;
}
export { folderPath } from '../../state/library';
export function PlaylistLocation({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
  const api = useApi(); const { libraries, profile, defaultId } = useMusicLibrary(); const place = useLibrary((s) => s.place); const navigate = useNavigate();
  const before = playlistPlacement(profile, playlist.id, defaultId ?? ''); const [libraryId, setLibraryId] = useState(before.libraryId); const [folderId, setFolderId] = useState(before.folderId);
  return <Modal title="移动歌单" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); if (!libraries.some((l) => l.id === libraryId)) return; place(api.identity, playlist.id, libraryId, folderId); onClose(); navigate('/playlists'); }}><p>{playlist.name}</p><label>音乐库<Select aria-label="歌单音乐库" value={libraryId} onChange={(value) => { setLibraryId(value); setFolderId(null); }}>{libraries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></label><label>文件夹<Select aria-label="歌单文件夹" value={folderId ?? ''} onChange={(value) => setFolderId(value || null)}><option value="">/</option>{profile.folders.filter((f) => f.libraryId === libraryId).map((f) => <option key={f.id} value={f.id}>{folderPath(profile.folders, f.id)}</option>)}</Select></label><button className="primary-button">移动</button></form></Modal>;
}
export function PlaylistTree({ closeNavigation }: { closeNavigation: () => void }) {
  const api = useApi(); const navigate = useNavigate(); const menu = useContextMenu(); const { libraryId = '', defaultId = '', profile } = useMusicLibrary(); const [editing, setEditing] = useState<{ id?: string; parent?: string | null } | null>(null); const [creating, setCreating] = useState<{ parent: string | null } | null>(null); const [moving, setMoving] = useState<Playlist | null>(null); const [closed, setClosed] = useState<Set<string>>(new Set());
  const query = useQuery({ queryKey: [api.identity, 'playlists'], queryFn: ({ signal }) => api.playlists(signal) }); const playlists = query.data ?? []; const drag = useOrganizationDrag(playlists);
  const folderMenu = (id: string): MenuItem[] => [
    { label: '打开文件夹', icon: <Folder size={16} />, action: () => { navigate(`/playlists?folder=${encodeURIComponent(id)}`); closeNavigation(); } },
    { label: '新建歌单', icon: <Plus size={16} />, action: () => setCreating({ parent: id }) }, { label: '新建子文件夹', icon: <FolderPlus size={16} />, action: () => setEditing({ parent: id }) },
    { label: '管理文件夹', icon: <MoreHorizontal size={16} />, divider: true, action: () => setEditing({ id }) },
  ];
  const branch = (parent: string | null, depth = 0): React.ReactNode => depth > 30 ? null : libraryItems(profile, playlists, libraryId, parent, defaultId).map((item) => {
    if (item.kind === 'playlist') { const p = item.playlist; return <NavLink className="tree-playlist organization-draggable" {...drag.row(item, parent)} to={`/playlists/${encodeURIComponent(p.id)}`} key={item.key} onClick={closeNavigation} onContextMenu={(e) => menu(e, [{ label: '打开歌单', icon: <ListMusic size={16} />, action: () => { navigate(`/playlists/${encodeURIComponent(p.id)}`); closeNavigation(); } }, { label: '移动歌单', icon: <Folder size={16} />, action: () => setMoving(p) }])}><ListMusic size={16} /><span>{p.name}</span></NavLink>; }
    const f = item.folder; return <div className="tree-folder" key={item.key}><div className="tree-folder-heading organization-draggable" {...drag.row(item, parent)} onContextMenu={(e) => menu(e, folderMenu(f.id))}><button className="tree-disclosure" aria-label={`${closed.has(f.id) ? '展开' : '收起'}文件夹 ${f.name}`} aria-expanded={!closed.has(f.id)} onClick={() => setClosed((prev) => { const next = new Set(prev); if (next.has(f.id)) next.delete(f.id); else next.add(f.id); return next; })}>{closed.has(f.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button><Link className="tree-folder-link" draggable={false} to={`/playlists?folder=${encodeURIComponent(f.id)}`} onClick={closeNavigation}><Folder size={16} /><span>{f.name}</span></Link></div>{!closed.has(f.id) && <div className="tree-children">{branch(f.id, depth + 1)}</div>}</div>;
  });
  return <section className="sidebar-playlists"><div className="sidebar-group-heading"><NavLink to="/playlists" onClick={closeNavigation}>歌单</NavLink><IconButton label="新建歌单" disabled={!libraryId} onClick={() => setCreating({ parent: null })}><Plus size={20} /></IconButton></div><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} /><nav className="playlist-tree" aria-label="歌单文件夹" {...drag.area(null)}>{branch(null)}<div className="tree-root-drop" {...drag.area(null)} /></nav>{!libraryItems(profile, playlists, libraryId, null, defaultId).length && !query.isPending && !query.error && <Link className="tree-empty" to="/playlists" onClick={closeNavigation}>创建第一张歌单</Link>}{editing && <FolderEditor {...editing} onClose={() => setEditing(null)} />}{creating && <CreatePlaylist parent={creating.parent} chooseFolder onClose={() => setCreating(null)} />}{moving && <PlaylistLocation playlist={moving} onClose={() => setMoving(null)} />}</section>;
}
