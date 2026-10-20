import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Music2, RotateCw } from 'lucide-react';
import { QueryState, useApi } from '../../components/Common';
import { usePreferences } from '../../state/preferences';
import { lyricIndex } from '../../domain/queue';
import type { Track } from '../../domain/models';
import { player, usePlayer } from './engine';
import { useReducedMotion } from './playback-hooks';

export const LYRIC_IDLE_MS = 5000;
export function centeredLyricTop(view: { top: number; height: number; scrollTop: number }, line: { top: number; height: number }) {
  return Math.max(0, view.scrollTop + line.top - view.top - (view.height - line.height) / 2);
}
export function Lyrics({ track }: { track?: Track }) {
  const api = useApi(); const preferences = usePreferences(); const reduced = useReducedMotion(); const position = usePlayer((s) => s.position);
  const ref = useRef<HTMLDivElement>(null); const [follow, setFollow] = useState(true); const following = useRef(true); const dragging = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const frame = useRef(0);
  const query = useQuery({ queryKey: [api.identity, 'lyrics', track?.id], enabled: Boolean(track), queryFn: ({ signal }) => api.lyrics(track!.id, track!.artist, track!.title, signal) });
  const lyrics = query.data; const delay = (lyrics?.offsetMs ?? 0) + preferences.lyricDelay;
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
    <QueryState pending={query.isPending && Boolean(track)} error={query.error} retry={() => query.refetch()} />
    <div ref={ref} className="room-lyrics-lines" data-synced={Boolean(lyrics?.synced && lyrics.lines.length)} style={{ '--lyric-size': `${preferences.lyricSize}px` } as CSSProperties} onWheel={pause} onTouchMove={pause} onPointerDown={() => { dragging.current = true; pause(); }} tabIndex={0} aria-label="歌词内容" onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pause(); }}>
      {lyrics?.lines.length ? lyrics.lines.map((line, i) => <button className={`room-lyric ${lyrics.synced && i !== active ? 'inactive' : ''} ${i === active ? 'current' : ''}`} key={`${track?.id}-${i}`} aria-current={i === active} disabled={line.startMs === undefined} onClick={() => { if (line.startMs !== undefined) player.seek((line.startMs + delay) / 1000); resume(); }}>{line.text || '♪'}</button>) : !query.isPending && !query.error && <div className="instrumental-state"><span className="instrumental-notes"><Music2 size={35} /></span><h3>暂无歌词</h3></div>}
    </div>{lyrics?.synced && !follow && <div className="room-lyrics-footer"><button className="follow-button subtle-button" aria-pressed={follow} onClick={resume}><RotateCw size={14} />同步</button></div>}
  </div>;
}
