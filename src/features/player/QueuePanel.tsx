import { ChevronDown, ChevronUp, Ellipsis, X } from 'lucide-react';
import { Cover, Empty, IconButton, formatTime } from '../../components/Common';
import { player, usePlayer } from './engine';
import type { QueueEntry } from '../../domain/models';
import { useContextMenu } from '../../components/Interactions';
import { PlayPauseButton } from './PlayerUI';

export function QueuePanel({ compact = false }: { compact?: boolean }) {
  const menu = useContextMenu();
  const entries = usePlayer((s) => s.entries); const currentId = usePlayer((s) => s.currentId); const playing = usePlayer((s) => s.status === 'playing'); const undo = usePlayer((s) => s.undo);
  const index = entries.findIndex((entry) => entry.entryId === currentId); const current = entries[index]; const next = entries.slice(index + 1);
  const row = (entry: QueueEntry, actualIndex: number) => <div className={`integrated-queue-row ${entry.entryId === currentId ? 'current' : ''}`} key={entry.entryId} aria-current={entry.entryId === currentId}>
    <button className="integrated-queue-select" aria-label={`播放队列第 ${actualIndex + 1} 首：${entry.track.title}`} onClick={() => player.select(entry.entryId)}><Cover id={entry.track.coverArt} size={120} /><span><strong>{entry.track.title}</strong><span>{entry.track.artist}</span></span><span className="integrated-queue-time">{entry.entryId === currentId && playing ? <span className="playback-equalizer is-playing" aria-hidden="true"><i /><i /><i /><i /></span> : formatTime(entry.track.duration)}</span></button>
    <div className="integrated-queue-actions">{compact ? <>
      {entry.entryId === currentId && <PlayPauseButton />}
      <IconButton label={`队列歌曲选项 ${entry.track.title}`} aria-haspopup="menu" onClick={(event) => menu(event, [
        { label: '上移', icon: <ChevronUp size={15} />, disabled: actualIndex === 0, action: () => player.move(actualIndex, actualIndex - 1) },
        { label: '下移', icon: <ChevronDown size={15} />, disabled: actualIndex === entries.length - 1, action: () => player.move(actualIndex, actualIndex + 1) },
        { label: '移除', icon: <X size={15} />, action: () => player.remove(entry.entryId) },
      ])}><Ellipsis size={20} /></IconButton>
    </> : <><IconButton label={`上移 ${entry.track.title}`} disabled={actualIndex === 0} onClick={() => player.move(actualIndex, actualIndex - 1)}><ChevronUp size={15} /></IconButton><IconButton label={`下移 ${entry.track.title}`} disabled={actualIndex === entries.length - 1} onClick={() => player.move(actualIndex, actualIndex + 1)}><ChevronDown size={15} /></IconButton><IconButton label={`移除 ${entry.track.title}`} onClick={() => player.remove(entry.entryId)}><X size={15} /></IconButton></>}</div>
  </div>;
  return <div className="integrated-queue"><section><h3>当前播放</h3>{current ? row(current, index) : <p className="panel-muted">还没有正在播放的歌曲</p>}</section><section><div className="integrated-queue-section"><h3>接下来<span>{next.length} 首</span></h3>{undo && <button className="text-button" onClick={() => player.restoreQueue(undo)}>撤销替换</button>}</div>{next.map((entry, offset) => row(entry, index + 1 + offset))}{!next.length && <p className="panel-muted">已到队列末尾</p>}</section>{!entries.length && <Empty title="队列还是空的">从歌单、专辑或搜索结果开始播放。</Empty>}</div>;
}
