import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink, Route, Routes, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Disc3, Mic2, Heart, Clock3, X, Sparkles } from 'lucide-react';
import { Recommendations } from './features/recommendations/Recommendations';
import { queryClient, useSession } from './state/session';
import { panelWidthCss, usePreferences } from './state/preferences';
import { fontFamilyCss, normalizeBaseFontSize, useDisplayPreferences } from './state/display';
import { player, usePlayer } from './features/player/engine';
import { Login } from './pages/Login';
import { AlbumDetail, Albums, ArtistDetail, Artists } from './pages/Library';
import { Search } from './pages/Search';
import { Favorites, History } from './pages/Collection';
import { AddToPlaylist, PlaylistDetail, Playlists } from './pages/Playlists';
import { Settings } from './pages/Settings';
import { PlayerBar, LyricsPlayer } from './features/player/PlayerUI';
import { IconButton } from './components/Common';
import type { Track } from './domain/models';
import { clearProfile } from './storage/local';
import { disconnectUserSync } from './storage/userSync';
import { useMusicLibrary } from './state/library';
import { PlaylistTree } from './features/library/Organization';
import { NowPlayingPanel } from './features/player/NowPlayingPanel';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { Home } from './pages/Home';
import { ApiError } from './api/client';
import { PanelResizeHandle } from './features/player/PanelResizeHandle';
import { ContentScrollbar } from './components/ContentScrollbar';
import { ScrollArea } from './components/ScrollArea';

