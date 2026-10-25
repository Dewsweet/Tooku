import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { ImagePlus, Pencil } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { AvatarEditor } from '../../components/AvatarEditor';
import { EntityArtwork } from '../../components/EntityArtwork';
import { useApi } from '../../components/Common';
import type { Playlist } from '../../domain/models';
import { useProfiles } from '../../state/profile';
import { errorMessage, useSession } from '../../state/session';
import { browserStorageWriteRevision } from '../../storage/browserStorage';

export function PlaylistDetailsEditor({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
  const api = useApi(); const queryClient = useQueryClient(); const [name, setName] = useState(playlist.name); const [comment, setComment] = useState(playlist.comment ?? ''); const storedCover = useProfiles((s) => s.playlistCovers?.[api.identity]?.[playlist.id]); const [cover, setCover] = useState<string | null | undefined>(storedCover); const [file, setFile] = useState<File | null>(null); const input = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy || !name.trim()) return; setBusy(true); setError('');
    try {
      if (name.trim() !== playlist.name || comment.trim() !== (playlist.comment ?? '')) { const saved = await api.updatePlaylistDetails(playlist.id, { name: name.trim(), comment: comment.trim() }, playlist.changed); queryClient.setQueryData([api.identity, 'playlist', playlist.id], saved); await queryClient.invalidateQueries({ queryKey: [api.identity, 'playlists'] }); }
      if (cover !== storedCover) {
        const before = browserStorageWriteRevision();
        useProfiles.getState().setPlaylistCover(api.identity, playlist.id, cover ?? undefined);
        if (browserStorageWriteRevision() !== before) throw new Error('封面未能保存，请检查浏览器存储空间。');
      }
      useSession.getState().notify('歌单信息已保存'); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <><Modal title="歌单信息" busy={busy} onClose={onClose}>
    <form onSubmit={save}>
      <div className="playlist-details-editor">
        <button type="button" className="playlist-edit-cover" disabled={busy} data-tooltip="选择歌单封面" aria-label="选择歌单封面" onClick={() => input.current?.click()}>
          {cover ? <img src={cover} alt="歌单封面预览" /> : <EntityArtwork id={playlist.id} name={playlist.name} kind="playlist" coverArt={playlist.coverArt} local={false} />}
          <span><ImagePlus size={22} />选择照片</span>
        </button>
        <div className="playlist-details-fields">
          <label>名称<input required maxLength={200} disabled={busy} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label>简介<textarea rows={4} maxLength={2000} disabled={busy} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="简介（可选）" /></label>
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="上传歌单封面" onChange={(e) => { const next = e.target.files?.[0]; e.target.value = ''; if (next) setFile(next); }} />
      {error && <div className="form-error" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={() => queryClient.invalidateQueries({ queryKey: [api.identity, 'playlist', playlist.id] })}>重新读取服务器信息</button></div>}
      <div className="playlist-details-actions">
        {cover && <button type="button" className="text-button" disabled={busy} onClick={() => setCover(null)}>恢复原封面</button>}
        <button className="primary-button" disabled={busy || !name.trim()}><Pencil size={16} />{busy ? '正在保存…' : '保存'}</button>
      </div>
    </form>
  </Modal>{file && <AvatarEditor kind="cover" file={file} onSave={setCover} onClose={() => setFile(null)} />}</>;
}
