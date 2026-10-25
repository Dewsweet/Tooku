import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Disc3, Ellipsis, ListMusic, ListPlus, Mic2 } from 'lucide-react';
import { Cover, IconButton, useApi } from '../../components/Common';
import { Modal } from '../../components/Modal';
import { useContextMenu, type MenuItem } from '../../components/Interactions';
import type { Track } from '../../domain/models';
import { Lyrics } from './Lyrics';
import { FullscreenButton } from './FullscreenButton';
import { PlayerPages } from './PlayerPages';
import { ScrollingText } from './ScrollingText';
import { player, usePlayer } from './engine';
import { Favorite, Progress, Transport } from './PlayerUI';

export function LyricsPlayer({ onClose, addToPlaylist }: { onClose: () => void; addToPlaylist: (track: Track) => void }) {
  const [lyricToolbar, setLyricToolbar] = useState<HTMLDivElement | null>(null);
  const state = usePlayer(); const track = state.entries.find((e) => e.entryId === state.currentId)?.track;
  const api = useApi(); const menu = useContextMenu(); const navigate = useNavigate();
  const detail = useQuery({ queryKey: [api.identity, 'song', track?.id], enabled: Boolean(track && (!track.albumId || !(track.artistId || track.artists?.some((artist) => artist.id)))), queryFn: ({ signal }) => api.song(track!.id, signal) });
  const source = track && detail.data?.id === track.id ? {
    ...track, ...detail.data,
    albumId: detail.data.albumId ?? track.albumId,
    artistId: detail.data.artistId ?? track.artistId,
    artists: detail.data.artists?.some((artist) => artist.id) ? detail.data.artists : track.artists,
  } : track;
  const artists = source?.artists?.some((artist) => artist.id) ? source.artists : [{ id: source?.artistId, name: source?.artist ?? '' }];
  const playbackSource = state.entries.find((entry) => entry.entryId === state.currentId)?.source;
  const playlistId = playbackSource?.kind === 'playlist' ? playbackSource.id : undefined;
  const showPage = (path: string) => { onClose(); navigate(path); };
  const items: MenuItem[] = [
    { label: '查看专辑', icon: <Disc3 size={16} />, disabled: !source?.albumId, action: () => { if (source?.albumId) showPage(`/albums/${encodeURIComponent(source.albumId)}`); } },
    ...artists.map((artist) => ({ label: artists.length > 1 ? `查看歌手 ${artist.name}` : '查看歌手', icon: <Mic2 size={16} />, disabled: !artist.id, action: () => { if (artist.id) showPage(`/artists/${encodeURIComponent(artist.id)}`); } })),
    { label: '查看歌单', icon: <ListMusic size={16} />, disabled: !playlistId, action: () => { if (playlistId) showPage(`/playlists/${encodeURIComponent(playlistId)}`); } },
    { label: '添加到歌单', icon: <ListPlus size={16} />, divider: true, disabled: !track, action: () => { if (track) addToPlaylist(track); } },
  ];
  return <Modal title="正在播放" variant="player" onClose={onClose} headerActions={<><div className="player-lyric-actions" ref={setLyricToolbar} /><span className="player-toolbar-divider" aria-hidden="true" /><FullscreenButton /></>} onContextMenu={(event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('dialog') !== event.currentTarget) return;
    if (target.closest('[role="menu"], [role="listbox"]')) { event.preventDefault(); event.stopPropagation(); return; }
    menu(event, items);
  }}>
    <div className="room-backdrop" aria-hidden="true"><Cover id={track?.coverArt} size={240} /></div>
    <PlayerPages controls={<><div className="room-artwork-slot"><div key={track?.id} className="room-artwork"><Cover id={track?.coverArt} size={900} /><div className="artwork-sheen" /></div></div>
      <div className="room-song"><div key={track?.id} className="room-song-copy"><h1><ScrollingText text={track?.title ?? '选择一首喜欢的歌'} /></h1><p><ScrollingText text={track?.artist ?? 'Tooku'} /></p></div><div className="room-song-actions"><Favorite track={track} /><IconButton label="当前歌曲更多选项" aria-haspopup="menu" disabled={!track} onClick={(event) => menu(event, items)}><Ellipsis size={22} /></IconButton></div></div>
      <Progress context="room" /><Transport large />
      {state.status === 'blocked' && !state.error && <div className="room-error" role="status">点击播放以继续</div>}
      {state.error && <div className="room-error" role="alert"><p>{state.error}</p><button className="text-button" onClick={() => player.mode('compatible')}>使用兼容模式重试</button></div>}
    </>} lyrics={<Lyrics key={track?.id} track={track} toolbarHost={lyricToolbar} />} />
  </Modal>;
}
