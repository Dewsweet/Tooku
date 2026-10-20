import { useState } from 'react';
import { ListMusic, Maximize2, SlidersHorizontal, X, Music2 } from 'lucide-react';
import { Cover, IconButton, formatTime } from '../../components/Common';
import { Modal } from '../../components/Modal';
import { ScrollArea } from '../../components/ScrollArea';
import { AlbumLink, ArtistLinks } from '../../components/TrackLinks';
import { normalizePanelSections, usePreferences } from '../../state/preferences';
import { usePlayer, player } from './engine';
import { Lyrics } from './Lyrics';
import { PanelLayoutControls } from './PanelLayoutControls';
import { QueuePanel } from './QueuePanel';
import './panel.css';

export function NowPlayingPanel({ openQueue, openPlayer, onClose, view, onViewChange }: { openQueue: () => void; openPlayer: () => void; onClose: () => void; view: 'now'|'queue'; onViewChange: (view: 'now'|'queue') => void }) {
  const entries = usePlayer((s) => s.entries); const currentId = usePlayer((s) => s.currentId); const currentIndex = entries.findIndex((e) => e.entryId === currentId); const current = entries[currentIndex];
  const prefs = usePreferences(); const [configuring, setConfiguring] = useState(false); const sections = normalizePanelSections(prefs.panelSections).filter((s) => s.enabled);
  const queuePreview = entries.slice(Math.max(0, currentIndex), Math.max(0, currentIndex) + 6);
  return <aside className="now-panel" aria-label="播放侧栏"><header className="now-panel-heading"><div className="panel-view-tabs" role="group" aria-label="播放侧栏视图"><button aria-pressed={view === 'now'} onClick={() => onViewChange('now')}>正在播放</button><button aria-pressed={view === 'queue'} onClick={() => onViewChange('queue')}>队列</button></div><div><IconButton label="调整侧栏版块" onClick={() => setConfiguring(true)}><SlidersHorizontal size={17} /></IconButton><IconButton label="关闭播放侧栏" onClick={onClose}><X size={19} /></IconButton></div></header>
    <ScrollArea className="now-panel-scroll" scope={view} label="播放侧栏滚动条">{view === 'queue' ? <QueuePanel /> : <div className="now-panel-stack" key={sections.map((s) => s.id).join('-')}>
      {!sections.length && <div className="panel-placeholder"><SlidersHorizontal size={28} /><p>按你的习惯安排这里</p><button className="subtle-button" onClick={() => setConfiguring(true)}>选择显示版块</button></div>}
      {sections.map(({ id }) => <section className={`panel-module panel-module-${id}`} key={id} aria-label={{ cover: '歌曲封面', lyrics: '侧栏歌词', details: '歌曲详情', queue: '侧栏播放队列' }[id]}>
        {id === 'cover' && (current ? <div className="panel-record"><button className="panel-cover" aria-label={`展开播放器：${current.track.title}`} onClick={openPlayer}><Cover id={current.track.coverArt} size={700} /><span className="panel-cover-expand"><Maximize2 size={20} /></span></button><h3><AlbumLink track={current.track} title /></h3><div className="panel-artist"><ArtistLinks track={current.track} resolve /></div></div> : <div className="panel-placeholder"><Music2 size={42} /><p>选择一首喜欢的歌</p></div>)}
        {id === 'lyrics' && <><div className="panel-module-heading"><h3>歌词</h3><IconButton label="展开完整歌词" disabled={!current} onClick={openPlayer}><Maximize2 size={16} /></IconButton></div>{current ? <Lyrics key={current.track.id} track={current.track} /> : <p className="panel-muted">播放后显示歌词</p>}</>}
        {id === 'details' && <><div className="panel-module-heading"><h3>歌曲详情</h3></div>{current ? <dl className="panel-detail-list"><div><dt>歌手</dt><dd><ArtistLinks track={current.track} resolve /></dd></div><div><dt>专辑</dt><dd><AlbumLink track={current.track} /></dd></div><div><dt>时长</dt><dd>{formatTime(current.track.duration)}</dd></div>{current.track.suffix && <div><dt>源文件</dt><dd>{current.track.suffix.toUpperCase()}{current.track.bitRate ? ` · ${current.track.bitRate} kbps` : ''}</dd></div>}</dl> : <p className="panel-muted">还没有正在播放的歌曲</p>}</>}
        {id === 'queue' && <><div className="panel-module-heading"><h3>播放队列</h3><IconButton label="打开完整播放队列" onClick={openQueue}><ListMusic size={18} /></IconButton></div>{queuePreview.length ? <div className="panel-queue-list">{queuePreview.map((entry) => <button className={`panel-next-track ${entry.entryId === currentId ? 'is-current' : ''}`} key={entry.entryId} aria-current={entry.entryId === currentId} onClick={() => player.select(entry.entryId)}><Cover id={entry.track.coverArt} size={120} /><span><strong>{entry.track.title}</strong><span>{entry.track.artist}</span></span><span className="panel-track-time">{formatTime(entry.track.duration)}</span></button>)}<button className="panel-queue-all" onClick={openQueue}>查看队列 · {entries.length} 首</button></div> : <p className="panel-muted">队列还是空的</p>}</>}
      </section>)}
    </div>}</ScrollArea>{configuring && <Modal title="调整播放侧栏" onClose={() => setConfiguring(false)}><PanelLayoutControls /></Modal>}
  </aside>;
}
