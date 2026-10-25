import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, ListMusic } from 'lucide-react';
import { Empty, QueryState, useApi } from '../components/Common';
import { Modal } from '../components/Modal';
import { errorMessage, queryClient, useSession } from '../state/session';
import type { Track } from '../domain/models';
import { playlistPermissions } from '../domain/playlistPermissions';
import { playlistPlacement, useMusicLibrary } from '../state/library';
export { Playlists, PlaylistDetail } from '../features/library/PlaylistViews';
export function AddToPlaylist({ track, onClose }: { track: Track; onClose: () => void }) {
  const api = useApi(); const { libraryId, defaultId, profile } = useMusicLibrary(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const query = useQuery({ queryKey: [api.identity, 'playlists'], queryFn: ({ signal }) => api.playlists(signal) });
  return <Modal title="添加到歌单" onClose={() => !busy && onClose()}><p className="muted">{track.title} · {track.artist}</p><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{query.data?.filter((list) => playlistPermissions(list, api.username).canReorder && playlistPlacement(profile, list.id, defaultId ?? '').libraryId === libraryId).map((list) => <button className="playlist-choice" key={list.id} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const before = await api.playlist(list.id); await api.savePlaylist(list.id, before.name, [...before.songs.map((s) => s.id), track.id], before.changed); await queryClient.invalidateQueries({ queryKey: [api.identity] }); useSession.getState().notify(`已添加到「${list.name}」`); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}><ListMusic size={20} /><span>{list.name}</span><Plus size={17} /></button>)}{query.data && !query.data.some((list) => playlistPermissions(list, api.username).canReorder && playlistPlacement(profile, list.id, defaultId ?? '').libraryId === libraryId) && <Empty title="没有可编辑的歌单">先到歌单页面创建一张歌单。</Empty>}{error && <p className="form-error" role="alert">{error}</p>}</Modal>;
}
