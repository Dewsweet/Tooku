import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Volume1, ListMusic, ListPlus, ChevronUp, X, ChevronDown, LoaderCircle, Heart, Mic2, Disc3, Ellipsis } from 'lucide-react';
import { Cover, Empty, IconButton, formatTime, useApi, toggleFavorite } from '../../components/Common';
import { Modal } from '../../components/Modal';
import { usePlayer, player } from './engine';
import { Lyrics } from './Lyrics';
import { useContextMenu, type MenuItem } from '../../components/Interactions';
import { usePlaybackPosition, useReducedMotion } from './playback-hooks';
import type { Track } from '../../domain/models';
import { PlaybackSourceLink, ArtistLinks } from '../../components/TrackLinks';
import { FullscreenButton } from './FullscreenButton';
import { ScrollingText } from './ScrollingText';
import { DesktopLyricsButton } from './DesktopLyrics';

export function Progress({ context = 'dock' }: { context?: 'dock' | 'room' }) {
  const position = usePlaybackPosition(); const duration = usePlayer((s) => s.duration); const entryId = usePlayer((s) => s.currentId);
  const [preview, setPreview] = useState<{ value: number; entryId: string | null } | null>(null);
  const [remaining, setRemaining] = useState(false); const draft = useRef(preview);
  const displayed = Math.max(0, Math.min(preview?.entryId === entryId ? preview.value : position, duration || 0));
  const commit = () => { if (draft.current && draft.current.entryId === usePlayer.getState().currentId) player.seek(draft.current.value); draft.current = null; setPreview(null); };
  return <div className={`progress seek-control seek-${context}`}>
    <span className="elapsed-time">{formatTime(displayed)}</span>
    <div className={`seek-track ${preview?.entryId === entryId ? 'is-scrubbing' : ''}`} style={{ '--progress': `${duration ? displayed / duration * 100 : 0}%` } as CSSProperties}>
      {preview?.entryId === entryId && <span className="seek-tooltip" aria-hidden="true" style={{ left: `${duration ? displayed / duration * 100 : 0}%` }}>{formatTime(displayed)}</span>}
      <input type="range" aria-label="播放进度" aria-valuetext={`${formatTime(displayed)}，共 ${formatTime(duration)}`} min={0} max={duration || 1} step={0.1} value={displayed} disabled={!duration}
        onChange={(e) => { const next = { value: Number(e.target.value), entryId }; draft.current = next; setPreview(next); }}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={() => { draft.current = null; setPreview(null); }} />
    </div>
    <button className="duration-time" data-tooltip={remaining ? '显示总时长' : '显示剩余时间'} aria-label={remaining ? '显示总时长' : '显示剩余时间'} onClick={() => setRemaining(!remaining)}>{duration ? `${remaining ? '−' : ''}${formatTime(remaining ? duration - displayed : duration)}` : '—:—'}</button>
  </div>;
}

export function PlayPauseButton({ large = false }: { large?: boolean }) {
  const status = usePlayer((state) => state.status); const currentId = usePlayer((state) => state.currentId);
  const active = ['playing', 'buffering', 'loading'].includes(status);
  return <IconButton label={active ? '暂停' : '播放'} className={`icon-button play-button ${active ? 'is-active' : ''}`} disabled={!currentId} onClick={() => player.toggle()}>
      {status === 'buffering' || status === 'loading' ? <LoaderCircle className="spin" size={large ? 28 : 23} /> : <span key={active ? 'pause' : 'play'} className="transport-symbol">{active ? <Pause size={large ? 28 : 22} fill="currentColor" /> : <Play size={large ? 28 : 22} fill="currentColor" />}</span>}
    </IconButton>;
}

