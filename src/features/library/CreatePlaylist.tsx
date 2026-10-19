import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { useApi } from '../../components/Common';
import { folderPath, useLibrary, useMusicLibrary } from '../../state/library';
import { errorMessage } from '../../state/session';

export function CreatePlaylist({ parent = null, chooseFolder = false, onClose }: { parent?: string | null; chooseFolder?: boolean; onClose: () => void }) {
  const api = useApi(); const queryClient = useQueryClient(); const navigate = useNavigate(); const { libraryId, profile } = useMusicLibrary(); const [name, setName] = useState(''); const [folderId, setFolderId] = useState(parent); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function create(e: FormEvent) {
    e.preventDefault(); if (busy || !libraryId || !name.trim()) return; setBusy(true); setError('');
    try { const result = await api.createPlaylist(name.trim()); if (!result.id) throw new Error('服务器未返回新歌单，请刷新歌单列表核实。'); useLibrary.getState().place(api.identity, result.id, libraryId, folderId); await queryClient.invalidateQueries({ queryKey: [api.identity, 'playlists'] }); onClose(); navigate(`/playlists/${encodeURIComponent(result.id)}`); }
    catch (e) { setError(errorMessage(e)); void queryClient.invalidateQueries({ queryKey: [api.identity, 'playlists'] }); } finally { setBusy(false); }
  }
  return <Modal title="新建歌单" onClose={() => !busy && onClose()}><form onSubmit={create}><label>歌单名称<input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required disabled={busy} /></label>{chooseFolder ? <label>文件夹<Select aria-label="新歌单文件夹" value={folderId ?? ''} disabled={busy} onChange={(value) => setFolderId(value || null)}><option value="">根目录（留空）</option>{profile.folders.filter((f) => f.libraryId === libraryId).map((f) => <option key={f.id} value={f.id}>{folderPath(profile.folders, f.id)}</option>)}</Select></label> : <p className="field-hint">创建于 {folderId ? folderPath(profile.folders, folderId) : '歌单根目录'}</p>}{error && <p role="alert" className="form-error">{error}</p>}<button className="primary-button" disabled={busy || !name.trim()}>{busy ? '正在创建…' : '创建歌单'}</button></form></Modal>;
}
