import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, Cloud, FileMusic, RotateCw, SlidersHorizontal } from 'lucide-react';
import { QueryState, useApi } from '../../components/Common';
import { usePreferences } from '../../state/preferences';
import { lyricTiming } from '../../domain/lyrics/timing';
import type { Track } from '../../domain/models';
import { player, usePlayer } from './engine';
import { useReducedMotion } from './playback-hooks';
import { useLyrics } from '../lyrics/useLyrics';
import { IconButton } from '../../components/Common';
import { useContextMenu } from '../../components/Interactions';
import { providerNames, type LyricEdit, type LyricSource } from '../../domain/lyrics/types';
import { updateLyricChoice } from '../../state/lyrics';
import { LyricsSettingsDialog } from '../lyrics/LyricsDialogs';
import { QqIcon } from '../lyrics/QqIcon';
import '../lyrics/lyrics.css';

export const LYRIC_IDLE_MS = 5000;
export function centeredLyricTop(view: { top: number; height: number; scrollTop: number }, line: { top: number; height: number }, anchor = .5) {
  return Math.max(0, view.scrollTop + line.top - view.top + line.height / 2 - view.height * anchor);
}
export function Lyrics({ track, toolbarHost }: { track?: Track; toolbarHost?: HTMLElement | null }) {
  const api = useApi();
  return <LyricsView key={`${api.identity}-${track?.id}`} track={track} toolbarHost={toolbarHost} />;
}
function LyricsView({ track, toolbarHost }: { track?: Track; toolbarHost?: HTMLElement | null }) {
  const api = useApi(); const preferences = usePreferences(); const reduced = useReducedMotion(); const position = usePlayer((s) => s.position);
  const data = useLyrics(track); const menu = useContextMenu(); const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null); const [follow, setFollow] = useState(true); const following = useRef(true); const dragging = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const frame = useRef(0);
  const anchor = useRef(.5);
  const lyrics = data.lyrics; const { delayMs: delay, index: active } = lyricTiming(lyrics, position, preferences.lyricDelay, data.edit);
  const saveEdit = (edit?: LyricEdit) => {
    if (!track || !data.document) return;
    const edits = { ...data.choice?.edits }; if (edit) edits[data.document.source] = edit; else delete edits[data.document.source];
    updateLyricChoice(api.identity, track.id, { edits }); setSettingsOpen(false);
  };
  const center = useCallback((instant = false) => {
    const container = ref.current; const line = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!container || !line || !following.current) return;
    const box = container.getBoundingClientRect(); const lineBox = line.getBoundingClientRect();
    container.scrollTo({ top: centeredLyricTop({ top: box.top, height: container.clientHeight, scrollTop: container.scrollTop }, lineBox, anchor.current), behavior: reduced || instant ? 'instant' : 'smooth' });
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
      const configured = Number.parseFloat(getComputedStyle(container).getPropertyValue('--lyric-anchor'));
      anchor.current = Number.isFinite(configured) ? Math.max(.3, Math.min(.7, configured)) : .5;
      const height = lyrics?.synced && lyrics.lines.length ? container.clientHeight : 0;
      container.style.setProperty('--lyric-before', `${height * anchor.current}px`);
      container.style.setProperty('--lyric-after', `${height * (1 - anchor.current)}px`);
      container.style.paddingTop = '0px'; container.style.paddingBottom = '0px';
      cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => center(true));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(container); container.querySelectorAll('.room-lyric').forEach((line) => observer?.observe(line));
    return () => { observer?.disconnect(); cancelAnimationFrame(frame.current); };
  }, [lyrics, preferences.lyricSize, center]);
  useEffect(() => { if (follow) center(); }, [active, follow, center, lyrics]);
  const sourceIcons = { local: <FileMusic size={20} />, netease: <Cloud size={20} />, qq: <QqIcon /> };
  const toolbar = <div className="lyric-toolbar" role="group" aria-label="歌词工具">
    <IconButton label={`歌词来源：${providerNames[data.source]}`} disabled={!track} aria-haspopup="menu" onClick={(event) => menu(event, (['local', 'netease', 'qq'] as LyricSource[]).map((source) => ({
      label: providerNames[source], icon: data.source === source ? <Check size={18} /> : sourceIcons[source],
      disabled: source !== 'local' && (!data.settings.enabled || !data.settings.order.includes(source)),
      action: () => { if (track) updateLyricChoice(api.identity, track.id, { mode: source }); },
    })))}>{sourceIcons[data.source]}</IconButton>
    <IconButton label="歌词设置" disabled={!track || !data.lyrics?.lines.length && !data.settings.enabled} aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus(); setSettingsOpen(true); }}><SlidersHorizontal size={20} /></IconButton>
  </div>;
  return <div className="room-lyrics-panel">
    {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
    <QueryState pending={data.loading && Boolean(track)} error={data.error} retry={() => data.retry()} pendingText="正在读取歌词…" />
    <div ref={ref} className="room-lyrics-lines" data-synced={Boolean(lyrics?.synced && lyrics.lines.length)} style={{ '--lyric-size': `${preferences.lyricSize}px` } as CSSProperties} onWheel={pause} onTouchMove={pause} onPointerDown={() => { dragging.current = true; pause(); }} tabIndex={0} aria-label="歌词内容" onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pause(); }}>
      {lyrics?.lines.length ? lyrics.lines.map((line, i) => <button className={`room-lyric ${lyrics.synced && i !== active ? 'inactive' : ''} ${i === active ? 'current' : ''}`} key={`${track?.id}-${i}`} aria-current={i === active} disabled={line.startMs === undefined} onClick={() => { if (line.startMs !== undefined) player.seek((line.startMs + delay) / 1000); resume(); }}><span className="lyric-original">{line.text || '♪'}</span>{data.edit?.showRomanization && line.romanization?.map((text, j) => <span className="lyric-romanization" key={`r-${j}`}>{text}</span>)}{data.edit?.showTranslation !== false && line.translation?.map((text, j) => <span className="lyric-translation" key={j}>{text}</span>)}</button>) : !data.loading && !data.error && <div className="instrumental-state"><h3>该音乐没有歌词，请欣赏</h3></div>}
    </div>{lyrics?.synced && !follow && <div className="room-lyrics-footer"><button className="follow-button subtle-button" aria-pressed={follow} onClick={resume}><RotateCw size={14} />同步</button></div>}
    {track && settingsOpen && <LyricsSettingsDialog track={track} data={data} onSave={saveEdit} onClose={() => setSettingsOpen(false)} onReload={() => { void data.retry(); setSettingsOpen(false); }} onSelect={(candidate) => {
      updateLyricChoice(api.identity, track.id, { mode: candidate.provider, bindings: { ...data.choice?.bindings, [candidate.provider]: candidate.id } }); setSettingsOpen(false);
    }} onRecommend={(provider) => { const bindings = { ...data.choice?.bindings }; delete bindings[provider]; updateLyricChoice(api.identity, track.id, { mode: provider, bindings }); setSettingsOpen(false); }} />}
  </div>;
}