export function Transport({ large = false }: { large?: boolean }) {
  const currentId = usePlayer((s) => s.currentId); const shuffle = usePlayer((s) => s.shuffle); const repeat = usePlayer((s) => s.repeat);
  const repeatLabel = { off: '关闭', all: '列表', one: '单曲' }[repeat];
  return <div className={`transport ${large ? 'large' : ''}`}>
    <IconButton label="随机播放" className={`icon-button mode-button ${shuffle ? 'selected' : ''}`} aria-pressed={shuffle} disabled={!currentId} onClick={() => player.shuffle()}><Shuffle size={19} /></IconButton>
    <IconButton label="上一首" disabled={!currentId} onClick={() => player.previous()}><SkipBack size={large ? 25 : 21} fill="currentColor" /></IconButton>
    <PlayPauseButton large={large} />
    <IconButton label="下一首" disabled={!currentId} onClick={() => player.next()}><SkipForward size={large ? 25 : 21} fill="currentColor" /></IconButton>
    <IconButton label={`循环：${repeatLabel}`} aria-pressed={repeat !== 'off'} className={`icon-button mode-button ${repeat !== 'off' ? 'selected' : ''}`} disabled={!currentId} onClick={() => player.repeat()}>{repeat === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}</IconButton>
  </div>;
}

function Equalizer({ playing }: { playing: boolean }) {
  return <span className={`playback-equalizer ${playing ? 'is-playing' : ''}`} aria-hidden="true"><i /><i /><i /><i /></span>;
}

function Favorite({ track, compact = false }: { track?: Track; compact?: boolean }) {
  const api = useApi(); const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: [api.identity, 'favorites'], queryFn: ({ signal }) => api.favorites(signal) });
  const starred = track && (query.data ? query.data.songs.some((s) => s.id === track.id) : Boolean(track.starred));
  return <IconButton label={starred ? '取消收藏当前歌曲' : '收藏当前歌曲'} disabled={!track || busy} aria-pressed={Boolean(starred)} className={`icon-button favorite-control ${compact ? 'compact' : ''}`} onClick={async () => { if (!track) return; setBusy(true); await toggleFavorite(api, { ...track, starred: starred ? 'true' : undefined }); setBusy(false); }}>{busy ? <LoaderCircle className="spin" size={19} /> : <Heart key={starred ? 'saved' : 'unsaved'} className={starred ? 'favorite-pop' : ''} size={20} fill={starred ? 'currentColor' : 'none'} />}</IconButton>;
}

function Volume() {
  const volume = usePlayer((s) => s.volume); const supported = usePlayer((s) => s.volumeSupported); const previous = useRef(0.7);
  if (!supported) return <span className="volume-hint">使用系统音量</span>;
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return <div className="volume-control"><IconButton label={volume === 0 ? '取消静音' : '静音'} onClick={() => { if (volume > 0) { previous.current = volume; player.volume(0); } else player.volume(previous.current || 0.7); }}><Icon size={19} /></IconButton><input type="range" aria-label="音量" aria-valuetext={`${Math.round(volume * 100)}%`} min={0} max={1} step={0.01} value={volume} style={{ '--progress': `${volume * 100}%` } as CSSProperties} onChange={(e) => player.volume(Number(e.target.value))} /></div>;
}

export function PlayerBar({ openQueue, openLyrics, queueOpen = false, mobile = false }: { openQueue: () => void; openLyrics: () => void; queueOpen?: boolean; mobile?: boolean }) {
  const state = usePlayer(); const current = state.entries.find((e) => e.entryId === state.currentId);
  const title = current ? <PlaybackSourceLink entry={current} /> : '选择一首歌';
  const artists = current && <ArtistLinks track={current.track} resolve />;
  return <footer className={`player-bar playback-dock ${current ? 'has-track' : ''}`} aria-label="音乐播放器">
    <div className="dock-track"><button className="now-playing" onClick={openLyrics} disabled={!current} aria-label={current ? `展开播放器：${current.track.title}` : '选择歌曲开始播放'}><span className="dock-art"><Cover id={current?.track.coverArt} size={160} className="mini-cover" /><span className="dock-expand"><ChevronUp size={19} /></span></span></button>
      <div key={current?.entryId} className="dock-metadata"><strong>{mobile && current ? <ScrollingText text={current.track.title}>{title}</ScrollingText> : title}</strong><small>{mobile && current ? <ScrollingText text={current.track.artist}>{artists}</ScrollingText> : artists}</small></div>{!mobile && <Favorite track={current?.track} compact />}</div>
    {!mobile && <div className="player-center"><Transport /><Progress /></div>}
    <div className="player-right">{mobile && <Favorite track={current?.track} compact />}<IconButton label={`播放队列，${state.entries.length} 首`} aria-pressed={queueOpen} onClick={openQueue}><ListMusic size={21} /></IconButton>{!mobile && <><Volume /><DesktopLyricsButton track={current?.track} /></>}{mobile ? <PlayPauseButton /> : <FullscreenButton disabled={!current} openPlayer={openLyrics} />}</div>
    {state.error && <div className="player-error" role="alert"><span>{state.error}</span><button onClick={() => player.play()}>重试</button><button onClick={() => player.mode('compatible')}>兼容模式</button></div>}
  </footer>;
}

