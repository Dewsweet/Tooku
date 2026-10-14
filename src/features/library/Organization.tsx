import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Folder, FolderPlus, ListMusic, MoreHorizontal, Trash2 } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { IconButton, useApi, QueryState } from '../../components/Common';
import { descendants, emptyLibraryProfile, playlistPlacement, removeFolder, reparentFolder, useLibrary, useMusicLibrary } from '../../state/library';
import type { Playlist } from '../../domain/models';

export function FolderEditor({ id, parent = null, onClose }: { id?: string; parent?: string | null; onClose: () => void }) {
  const api = useApi(); const { libraryId, profile } = useMusicLibrary(); const change = useLibrary((s) => s.change); const navigate = useNavigate();
  const existing = profile.folders.find((f) => f.id === id); const [name, setName] = useState(existing?.name ?? ''); const [parentId, setParentId] = useState(existing?.parentId ?? parent); const [error, setError] = useState('');
  const forbidden = id ? descendants(profile.folders, id) : new Set();
  function save(event: FormEvent) {
    event.preventDefault(); if (!libraryId || !name.trim()) return;
    if (profile.folders.some((f) => f.id !== id && f.libraryId === libraryId && f.parentId === parentId && f.name === name.trim())) { setError('这个位置已经有同名文件夹。'); return; }
    change(api.identity, (p) => id ? { ...reparentFolder(p, id, parentId), folders: reparentFolder(p, id, parentId).folders.map((f) => f.id === id ? { ...f, name: name.trim() } : f) } : { ...p, folders: [...p.folders, { id: crypto.randomUUID(), name: name.trim(), libraryId, parentId }] }); onClose();
  }
  return <Modal title={id ? '管理文件夹' : '新建文件夹'} onClose={onClose}><form onSubmit={save}><label>名称<input required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label><label>位置<select aria-label="文件夹位置" value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}><option value="">歌单根目录</option>{profile.folders.filter((f) => f.libraryId === libraryId && !forbidden.has(f.id)).map((f) => <option key={f.id} value={f.id}>{folderPath(profile.folders, f.id)}</option>)}</select></label>{error && <p role="alert" className="form-error">{error}</p>}<div className="button-row"><button className="primary-button" disabled={!name.trim()}>保存</button>{id && <button type="button" className="subtle-button" title="歌单与子文件夹会移到上一级，不删除服务器歌单" onClick={() => { change(api.identity, (p) => removeFolder(p, id)); onClose(); navigate('/playlists'); }}><Trash2 size={16} />删除文件夹</button>}</div></form></Modal>;
}
export function folderPath(folders: typeof emptyLibraryProfile.folders, id: string): string {
  const parts: string[] = []; const visited = new Set(); let current = folders.find((f) => f.id === id);
  while (current && !visited.has(current.id)) { visited.add(current.id); parts.unshift(current.name); current = folders.find((f) => f.id === current!.parentId); }
  return parts.join(' / ');
}
export function PlaylistLocation({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
  const api = useApi(); const { libraries, profile, defaultId } = useMusicLibrary(); const place = useLibrary((s) => s.place); const navigate = useNavigate();
  const before = playlistPlacement(profile, playlist.id, defaultId ?? ''); const [libraryId, setLibraryId] = useState(before.libraryId); const [folderId, setFolderId] = useState(before.folderId);
  return <Modal title="移动歌单" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); if (!libraries.some((l) => l.id === libraryId)) return; place(api.identity, playlist.id, libraryId, folderId); onClose(); navigate('/playlists'); }}><p>{playlist.name}</p><label>音乐库<select aria-label="歌单音乐库" value={libraryId} onChange={(e) => { setLibraryId(e.target.value); setFolderId(null); }}>{libraries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>文件夹<select aria-label="歌单文件夹" value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)}><option value="">歌单根目录</option>{profile.folders.filter((f) => f.libraryId === libraryId).map((f) => <option key={f.id} value={f.id}>{folderPath(profile.folders, f.id)}</option>)}</select></label><button className="primary-button">移动</button></form></Modal>;
}
export function PlaylistTree({ closeNavigation }: { closeNavigation: () => void }) {
  const api = useApi(); const { libraryId, defaultId, profile } = useMusicLibrary(); const [editing, setEditing] = useState<{ id?: string; parent?: string | null } | null>(null); const [closed, setClosed] = useState<Set<string>>(new Set());
  const query = useQuery({ queryKey: [api.identity, 'playlists'], queryFn: ({ signal }) => api.playlists(signal) });
  const playlists = (query.data ?? []).filter((p) => playlistPlacement(profile, p.id, defaultId ?? '').libraryId === libraryId);
  const folders = profile.folders.filter((f) => f.libraryId === libraryId);
  const branch = (parentId: string | null, depth = 0): React.ReactNode => depth > 30 ? null : <>{folders.filter((f) => f.parentId === parentId).map((f) => <div className="tree-folder" key={f.id}><div className="tree-folder-heading"><button className="tree-disclosure" aria-label={`${closed.has(f.id) ? '展开' : '收起'}文件夹 ${f.name}`} aria-expanded={!closed.has(f.id)} onClick={() => setClosed((prev) => { const next = new Set(prev); if (next.has(f.id)) next.delete(f.id); else next.add(f.id); return next; })}>{closed.has(f.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button><Link className="tree-folder-link" to={`/playlists?folder=${encodeURIComponent(f.id)}`} onClick={closeNavigation}><Folder size={16} /><span>{f.name}</span></Link><IconButton label={`管理文件夹 ${f.name}`} onClick={() => setEditing({ id: f.id })}><MoreHorizontal size={16} /></IconButton></div>{!closed.has(f.id) && <div className="tree-children">{branch(f.id, depth + 1)}</div>}</div>)}{playlists.filter((p) => playlistPlacement(profile, p.id, defaultId ?? '').folderId === parentId).map((p) => <NavLink className="tree-playlist" to={`/playlists/${encodeURIComponent(p.id)}`} key={p.id} onClick={closeNavigation}><ListMusic size={16} /><span>{p.name}</span></NavLink>)}</>;
  return <section className="sidebar-playlists"><div className="sidebar-group-heading"><NavLink to="/playlists" onClick={closeNavigation}>歌单</NavLink><IconButton label="新建歌单文件夹" disabled={!libraryId} onClick={() => setEditing({})}><FolderPlus size={18} /></IconButton></div><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} /><nav className="playlist-tree" aria-label="歌单文件夹">{branch(null)}</nav>{!playlists.length && !folders.length && !query.isPending && !query.error && <Link className="tree-empty" to="/playlists" onClick={closeNavigation}>创建第一张歌单</Link>}{editing && <FolderEditor {...editing} onClose={() => setEditing(null)} />}</section>;
}
