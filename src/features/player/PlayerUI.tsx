import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Volume1, ListMusic, Maximize2, ChevronUp, X, ChevronDown, LoaderCircle, Heart, Mic2, SlidersHorizontal, ArrowUpRight, Check, Music2 } from 'lucide-react';
import { Cover, Empty, IconButton, QueryState, formatTime, useApi, toggleFavorite } from '../../components/Common';
import { Modal } from '../../components/Modal';
import { usePlayer, player } from './engine';
import { lyricIndex } from '../../domain/queue';
import { usePreferences } from '../../state/preferences';
import { usePlaybackPosition, useReducedMotion } from './playback-hooks';
import type { Track } from '../../domain/models';

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
    <button className="duration-time" title={remaining ? '显示总时长' : '显示剩余时间'} aria-label={remaining ? '显示总时长' : '显示剩余时间'} onClick={() => setRemaining(!remaining)}>{duration ? `${remaining ? '−' : ''}${formatTime(remaining ? duration - displayed : duration)}` : '—:—'}</button>
  </div>;
}

export function Transport({ large = false }: { large?: boolean }) {
  const status = usePlayer((s) => s.status); const currentId = usePlayer((s) => s.currentId); const shuffle = usePlayer((s) => s.shuffle); const repeat = usePlayer((s) => s.repeat);
  const active = ['playing', 'buffering', 'loading'].includes(status); const repeatLabel = { off: '关闭', all: '列表', one: '单曲' }[repeat];
  return <div className={`transport ${large ? 'large' : ''}`}>
    <IconButton label="随机播放" className={`icon-button mode-button ${shuffle ? 'selected' : ''}`} aria-pressed={shuffle} disabled={!currentId} onClick={() => player.shuffle()}><Shuffle size={19} /></IconButton>
    <IconButton label="上一首" disabled={!currentId} onClick={() => player.previous()}><SkipBack size={large ? 25 : 21} fill="currentColor" /></IconButton>
    <IconButton label={active ? '暂停' : '播放'} className={`icon-button play-button ${active ? 'is-active' : ''}`} disabled={!currentId} onClick={() => player.toggle()}>
      {status === 'buffering' || status === 'loading' ? <LoaderCircle className="spin" size={large ? 28 : 23} /> : <span key={active ? 'pause' : 'play'} className="transport-symbol">{active ? <Pause size={large ? 28 : 22} fill="currentColor" /> : <Play size={large ? 28 : 22} fill="currentColor" />}</span>}
    </IconButton>
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

function Volume({ room = false }: { room?: boolean }) {
  const volume = usePlayer((s) => s.volume); const supported = usePlayer((s) => s.volumeSupported); const previous = useRef(0.7);
  if (!supported) return <span className="volume-hint">使用系统音量</span>;
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return <div className={`volume-control ${room ? 'volume-room' : ''}`}><IconButton label={volume === 0 ? '取消静音' : '静音'} onClick={() => { if (volume > 0) { previous.current = volume; player.volume(0); } else player.volume(previous.current || 0.7); }}><Icon size={19} /></IconButton><input type="range" aria-label="音量" aria-valuetext={`${Math.round(volume * 100)}%`} min={0} max={1} step={0.01} value={volume} style={{ '--progress': `${volume * 100}%` } as CSSProperties} onChange={(e) => player.volume(Number(e.target.value))} /></div>;
}

export function PlayerBar({ openQueue, openLyrics, queueOpen = false }: { openQueue: () => void; openLyrics: () => void; queueOpen?: boolean }) {
  const state = usePlayer(); const current = state.entries.find((e) => e.entryId === state.currentId); const playing = state.status === 'playing';
  return <footer className={`player-bar playback-dock ${current ? 'has-track' : ''}`} aria-label="音乐播放器">
    <div className="dock-track"><button className="now-playing" onClick={openLyrics} disabled={!current} aria-label={current ? `展开播放器：${current.track.title}` : '选择歌曲开始播放'}>
      <span className="dock-art"><Cover id={current?.track.coverArt} size={160} className="mini-cover" /><span className="dock-expand"><ChevronUp size={19} /></span></span>
      <span key={current?.entryId} className="dock-metadata"><strong>{current?.track.title ?? '让喜欢的音乐响起来'}</strong><small>{current?.track.artist ?? '从你的音乐库开始'}</small></span>
    </button><Favorite track={current?.track} compact /></div>
    <div className="player-center"><Transport /><Progress /></div>
    <div className="player-right"><span className="dock-live" title={playing ? '正在播放' : '已暂停'}><Equalizer playing={playing} /></span><IconButton label="展开歌词播放器" disabled={!current} onClick={openLyrics}><Mic2 size={18} /></IconButton><IconButton label={`播放队列，${state.entries.length} 首`} aria-pressed={queueOpen} onClick={openQueue}><ListMusic size={21} /></IconButton><Volume /><IconButton label="展开完整播放器" disabled={!current} onClick={openLyrics}><Maximize2 size={18} /></IconButton></div>
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
    <div className="queue-intro"><div><span className="eyebrow">UP NEXT</span><h3>接下来播放<span>{Math.max(0, state.entries.length - index - 1)} 首</span></h3></div>{state.undo && <button className="text-button" onClick={() => state.undo && player.restoreQueue(state.undo)}>撤销替换</button>}</div>
    {state.entries.length ? <div className="queue-list" ref={ref}>{state.entries.map((entry, i) => <div className={`queue-row ${entry.entryId === state.currentId ? 'current' : ''}`} aria-current={entry.entryId === state.currentId} key={entry.entryId}>
      <button className="queue-select" onClick={() => player.select(entry.entryId)} aria-label={`播放队列第 ${i + 1} 首：${entry.track.title}`}><span className="queue-number">{entry.entryId === state.currentId ? <Equalizer playing={state.status === 'playing'} /> : i + 1}</span><Cover id={entry.track.coverArt} size={120} className="track-cover" /><span><strong>{entry.track.title}</strong><small>{entry.track.artist}</small></span></button>
      <span className="queue-duration">{formatTime(entry.track.duration)}</span><div className="queue-item-actions"><IconButton label={`上移 ${entry.track.title}`} disabled={i === 0} onClick={() => player.move(i, i - 1)}><ChevronUp size={16} /></IconButton><IconButton label={`下移 ${entry.track.title}`} disabled={i === state.entries.length - 1} onClick={() => player.move(i, i + 1)}><ChevronDown size={16} /></IconButton><IconButton label={`移除 ${entry.track.title}`} onClick={() => player.remove(entry.entryId)}><X size={16} /></IconButton></div>
    </div>)}</div> : <Empty title="下一首，由你决定">从音乐库播放歌曲，或将歌曲添加到队列。</Empty>}
    <p className="queue-footnote">按顺序播放 · 调序不会打断当前音乐</p>
  </div>;
}
export function Queue({ onClose }: { onClose: () => void }) {
  return <Modal title="播放队列" variant="queue" onClose={onClose}><QueueContents /></Modal>;
}

function Lyrics({ track }: { track?: Track }) {
  const api = useApi(); const preferences = usePreferences(); const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null); const [follow, setFollow] = useState(true); const position = usePlayer((s) => s.position);
  const query = useQuery({ queryKey: [api.identity, 'lyrics', track?.id], enabled: Boolean(track), queryFn: ({ signal }) => api.lyrics(track!.id, track!.artist, track!.title, signal) });
  const lyrics = query.data; const delay = (lyrics?.offsetMs ?? 0) + preferences.lyricDelay;
  const active = lyrics?.synced ? lyricIndex(lyrics.lines.map((l) => l.startMs), position * 1000 - delay) : -1;
  useEffect(() => {
    const container = ref.current; const line = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (follow && line && container) container.scrollTo({ top: Math.max(0, line.offsetTop - container.offsetTop - container.clientHeight * 0.36), behavior: reduced ? 'instant' : 'smooth' });
  }, [active, follow, reduced, track?.id]);
  return <div className="room-lyrics-panel"><div className="room-panel-label"><span>跟着旋律，慢慢听</span>{lyrics?.synced && <span className="synced-label"><Check size={12} />动态歌词</span>}</div>
    <QueryState pending={query.isPending && Boolean(track)} error={query.error} retry={() => query.refetch()} />
    <div ref={ref} className="room-lyrics-lines" style={{ '--lyric-size': `${preferences.lyricSize}px` } as CSSProperties} onWheel={() => setFollow(false)} onTouchStart={() => setFollow(false)} tabIndex={0} aria-label="歌词内容" onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setFollow(false); }}>
      {lyrics?.lines.length ? lyrics.lines.map((line, i) => <button className={`room-lyric ${lyrics.synced && i !== active ? 'inactive' : ''} ${i === active ? 'current' : ''}`} key={`${track?.id}-${i}`} aria-current={i === active} disabled={line.startMs === undefined} onClick={() => { if (line.startMs !== undefined) player.seek((line.startMs + delay) / 1000); setFollow(true); }}>{line.text || '♪'}</button>) : !query.isPending && !query.error && <div className="instrumental-state"><span className="instrumental-notes"><Music2 size={35} /></span><h3>让旋律说话</h3><p>这首歌暂时没有歌词。<br />放松一下，好好听。</p></div>}
    </div>
    <div className="room-lyrics-footer"><span>{lyrics?.lines.length ? `来自音乐服务器${lyrics.synced ? '' : ' · 静态歌词'}` : '你的音乐，你的节奏'}</span>{!follow && lyrics?.synced && <button className="follow-button subtle-button" onClick={() => setFollow(true)}><ArrowUpRight size={15} />回到当前歌词</button>}</div>
  </div>;
}

