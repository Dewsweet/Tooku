import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { Music2, Search as SearchIcon, Disc3, Mic2, Heart, ListMusic, Clock3, Settings as SettingsIcon, Headphones, ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { queryClient, useSession } from './state/session';
import { usePreferences } from './state/preferences';
import { player, usePlayer } from './features/player/engine';
import { Login } from './pages/Login';
import { AlbumDetail, Albums, ArtistDetail, Artists, Home } from './pages/Library';
import { Search } from './pages/Search';
import { Favorites, History } from './pages/Collection';
import { AddToPlaylist, PlaylistDetail, Playlists } from './pages/Playlists';
import { Settings } from './pages/Settings';
import { PlayerBar, Queue, LyricsPlayer } from './features/player/PlayerUI';
import { IconButton } from './components/Common';
import type { Track } from './domain/models';
import { clearProfile } from './storage/local';
import { ApiError } from './api/client';

const navigation = [
  { to: '/', name: '现在就听', icon: Headphones }, { to: '/search', name: '搜索', icon: SearchIcon },
  { to: '/albums', name: '专辑', icon: Disc3 }, { to: '/artists', name: '歌手', icon: Mic2 },
  { to: '/favorites', name: '收藏', icon: Heart }, { to: '/playlists', name: '歌单', icon: ListMusic }, { to: '/history', name: '最近听过', icon: Clock3 },
];
export default function App() {
  const api = useSession((s) => s.api); const notice = useSession((s) => s.notice); const prefs = usePreferences(); const navigate = useNavigate();
  const [queue, setQueue] = useState(false); const [lyrics, setLyrics] = useState(false); const [adding, setAdding] = useState<Track | null>(null); const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width: 767px)'); const change = () => setMobile(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { if (!menu || !mobile) return; const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); document.getElementById('tooku-menu-toggle')?.focus(); } }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [menu, mobile]);
  const currentId = usePlayer((s) => s.currentId);
  useEffect(() => { if (api && !player.connectedTo(api)) void player.attach(api); }, [api]);
  useEffect(() => { document.documentElement.dataset.theme = prefs.theme; document.documentElement.dataset.motion = prefs.reducedMotion ? 'reduced' : 'full'; }, [prefs.theme, prefs.reducedMotion]);
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
  return <div className="app-shell"><aside inert={mobile && !menu} className={`sidebar ${menu ? 'open' : ''}`}><NavLink to="/" className="brand" onClick={() => setMenu(false)}><span className="brand-icon"><Music2 size={22} /></span>Tooku<span className="brand-caption">音乐</span></NavLink><div className="sidebar-section-label">你的音乐</div><nav aria-label="主导航">{navigation.map(({ to, name, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenu(false)}><Icon size={20} /><span>{name}</span></NavLink>)}</nav><div className="sidebar-bottom"><NavLink to="/settings" onClick={() => setMenu(false)}><SettingsIcon size={19} />设置</NavLink><div className="connection-label"><span />已连接 Navidrome</div></div></aside>{menu && <button className="menu-scrim" aria-label="关闭导航" onClick={() => setMenu(false)} />}
    <div className="app-main"><header className="topbar"><div className="button-row"><IconButton id="tooku-menu-toggle" label="打开导航" className="icon-button menu-toggle" aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu size={21} /></IconButton><IconButton label="返回" onClick={() => navigate(-1)}><ChevronLeft size={22} /></IconButton><IconButton label="前进" onClick={() => navigate(1)}><ChevronRight size={22} /></IconButton></div><button className="top-search" onClick={() => navigate('/search')}><SearchIcon size={17} /><span>搜索你的音乐</span><kbd>⌘ K</kbd></button><div className="account"><span>{api.username}</span><IconButton label="退出连接" onClick={() => logout()}><LogOut size={18} /></IconButton></div></header>
      <main className="content"><Routes><Route path="/" element={<Home />} /><Route path="/albums" element={<Albums />} /><Route path="/albums/:id" element={<AlbumDetail addToPlaylist={setAdding} />} /><Route path="/artists" element={<Artists />} /><Route path="/artists/:id" element={<ArtistDetail />} /><Route path="/search" element={<Search addToPlaylist={setAdding} />} /><Route path="/favorites" element={<Favorites addToPlaylist={setAdding} />} /><Route path="/playlists" element={<Playlists />} /><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={setAdding} />} /><Route path="/history" element={<History addToPlaylist={setAdding} />} /><Route path="/settings" element={<Settings logout={() => logout()} />} /><Route path="*" element={<div className="empty"><h1>页面不存在</h1><NavLink to="/">回到音乐库</NavLink></div>} /></Routes></main>
    </div><PlayerBar queueOpen={queue} openQueue={() => setQueue(true)} openLyrics={() => currentId && setLyrics(true)} />
    {queue && <Queue onClose={() => setQueue(false)} />}{lyrics && <LyricsPlayer onClose={() => setLyrics(false)} />}{adding && <AddToPlaylist track={adding} onClose={() => setAdding(null)} />}
    {notice && <div className="toast" role="status">{notice}<IconButton label="关闭提示" onClick={() => useSession.getState().notify('')}><X size={17} /></IconButton></div>}
  </div>;
}