const navigation = [
  { to: '/albums', name: '专辑', icon: Disc3 }, { to: '/artists', name: '歌手', icon: Mic2 },
  { to: '/favorites', name: '收藏', icon: Heart }, { to: '/history', name: '最近在听', icon: Clock3 },
  { to: '/recommendations', name: '为你推荐', icon: Sparkles },
];
export default function App() {
  const baseFontSize = useDisplayPreferences((s) => s.baseFontSize);
  const fontFamily = useDisplayPreferences((s) => s.fontFamily);
  useEffect(() => { document.documentElement.style.setProperty('--ui-font-scale', String(normalizeBaseFontSize(baseFontSize) / 14)); }, [baseFontSize]);
  useEffect(() => { document.documentElement.style.setProperty('--ui-font-family', fontFamilyCss(fontFamily)); }, [fontFamily]);
  const api = useSession((s) => s.api); const notice = useSession((s) => s.notice); const prefs = usePreferences(); const navigate = useNavigate();
  const [queue, setQueue] = useState(false); const [lyrics, setLyrics] = useState(false); const [adding, setAdding] = useState<Track | null>(null); const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width: 767px)'); const change = () => setMobile(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { if (!menu || !mobile) return; const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); document.getElementById('tooku-menu-toggle')?.focus(); } }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [menu, mobile]);
  const currentId = usePlayer((s) => s.currentId); const library = useMusicLibrary();
  const [compactPanel, setCompactPanel] = useState(() => window.matchMedia('(max-width: 1199px)').matches); const [panelOverlay, setPanelOverlay] = useState(false);
  useEffect(() => { const media = window.matchMedia('(max-width: 1199px)'); const change = () => { setCompactPanel(media.matches); setPanelOverlay(false); }; media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  const panelVisible = compactPanel ? panelOverlay : prefs.sidePanel;
  useEffect(() => { if (!panelOverlay) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { setPanelOverlay(false); document.getElementById('tooku-panel-toggle')?.focus(); } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [panelOverlay]);
  const location = useLocation(); const contentRef = useRef<HTMLElement>(null);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; setPanelOverlay(false); setMenu(false); }, [location.pathname, location.search, library.libraryId]);
  useEffect(() => { if (api && !player.connectedTo(api)) void player.attach(api); }, [api]);
  useEffect(() => { document.documentElement.dataset.theme = prefs.theme; document.documentElement.style.setProperty('--accent-base', /^#[0-9a-f]{6}$/i.test(prefs.accent ?? '') ? prefs.accent : '#c83e55'); document.documentElement.dataset.motion = prefs.reducedMotion ? 'reduced' : 'full'; }, [prefs.theme, prefs.accent, prefs.reducedMotion]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => useSession.getState().notify(''), 9000); return () => clearTimeout(timer); }, [notice]);
  const logout = (clear = true) => {
    if (!api) return;
    player.persist(); player.logout(); disconnectUserSync(); queryClient.cancelQueries(); api.dispose(); queryClient.clear(); useSession.getState().setSession(null);
    if (clear) clearProfile(api.identity).catch(() => useSession.getState().notify('本机快照未能清除，请检查浏览器存储。'));
    setQueue(false); setLyrics(false); setAdding(null); setMenu(false); setPanelOverlay(false); navigate('/');
  };
  useEffect(() => {
    if (!api) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.state.error instanceof ApiError && event.query.state.error.code === 40) {
        player.persist(); player.logout(); disconnectUserSync(); api.dispose(); queryClient.cancelQueries(); queryClient.clear();
        useSession.getState().setSession(null); useSession.getState().notify('认证已失效，请重新连接。');
      }
    });
  }, [api]);
  useEffect(() => {
    if (!api || !prefs.shortcuts) return;
    const handle = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.target instanceof HTMLElement && (e.target.matches('input, textarea, select, [contenteditable="true"]') || e.target.closest('[contenteditable="true"]'))) return;
      if (document.querySelector('dialog[open]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); navigate('/search'); }
      if (e.target instanceof HTMLElement && e.target.closest('button, a, [role="separator"], [role="scrollbar"], .room-lyrics-lines')) return;
      if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); player.seek(usePlayer.getState().position + (e.key === 'ArrowRight' ? 10 : -10)); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [api, prefs.shortcuts, navigate]);
  function openQueue() { setQueue(true); setMenu(false); if (compactPanel) setPanelOverlay(true); else prefs.update({ sidePanel: true }); }
  function toggleQueue() { if (queue && panelVisible) { setQueue(false); if (compactPanel) setPanelOverlay(false); else prefs.update({ sidePanel: false }); } else openQueue(); }
  if (!api) return <Login />;
  return <div style={{ '--panel-width': panelWidthCss(prefs.panelWidth) } as CSSProperties} className={`app-shell workspace-shell ${!compactPanel && prefs.sidePanel ? 'with-now-panel' : ''} ${panelOverlay ? 'panel-overlay-open' : ''}`}>
    <WorkspaceHeader identity={api.identity} username={api.username} menuOpen={menu} panelOpen={panelVisible} toggleMenu={() => { setPanelOverlay(false); setMenu(!menu); }} togglePanel={() => { setMenu(false); if (compactPanel) setPanelOverlay(!panelOverlay); else prefs.update({sidePanel:!prefs.sidePanel}); }} logout={() => logout(false)} />
    <aside id="workspace-sidebar" inert={mobile && !menu || panelOverlay} className={`sidebar ${menu ? 'open' : ''}`}>
      <nav className="sidebar-primary" aria-label="主导航">{navigation.map(({ to, name, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMenu(false)}><Icon size={20} /><span>{name}</span></NavLink>)}</nav>
      <ScrollArea className="sidebar-scroll" scope={library.libraryId} label="歌单导航滚动条"><PlaylistTree key={library.libraryId} closeNavigation={() => setMenu(false)} /></ScrollArea>
    </aside>{menu && <button className="menu-scrim" aria-label="关闭导航遮罩" onClick={() => setMenu(false)} />}
    <div className="app-main" inert={mobile && menu || panelOverlay}><main id="workspace-content" ref={contentRef} className="content with-overlay-scrollbar" key={library.libraryId}><Routes>
      <Route path="/" element={<Home />} /><Route path="/songs" element={<Navigate to="/search?type=songs" replace />} /><Route path="/albums" element={<Albums />} /><Route path="/albums/:id" element={<AlbumDetail addToPlaylist={setAdding} />} /><Route path="/artists" element={<Artists />} /><Route path="/artists/:id" element={<ArtistDetail />} /><Route path="/search" element={<Search addToPlaylist={setAdding} />} /><Route path="/favorites" element={<Favorites addToPlaylist={setAdding} />} /><Route path="/playlists" element={<Playlists />} /><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={setAdding} />} /><Route path="/history" element={<History addToPlaylist={setAdding} />} /><Route path="/settings" element={<Settings logout={() => logout(false)} />} /><Route path="*" element={<div className="empty"><h1>页面不存在</h1><NavLink to="/">回到主页</NavLink></div>} />
      <Route path="/recommendations" element={<Recommendations />} />
    </Routes></main><ContentScrollbar viewport={contentRef} scope={JSON.stringify([location.key, library.libraryId])} /></div>
    {!compactPanel && prefs.sidePanel && <PanelResizeHandle />}{panelOverlay && <button className="panel-scrim" aria-label="关闭播放侧栏遮罩" onClick={() => setPanelOverlay(false)} />}
    {(prefs.sidePanel || panelOverlay) && <NowPlayingPanel view={queue ? 'queue' : 'now'} onViewChange={(view) => setQueue(view === 'queue')} openQueue={openQueue} openPlayer={() => currentId && setLyrics(true)} onClose={() => { if (compactPanel) setPanelOverlay(false); else prefs.update({sidePanel:false}); }} />}
    <div inert={mobile && menu || panelOverlay}><PlayerBar queueOpen={queue && panelVisible} openQueue={toggleQueue} openLyrics={() => currentId && setLyrics(true)} /></div>
    {lyrics && <LyricsPlayer onClose={() => setLyrics(false)} addToPlaylist={setAdding} />}{adding && <AddToPlaylist track={adding} onClose={() => setAdding(null)} />}
    {notice && <div className="toast" role="status">{notice}<IconButton label="关闭提示" onClick={() => useSession.getState().notify('')}><X size={17} /></IconButton></div>}
  </div>;
}