export function LyricsPlayer({ onClose }: { onClose: () => void }) {
  const state = usePlayer(); const current = state.entries.find((e) => e.entryId === state.currentId); const preferences = usePreferences();
  const [panel, setPanel] = useState<'lyrics' | 'queue'>('lyrics'); const [options, setOptions] = useState(false);
  const index = state.entries.findIndex((e) => e.entryId === state.currentId); const next = state.entries[index + 1];
  return <Modal title="正在播放" variant="player" onClose={onClose}>
    <div className="room-backdrop" aria-hidden="true"><Cover id={current?.track.coverArt} size={240} /></div>
    <div className="room-topline"><div className="room-collection"><span className="room-brand">t.</span><span>来自你的音乐库<small>{current?.track.album ?? 'TOOKU · MUSIC FOR YOU'}</small></span></div><div className="room-tabs" role="tablist" aria-label="播放器内容"><button role="tab" aria-selected={panel === 'lyrics'} aria-controls="room-lyrics" onClick={() => setPanel('lyrics')}><Mic2 size={16} />歌词</button><button role="tab" aria-selected={panel === 'queue'} aria-controls="room-queue" onClick={() => setPanel('queue')}><ListMusic size={17} />队列<span>{state.entries.length}</span></button></div></div>
    <div className="room-body"><section className="room-record" aria-label="当前歌曲"><div key={current?.entryId} className={`room-artwork ${state.status === 'playing' ? 'is-playing' : ''}`}><Cover id={current?.track.coverArt} size={900} /><div className="artwork-sheen" /></div>
      <div className="room-song"><div key={current?.entryId} className="room-song-copy"><h1>{current?.track.title ?? '选择一首喜欢的歌'}</h1><p>{current?.track.artist ?? 'Tooku'}</p></div><Favorite track={current?.track} /></div>
      <div className="room-signal"><Equalizer playing={state.status === 'playing'} /><span>{({ playing: '正在播放', paused: '已暂停', loading: '正在加载', buffering: '正在缓冲', blocked: '点击播放以继续', error: '播放遇到问题', idle: '等待播放' })[state.status]}</span>{current?.track.suffix && <span className="format-badge">{current.track.suffix.toUpperCase()}<span>源文件</span></span>}</div>
      <Progress context="room" /><Transport large />
      <div className="room-extras"><Volume room /><IconButton label="歌词显示设置" aria-expanded={options} className={`icon-button ${options ? 'selected' : ''}`} onClick={() => setOptions(!options)}><SlidersHorizontal size={18} /></IconButton></div>
      {options && <div className="room-options"><label>歌词字号<select value={preferences.lyricSize} onChange={(e) => preferences.update({ lyricSize: Number(e.target.value) })}>{[24, 30, 36, 42].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><label>歌词延迟 · 毫秒<input type="number" step={100} min={-10000} max={10000} value={preferences.lyricDelay} onChange={(e) => preferences.update({ lyricDelay: Math.max(-10000, Math.min(10000, Number(e.target.value))) })} /></label></div>}
      {state.error && <div className="room-error" role="alert"><p>{state.error}</p><button className="text-button" onClick={() => player.mode('compatible')}>使用兼容模式重试</button></div>}
    </section><section className="room-content" id={panel === 'lyrics' ? 'room-lyrics' : 'room-queue'} role="tabpanel" aria-label={panel === 'lyrics' ? '歌词' : '队列'} key={panel}>{panel === 'lyrics' ? <Lyrics key={current?.track.id} track={current?.track} /> : <QueueContents embedded />}</section></div>
    <div className="room-bottom"><span>TOOKU<span className="room-bottom-divider" />只听喜欢的</span>{next ? <button className="room-next" aria-label={`下一首：${next.track.title}`} onClick={() => player.next()}><Cover id={next.track.coverArt} size={100} className="next-cover" /><span><small>下一首</small><strong>{next.track.title}</strong></span><SkipForward size={15} /></button> : <span className="room-last">{state.entries.length ? '队列中的最后一首' : '音乐随时在这里'}</span>}</div>
  </Modal>;
}
