import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, Music2, Search, Settings, PanelRight, Menu, LogOut, ChevronDown, ChevronRight, Check, Library, X } from 'lucide-react';
import { IconButton } from './Common';
import { ProfileAvatar } from './ProfileAvatar';
import { useLibrary, useMusicLibrary } from '../state/library';

export function WorkspaceHeader({ identity, username, menuOpen, panelOpen, toggleMenu, togglePanel, logout }: {
  identity: string; username: string; menuOpen: boolean; panelOpen: boolean;
  toggleMenu: () => void; togglePanel: () => void; logout: () => void;
}) {
  const navigate = useNavigate(); const location = useLocation(); const library = useMusicLibrary(); const [search, setSearch] = useState(''); const [composing, setComposing] = useState(false);
  const editing = useRef(false); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [accountOpen, setAccountOpen] = useState(false); const [librariesOpen, setLibrariesOpen] = useState(false); const accountRef = useRef<HTMLDivElement>(null); const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = location.pathname === '/search' ? new URLSearchParams(location.search).get('q') ?? '' : '';
    editing.current = false; setSearch(query); setAccountOpen(false); setLibrariesOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    if (!editing.current || composing) return;
    timer.current = setTimeout(() => {
      editing.current = false; const params = new URLSearchParams(location.pathname === '/search' ? location.search : '');
      if (search.trim()) params.set('q', search.trim()); else params.delete('q');
      navigate(`/search${params.size ? `?${params}` : ''}`, { replace: location.pathname === '/search' });
    }, 300);
    return () => clearTimeout(timer.current);
  }, [search, composing, location.pathname, location.search, navigate]);
  useEffect(() => {
    if (!accountOpen) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !accountRef.current?.contains(event.target)) setAccountOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);
  function submit(event: FormEvent) { event.preventDefault(); if (composing) return; clearTimeout(timer.current); editing.current = false; navigate(search.trim() ? `/search?q=${encodeURIComponent(search.trim())}` : '/search'); }
  return <header className="workspace-header"><div className="header-brand"><IconButton id="tooku-menu-toggle" label={menuOpen ? '关闭导航' : '打开导航'} className="icon-button menu-toggle" aria-expanded={menuOpen} aria-controls="workspace-sidebar" onClick={toggleMenu}><Menu size={22} /></IconButton><Link className="header-logo" to="/" aria-label="Tooku 主页"><span className="brand-icon"><Music2 size={24} /></span><span>Tooku</span></Link></div>
    <div className="header-discovery"><NavLink className="header-home" to="/" end aria-label="主页">{({ isActive }) => <Home size={23} fill={isActive ? 'currentColor' : 'none'} strokeWidth={1.8} />}</NavLink><form className="header-search" role="search" onSubmit={submit}><button type="submit" aria-label="搜索"><Search size={22} /></button><input aria-label="搜索音乐库" placeholder="想听点什么？" value={search} onChange={(e) => { editing.current = true; setSearch(e.target.value); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={(e) => { editing.current = true; setSearch(e.currentTarget.value); setComposing(false); }} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} autoComplete="off" />{search && <button type="button" className="header-clear-search" aria-label="清空搜索" onClick={() => { editing.current = true; setSearch(''); }}><X size={18} /></button>}</form></div>
    <div className="header-actions"><IconButton id="tooku-panel-toggle" label={panelOpen ? '隐藏播放侧栏' : '显示播放侧栏'} aria-pressed={panelOpen} onClick={togglePanel}><PanelRight size={21} /></IconButton><div className="header-account" ref={accountRef}><button className="profile-trigger" aria-label="账户菜单" aria-expanded={accountOpen} aria-controls="account-menu" ref={triggerRef} onClick={() => setAccountOpen(!accountOpen)}><ProfileAvatar identity={identity} username={username} /><ChevronDown size={13} /></button>{accountOpen && <div className="profile-popover" id="account-menu"><div className="profile-popover-user"><ProfileAvatar identity={identity} username={username} /><strong>{username}</strong></div>
      <button className="quick-library-trigger" aria-expanded={librariesOpen} onClick={() => setLibrariesOpen(!librariesOpen)}><Library size={17} /><span>音乐库<span>{library.active?.name ?? '加载中…'}</span></span><ChevronRight className={librariesOpen ? 'expanded' : ''} size={16} /></button>
      {librariesOpen && <div className="quick-library-options" role="group" aria-label="快速切换音乐库">{library.libraries.map((item) => <button key={item.id} aria-pressed={library.libraryId === item.id} onClick={() => { clearTimeout(timer.current); editing.current = false; useLibrary.getState().change(identity, (p) => ({ ...p, activeId: item.id })); setAccountOpen(false); setLibrariesOpen(false); setSearch(''); navigate('/'); }}><span>{item.name}</span>{library.libraryId === item.id && <Check size={16} />}</button>)}{library.error && <button onClick={() => library.refetch()}>重新读取音乐库</button>}</div>}
      <Link to="/settings" onClick={() => setAccountOpen(false)}><Settings size={17} />账户与设置</Link><button onClick={() => { setAccountOpen(false); logout(); }}><LogOut size={17} />切换账号</button></div>}</div></div>
  </header>;
}
