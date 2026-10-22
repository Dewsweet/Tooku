import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PictureInPicture2 } from 'lucide-react';
import { IconButton, useApi } from '../../components/Common';
import type { Track } from '../../domain/models';
import { currentLyricLines, lyricTiming } from '../../domain/lyrics/timing';
import { usePreferences } from '../../state/preferences';
import { useSession } from '../../state/session';
import { useLyrics } from '../lyrics/useLyrics';
import { usePlayer } from './engine';
import desktopLyricsCss from './desktop-lyrics.css?raw';
import fontCss from '../../fonts.css?inline';

interface DocumentPictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}
const themeTokens = ['--bg', '--surface', '--shell', '--text', '--muted', '--line', '--accent', '--soft', '--ui-font-scale'];

// Keep this view in the same React tree so lyrics, preferences and queries are shared.
function DesktopLyricsContent({ track, target }: { track?: Track; target: Window }) {
  const data = useLyrics(track);
  const position = usePlayer((state) => state.position);
  const globalDelay = usePreferences((state) => state.lyricDelay);
  const { index } = lyricTiming(data.lyrics, position, globalDelay, data.edit);
  const lines = currentLyricLines(data.lyrics, index);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [index, data.lyrics]);
  useEffect(() => { target.document.title = track ? `${track.title} · Tooku 桌面歌词` : 'Tooku 桌面歌词'; }, [target, track]);
  const message = !track ? '选择歌曲开始播放' : data.loading ? '正在读取歌词…' : data.error ? '歌词读取失败' : !data.lyrics?.lines.length ? '该音乐没有歌词，请欣赏' : '♪';
  return <main className="desktop-lyrics" aria-label="桌面歌词" onContextMenu={(event) => event.stopPropagation()}>
    <div key={track?.id} ref={scroll} className="desktop-lyrics-scroll" tabIndex={0} aria-label={data.lyrics?.synced === false ? '歌词内容，可滚动查看' : '当前歌词'}>
      {lines.length ? lines.map((line, i) => <div className="desktop-lyric" key={i}>
        <p className="desktop-original">{line.text || '♪'}</p>
        {data.edit?.showRomanization && line.romanization?.map((text, j) => <p className="desktop-romanization" key={j}>{text}</p>)}
        {data.edit?.showTranslation !== false && line.translation?.map((text, j) => <p className="desktop-translation" key={j}>{text}</p>)}
      </div>) : <p className="desktop-message" role="status">{message}</p>}
      {data.error && <button className="desktop-retry" onClick={() => { void data.retry(); }}>重试</button>}
    </div>
  </main>;
}

export function DesktopLyricsButton({ track }: { track?: Track }) {
  const api = useApi();
  return <DesktopLyricsControl key={api.identity} track={track} />;
}

function DesktopLyricsControl({ track }: { track?: Track }) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const active = useRef<{ window: Window; dispose: () => void } | null>(null);
  useEffect(() => () => {
    generation.current++;
    const current = active.current;
    active.current = null;
    current?.dispose();
    current?.window.close();
  }, []);

  async function toggle(trigger: HTMLButtonElement) {
    if (pending.current) return;
    if (active.current) {
      const current = active.current;
      active.current = null;
      current.dispose();
      setPipWindow(null);
      current.window.close();
      return;
    }
    const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;
    if (typeof api?.requestWindow !== 'function') {
      useSession.getState().notify('当前浏览器不支持桌面歌词，请使用新版桌面 Chrome 或 Edge；远程访问需使用 HTTPS');
      return;
    }
    const openedAt = generation.current;
    pending.current = true;
    setBusy(true);
    let target: Window | undefined;
    try {
      // The browser owns placement and remembers the user's last size/position.
      target = await api.requestWindow({ width: 480, height: 180 });
      if (openedAt !== generation.current) { target.close(); return; }
      if (target.closed) return;
      const pip = target;
      const base = pip.document.createElement('base');
      base.href = `${window.location.origin}/`;
      const style = pip.document.createElement('style');
      style.textContent = `${fontCss}\n${desktopLyricsCss}`;
      pip.document.head.append(base, style);
      const syncTheme = () => {
        const theme = getComputedStyle(document.documentElement);
        for (const token of themeTokens) pip.document.documentElement.style.setProperty(token, theme.getPropertyValue(token));
        pip.document.documentElement.style.fontFamily = theme.fontFamily;
        pip.document.documentElement.style.colorScheme = usePreferences.getState().theme;
      };
      syncTheme();
      const observer = new MutationObserver(syncTheme);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });
      const dispose = () => { observer.disconnect(); pip.removeEventListener('pagehide', closed); };
      const closed = () => {
        dispose();
        active.current = null;
        setPipWindow(null);
        // Do not pull focus away from another desktop application.
        if (document.hasFocus() && trigger.isConnected) trigger.focus({ preventScroll: true });
      };
      pip.addEventListener('pagehide', closed, { once: true });
      active.current = { window: pip, dispose };
      setPipWindow(pip);
    } catch {
      target?.close();
      if (openedAt === generation.current) useSession.getState().notify('无法打开桌面歌词，请检查浏览器画中画权限后重试');
    } finally {
      pending.current = false;
      if (openedAt === generation.current) setBusy(false);
    }
  }

  return <>
    <IconButton label={pipWindow ? '关闭桌面歌词' : '桌面歌词'} className={`icon-button desktop-lyrics-button ${pipWindow ? 'selected' : ''}`} aria-pressed={Boolean(pipWindow)} aria-busy={busy} disabled={busy || !track && !pipWindow} onClick={(event) => { void toggle(event.currentTarget); }}><PictureInPicture2 size={20} /></IconButton>
    {pipWindow && createPortal(<DesktopLyricsContent track={track} target={pipWindow} />, pipWindow.document.body)}
  </>;
}
