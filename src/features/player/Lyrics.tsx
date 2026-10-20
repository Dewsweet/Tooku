import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Music2, RotateCw, Ellipsis } from 'lucide-react';
import { QueryState, useApi } from '../../components/Common';
import { usePreferences } from '../../state/preferences';
import { lyricIndex } from '../../domain/queue';
import type { Track } from '../../domain/models';
import { player, usePlayer } from './engine';
import { useReducedMotion } from './playback-hooks';
import { useLyrics } from '../lyrics/useLyrics';
import { Select } from '../../components/Select';
import { IconButton } from '../../components/Common';
import { useContextMenu } from '../../components/Interactions';
import { providerNames, type LyricEdit, type LyricMode } from '../../domain/lyrics/types';
import { updateLyricChoice } from '../../state/lyrics';
import { MatchLyrics, EditLyrics } from '../lyrics/LyricsDialogs';
import '../lyrics/lyrics.css';

export const LYRIC_IDLE_MS = 5000;
export function centeredLyricTop(view: { top: number; height: number; scrollTop: number }, line: { top: number; height: number }) {
  return Math.max(0, view.scrollTop + line.top - view.top - (view.height - line.height) / 2);
}
export function Lyrics({ track }: { track?: Track }) {
  const api = useApi();
  return <LyricsView key={`${api.identity}-${track?.id}`} track={track} />;
}
function LyricsView({ track }: { track?: Track }) {
  const api = useApi(); const preferences = usePreferences(); const reduced = useReducedMotion(); const position = usePlayer((s) => s.position);
  const data = useLyrics(track); const menu = useContextMenu(); const [dialog, setDialog] = useState<'match' | 'edit' | null>(null);
  const ref = useRef<HTMLDivElement>(null); const [follow, setFollow] = useState(true); const following = useRef(true); const dragging = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const frame = useRef(0);
  const lyrics = data.lyrics; const delay = (lyrics?.offsetMs ?? 0) + preferences.lyricDelay + (data.edit?.delayMs ?? 0);
  const saveEdit = (edit?: LyricEdit) => {
    if (!track || !data.document) return;
    const edits = { ...data.choice?.edits }; if (edit) edits[data.document.source] = edit; else delete edits[data.document.source];
    updateLyricChoice(api.identity, track.id, { edits }); setDialog(null);
  };
  const active = lyrics?.synced ? lyricIndex(lyrics.lines.map((l) => l.startMs), position * 1000 - delay) : -1;
  const center = useCallback((instant = false) => {
    const container = ref.current; const line = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!container || !line || !following.current) return;
    const box = container.getBoundingClientRect(); const lineBox = line.getBoundingClientRect();
    container.scrollTo({ top: centeredLyricTop({ top: box.top, height: container.clientHeight, scrollTop: container.scrollTop }, lineBox), behavior: reduced || instant ? 'instant' : 'smooth' });
  }, [reduced]);
  const resume = useCallback(() => { clearTimeout(idle.current); following.current = true; setFollow(true); center(); }, [center]);
  const pause = useCallback(() => {
    following.current = false; setFollow(false); clearTimeout(idle.current);
    if (!dragging.current) idle.current = setTimeout(resume, LYRIC_IDLE_MS);
  }, [resume]);
  useEffect(() => {
    const release = () => { if (dragging.current) { dragging.current = false; pause(); } };
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); clearTimeout(idle.current); cancelAnimationFrame(frame.current); };
  }, [pause]);
  useLayoutEffect(() => {
    const container = ref.current; if (!container) return;
    const update = () => {
      const edge = lyrics?.synced && lyrics.lines.length ? `${container.clientHeight / 2}px` : '0px';
      container.style.setProperty('--lyric-edge', edge); container.style.paddingTop = '0px'; container.style.paddingBottom = '0px';
      cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => center(true));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(container); container.querySelectorAll('.room-lyric').forEach((line) => observer?.observe(line));
    return () => { observer?.disconnect(); cancelAnimationFrame(frame.current); };
  }, [lyrics, preferences.lyricSize, center]);
  useEffect(() => { if (follow) center(); }, [active, follow, center, lyrics]);
  return <div className="room-lyrics-panel">
    <div className="lyric-toolbar"><Select aria-label="歌词来源" value={data.mode} disabled={!track} onChange={(mode) => track && updateLyricChoice(api.identity, track.id, { mode: mode as LyricMode })}><option value="auto">自动 · {providerNames[data.source]}</option><option value="local">本地</option><option value="network" disabled={!data.settings.enabled}>网络 · 自动</option><option value="netease" disabled={!data.settings.enabled || !data.settings.order.includes('netease')}>网易云</option><option value="qq" disabled={!data.settings.enabled || !data.settings.order.includes('qq')}>QQ 音乐</option></Select>
      <IconButton label="歌词选项" disabled={!track} aria-haspopup="menu" onClick={(event) => menu(event, [
        { label: '更换网络匹配', disabled: !data.settings.enabled, action: () => setDialog('match') },
        { label: '歌词排版与延迟', disabled: !data.document, action: () => setDialog('edit') },
        { label: '重新读取歌词', action: async () => { await data.retry(); } },
        { label: '解除当前网络匹配', disabled: data.source === 'local' || !data.choice?.bindings?.[data.source], action: () => { if (!track || data.source === 'local') return; const bindings = { ...data.choice?.bindings }; delete bindings[data.source]; updateLyricChoice(api.identity, track.id, { mode: 'network', bindings }); } },
      ])}><Ellipsis size={19} /></IconButton></div>
    <QueryState pending={data.loading && Boolean(track)} error={data.error} retry={() => data.retry()} pendingText="正在读取歌词…" />
    <div ref={ref} className="room-lyrics-lines" data-synced={Boolean(lyrics?.synced && lyrics.lines.length)} style={{ '--lyric-size': `${preferences.lyricSize}px` } as CSSProperties} onWheel={pause} onTouchMove={pause} onPointerDown={() => { dragging.current = true; pause(); }} tabIndex={0} aria-label="歌词内容" onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pause(); }}>
      {lyrics?.lines.length ? lyrics.lines.map((line, i) => <button className={`room-lyric ${lyrics.synced && i !== active ? 'inactive' : ''} ${i === active ? 'current' : ''}`} key={`${track?.id}-${i}`} aria-current={i === active} disabled={line.startMs === undefined} onClick={() => { if (line.startMs !== undefined) player.seek((line.startMs + delay) / 1000); resume(); }}><span className="lyric-original">{line.text || '♪'}</span>{data.edit?.showTranslation !== false && line.translation?.map((text, j) => <span className="lyric-translation" key={j}>{text}</span>)}{data.edit?.showRomanization && line.romanization?.map((text, j) => <span className="lyric-romanization" key={j}>{text}</span>)}</button>) : !data.loading && !data.error && <div className="instrumental-state"><span className="instrumental-notes"><Music2 size={35} /></span><h3>{lyrics?.instrumental ? '纯音乐' : data.candidates.length ? '请选择歌词版本' : '暂无歌词'}</h3>{data.candidates.length > 0 && <button className="text-button" onClick={() => setDialog('match')}>选择版本</button>}</div>}
    </div>{lyrics?.synced && !follow && <div className="room-lyrics-footer"><button className="follow-button subtle-button" aria-pressed={follow} onClick={resume}><RotateCw size={14} />同步</button></div>}
    {track && dialog === 'match' && <MatchLyrics track={track} providers={data.settings.order} onClose={() => setDialog(null)} onSelect={(candidate) => { updateLyricChoice(api.identity, track.id, { mode: candidate.provider, bindings: { ...data.choice?.bindings, [candidate.provider]: candidate.id } }); setDialog(null); }} />}
    {dialog === 'edit' && data.document && <EditLyrics document={data.document} hash={data.hash} current={data.edit} onSave={saveEdit} onReset={() => saveEdit()} onClose={() => setDialog(null)} />}
  </div>;
}
