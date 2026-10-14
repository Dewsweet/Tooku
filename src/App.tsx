import { useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { Music2, Search as SearchIcon, Disc3, Mic2, Heart, Clock3, ChevronLeft, ChevronRight, Menu, X, PanelRight, Settings as SettingsIcon } from 'lucide-react';
import { queryClient, useSession } from './state/session';
import { usePreferences } from './state/preferences';
import { player, usePlayer } from './features/player/engine';
import { Login } from './pages/Login';
import { AlbumDetail, Albums, ArtistDetail, Artists, Home, Songs } from './pages/Library';
import { Search } from './pages/Search';
import { Favorites, History } from './pages/Collection';
import { AddToPlaylist, PlaylistDetail, Playlists } from './pages/Playlists';
import { Settings } from './pages/Settings';
import { PlayerBar, Queue, LyricsPlayer } from './features/player/PlayerUI';
import { IconButton } from './components/Common';
import type { Track } from './domain/models';
import { clearProfile } from './storage/local';
import { useLibrary, useMusicLibrary } from './state/library';
import { PlaylistTree } from './features/library/Organization';
import { NowPlayingPanel } from './features/player/NowPlayingPanel';
import { Cover } from './components/Common';
import { ApiError } from './api/client';

const navigation = [
  { to: '/', name: '音乐库', icon: Music2 }, { to: '/songs', name: '歌曲', icon: Music2 },
  { to: '/albums', name: '专辑', icon: Disc3 }, { to: '/artists', name: '歌手', icon: Mic2 },
  { to: '/favorites', name: '收藏', icon: Heart }, { to: '/history', name: '最近听过', icon: Clock3 },
];
export default function App() {
  const api = useSession((s) => s.api); const notice = useSession((s) => s.notice); const prefs = usePreferences(); const navigate = useNavigate();
  const [queue, setQueue] = useState(false); const [lyrics, setLyrics] = useState(false); const [adding, setAdding] = useState<Track | null>(null); const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width: 767px)'); const change = () => setMobile(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { if (!menu || !mobile) return; const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); document.getElementById('tooku-menu-toggle')?.focus(); } }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [menu, mobile]);
  const currentId = usePlayer((s) => s.currentId); const current = usePlayer((s) => s.entries.find((e) => e.entryId === s.currentId)); const library = useMusicLibrary();
  const location = useLocation(); const contentRef = useRef<HTMLElement>(null);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [location.pathname, location.search, library.libraryId]);
  useEffect(() => { if (api && !player.connectedTo(api)) void player.attach(api); }, [api]);
  useEffect(() => { document.documentElement.dataset.theme = prefs.theme; document.documentElement.style.setProperty('--accent-base', /^#[0-9a-f]{6}$/i.test(prefs.accent ?? '') ? prefs.accent : '#c83e55'); document.documentElement.dataset.motion = prefs.reducedMotion ? 'reduced' : 'full'; }, [prefs.theme, prefs.accent, prefs.reducedMotion]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => useSession.getState().notify(''), 9000); return () => clearTimeout(timer); }, [notice]);
  const logout = (clear = true) => {
    if (!api) return;
    player.persist(); player.logout(); queryClient.cancelQueries(); api.dispose(); queryClient.clear(); useSession.getState().setSession(null);
    if (clear) clearProfile(api.identity).catch(() => useSession.getState().notify('本机快照未能清除，请检查浏览器存储。'));
    setQueue(false); setLyrics(false); setAdding(null); setMenu(false); navigate('/');
  };
  useEffect(() => {
    if (!api) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.state.error instanceof ApiError && event.query.state.error.code === 40) {
        player.persist(); player.logout(); api.dispose(); queryClient.cancelQueries(); queryClient.clear();
        useSession.getState().setSession(null); useSession.getState().notify('认证已失效，请重新连接。');
      }
    });
  }, [api]);
  useEffect(() => {
    if (!api || !prefs.shortcuts) return;
    const handle = (e: KeyboardEvent) => {
      if (e.isComposing || e.target instanceof HTMLElement && (e.target.matches('input, textarea, select, [contenteditable="true"]') || e.target.closest('[contenteditable="true"]'))) return;
      if (document.querySelector('dialog[open]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); navigate('/search'); }
      if (e.target instanceof HTMLElement && e.target.closest('button, a')) return;
      if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); player.seek(usePlayer.getState().position + (e.key === 'ArrowRight' ? 10 : -10)); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [api, prefs.shortcuts, navigate]);
  if (!api) return <Login />;
  return <div className={`app-shell workspace-shell ${prefs.sidePanel ? 'with-now-panel' : ''}`}><aside inert={mobile && !menu} className={`sidebar ${menu ? 'open' : ''}`}>
    <NavLink to="/settings" className="workspace-account" aria-label="账户与设置" onClick={() => setMenu(false)}><span className="brand-icon"><Music2 size={21} /></span><span><strong>Tooku</strong><span>{api.username}</span></span><SettingsIcon size={18} /></NavLink>
    <div className="library-select"><select aria-label="当前音乐库" disabled={library.isPending || !library.libraries.length} value={library.libraryId ?? ''} onChange={(e) => { useLibrary.getState().change(api.identity, (p) => ({...p, activeId:e.target.value})); setAdding(null); setMenu(false); navigate('/'); }}>{library.libraries.length ? library.libraries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>) : <option value="">{library.isPending ? '加载音乐库…' : '没有可用音乐库'}</option>}</select>{library.error && <button className="text-button" onClick={() => library.refetch()}>重新加载音乐库</button>}</div>
    <nav className="sidebar-primary" aria-label="主导航">{navigation.map(({ to, name, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenu(false)}><Icon size={19} /><span>{name}</span></NavLink>)}</nav><div className="sidebar-scroll"><PlaylistTree key={library.libraryId} closeNavigation={() => setMenu(false)} /></div>
    {current && <button className="sidebar-art" aria-label="展开当前播放封面" onClick={() => { setLyrics(true); setMenu(false); }}><Cover id={current.track.coverArt} size={400} /></button>}
  </aside>{menu && <button className="menu-scrim" aria-label="关闭导航" onClick={() => setMenu(false)} />}
    <div className="app-main" inert={mobile && menu}><header className="topbar"><div className="button-row"><IconButton id="tooku-menu-toggle" label="打开导航" className="icon-button menu-toggle" aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu size={21} /></IconButton><IconButton label="返回" onClick={() => navigate(-1)}><ChevronLeft size={22} /></IconButton><IconButton label="前进" onClick={() => navigate(1)}><ChevronRight size={22} /></IconButton></div><button className="top-search" onClick={() => navigate('/search')}><SearchIcon size={18} /><span>搜索</span></button><IconButton className="icon-button panel-toggle" label={prefs.sidePanel ? '隐藏播放侧栏' : '显示播放侧栏'} aria-pressed={prefs.sidePanel} onClick={() => prefs.update({sidePanel:!prefs.sidePanel})}><PanelRight size={19} /></IconButton></header>
      <main ref={contentRef} className="content" key={library.libraryId}><Routes><Route path="/" element={<Home addToPlaylist={setAdding} />} /><Route path="/songs" element={<Songs addToPlaylist={setAdding} />} /><Route path="/albums" element={<Albums />} /><Route path="/albums/:id" element={<AlbumDetail addToPlaylist={setAdding} />} /><Route path="/artists" element={<Artists />} /><Route path="/artists/:id" element={<ArtistDetail />} /><Route path="/search" element={<Search addToPlaylist={setAdding} />} /><Route path="/favorites" element={<Favorites addToPlaylist={setAdding} />} /><Route path="/playlists" element={<Playlists />} /><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={setAdding} />} /><Route path="/history" element={<History addToPlaylist={setAdding} />} /><Route path="/settings" element={<Settings logout={() => logout(false)} />} /><Route path="*" element={<div className="empty"><h1>页面不存在</h1><NavLink to="/">回到音乐库</NavLink></div>} /></Routes></main>
    </div>{prefs.sidePanel && <NowPlayingPanel openQueue={() => setQueue(true)} openPlayer={() => currentId && setLyrics(true)} />}<div inert={mobile && menu}><PlayerBar queueOpen={queue} openQueue={() => setQueue(true)} openLyrics={() => currentId && setLyrics(true)} /></div>
    {queue && <Queue onClose={() => setQueue(false)} />}{lyrics && <LyricsPlayer onClose={() => setLyrics(false)} />}{adding && <AddToPlaylist track={adding} onClose={() => setAdding(null)} />}
    {notice && <div className="toast" role="status">{notice}<IconButton label="关闭提示" onClick={() => useSession.getState().notify('')}><X size={17} /></IconButton></div>}
  </div>;
}