export function QueueContents({ embedded = false }: { embedded?: boolean }) {
  const state = usePlayer(); const ref = useRef<HTMLDivElement>(null); const reduced = useReducedMotion();
  const index = state.entries.findIndex((e) => e.entryId === state.currentId);
  useEffect(() => {
    const row = ref.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row && ref.current) ref.current.scrollTo({ top: Math.max(0, row.offsetTop - ref.current.offsetTop - 16), behavior: reduced ? 'instant' : 'smooth' });
  }, [state.currentId, reduced]);
  return <div className={`queue-content ${embedded ? 'embedded' : ''}`}>
    <div className="queue-intro"><div>{!embedded && <span className="eyebrow">UP NEXT</span>}<h3>接下来播放<span>{Math.max(0, state.entries.length - index - 1)} 首</span></h3></div>{state.undo && <button className="text-button" onClick={() => state.undo && player.restoreQueue(state.undo)}>撤销替换</button>}</div>
    {state.entries.length ? <div className="queue-list" ref={ref}>{state.entries.map((entry, i) => <div className={`queue-row ${entry.entryId === state.currentId ? 'current' : ''}`} aria-current={entry.entryId === state.currentId} key={entry.entryId}>
      <button className="queue-select" onClick={() => player.select(entry.entryId)} aria-label={`播放队列第 ${i + 1} 首：${entry.track.title}`}><span className="queue-number">{entry.entryId === state.currentId ? <Equalizer playing={state.status === 'playing'} /> : i + 1}</span><Cover id={entry.track.coverArt} size={120} className="track-cover" /><span><strong>{entry.track.title}</strong><small>{entry.track.artist}</small></span></button>
      <span className="queue-duration">{formatTime(entry.track.duration)}</span><div className="queue-item-actions"><IconButton label={`上移 ${entry.track.title}`} disabled={i === 0} onClick={() => player.move(i, i - 1)}><ChevronUp size={16} /></IconButton><IconButton label={`下移 ${entry.track.title}`} disabled={i === state.entries.length - 1} onClick={() => player.move(i, i + 1)}><ChevronDown size={16} /></IconButton><IconButton label={`移除 ${entry.track.title}`} onClick={() => player.remove(entry.entryId)}><X size={16} /></IconButton></div>
    </div>)}</div> : <Empty title="下一首，由你决定">从音乐库播放歌曲，或将歌曲添加到队列。</Empty>}
    {!embedded && <p className="queue-footnote">按顺序播放 · 调序不会打断当前音乐</p>}
  </div>;
}
export function Queue({ onClose }: { onClose: () => void }) {
  return <Modal title="播放队列" variant="queue" onClose={onClose}><QueueContents /></Modal>;
}

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
    <div className="room-body"><section className="room-record" aria-label="当前歌曲"><div className="room-artwork-slot"><div key={track?.id} className="room-artwork"><Cover id={track?.coverArt} size={900} /><div className="artwork-sheen" /></div></div>
      <div className="room-song"><div key={track?.id} className="room-song-copy"><h1><ScrollingText text={track?.title ?? '选择一首喜欢的歌'} /></h1><p><ScrollingText text={track?.artist ?? 'Tooku'} /></p></div><div className="room-song-actions"><Favorite track={track} /><IconButton label="当前歌曲更多选项" aria-haspopup="menu" disabled={!track} onClick={(event) => menu(event, items)}><Ellipsis size={22} /></IconButton></div></div>
      <Progress context="room" /><Transport large />
      {state.status === 'blocked' && !state.error && <div className="room-error" role="status">点击播放以继续</div>}
      {state.error && <div className="room-error" role="alert"><p>{state.error}</p><button className="text-button" onClick={() => player.mode('compatible')}>使用兼容模式重试</button></div>}
    </section><section className="room-content" aria-label="歌词"><Lyrics key={track?.id} track={track} toolbarHost={lyricToolbar} /></section></div>
  </Modal>;
}
