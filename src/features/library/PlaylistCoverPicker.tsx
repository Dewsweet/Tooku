import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { AvatarEditor } from '../../components/AvatarEditor';
import { EntityArtwork } from '../../components/EntityArtwork';
import { useApi } from '../../components/Common';
import type { Playlist } from '../../domain/models';
import { useProfiles } from '../../state/profile';
import { browserStorageWriteRevision } from '../../storage/browserStorage';

export function PlaylistCoverPicker({ playlist, editable, disabled, fallback }: { playlist: Playlist; editable: boolean; disabled: boolean; fallback?: string }) {
  const api = useApi();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  function save(image: string) {
    const previous = useProfiles.getState().playlistCovers[api.identity]?.[playlist.id];
    const before = browserStorageWriteRevision();
    try {
      useProfiles.getState().setPlaylistCover(api.identity, playlist.id, image);
      if (browserStorageWriteRevision() === before) return;
    } catch { /* Restore below after an unexpected store failure. */ }
    try { useProfiles.getState().setPlaylistCover(api.identity, playlist.id, previous); }
    catch { /* The in-memory adapter normally keeps the visible previous cover available. */ }
    throw new Error('封面未能保存，请检查浏览器存储空间。');
  }
  return <>
    <button type="button" className="playlist-hero-cover" disabled={!editable || disabled} aria-label={editable ? '更换歌单封面' : '歌单封面（只读）'} data-tooltip={editable ? '更换歌单封面' : '当前账号没有编辑权限，无法更换封面'} onDragStart={(event) => event.preventDefault()} onClick={() => input.current?.click()}>
      <EntityArtwork id={playlist.id} name={playlist.name} kind="playlist" coverArt={playlist.coverArt} fallback={fallback} className="entity-detail-cover" />
      {editable && <span><Pencil size={30} />选择照片</span>}
    </button>
    {editable && <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="上传歌单封面" disabled={disabled} onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) setFile(selected); }} />}
    {file && <AvatarEditor kind="cover" file={file} onSave={save} onClose={() => setFile(null)} />}
  </>;
}
