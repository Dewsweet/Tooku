import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, Music2, Search, Settings, PanelRight, Menu, LogOut, ChevronDown } from 'lucide-react';
import { IconButton } from './Common';
import { ProfileAvatar } from './ProfileAvatar';

export function WorkspaceHeader({ identity, username, menuOpen, panelOpen, toggleMenu, togglePanel, logout }: {
  identity: string; username: string; menuOpen: boolean; panelOpen: boolean;
  toggleMenu: () => void; togglePanel: () => void; logout: () => void;
}) {
  const navigate = useNavigate(); const location = useLocation(); const [search, setSearch] = useState(''); const [accountOpen, setAccountOpen] = useState(false); const accountRef = useRef<HTMLDivElement>(null); const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (location.pathname === '/search') setSearch(new URLSearchParams(location.search).get('q') ?? ''); setAccountOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!accountOpen) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !accountRef.current?.contains(event.target)) setAccountOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);
  function submit(event: FormEvent) { event.preventDefault(); navigate(search.trim() ? `/search?q=${encodeURIComponent(search.trim())}` : '/search'); }
  return <header className="workspace-header"><div className="header-brand"><IconButton id="tooku-menu-toggle" label={menuOpen ? '关闭导航' : '打开导航'} className="icon-button menu-toggle" aria-expanded={menuOpen} aria-controls="workspace-sidebar" onClick={toggleMenu}><Menu size={22} /></IconButton><Link className="header-logo" to="/" aria-label="Tooku 主页"><span className="brand-icon"><Music2 size={24} /></span><span>Tooku</span></Link></div>
    <div className="header-discovery"><NavLink className="header-home" to="/" end aria-label="主页"><Home size={23} fill="currentColor" /></NavLink><form className="header-search" role="search" onSubmit={submit}><button type="submit" aria-label="搜索"><Search size={22} /></button><input aria-label="搜索音乐库" placeholder="想听点什么？" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} autoComplete="off" /><span className="header-search-key" aria-hidden="true">↵</span></form></div>
    <div className="header-actions"><IconButton id="tooku-panel-toggle" label={panelOpen ? '隐藏播放侧栏' : '显示播放侧栏'} aria-pressed={panelOpen} onClick={togglePanel}><PanelRight size={21} /></IconButton><Link className="icon-button header-settings" to="/settings" aria-label="设置"><Settings size={21} /></Link><div className="header-account" ref={accountRef}><button className="profile-trigger" aria-label="账户菜单" aria-expanded={accountOpen} aria-controls="account-menu" ref={triggerRef} onClick={() => setAccountOpen(!accountOpen)}><ProfileAvatar identity={identity} username={username} /><ChevronDown size={13} /></button>{accountOpen && <div className="profile-popover" id="account-menu"><div className="profile-popover-user"><ProfileAvatar identity={identity} username={username} /><strong>{username}</strong></div><Link to="/settings" onClick={() => setAccountOpen(false)}><Settings size={17} />账户与设置</Link><button onClick={() => { setAccountOpen(false); logout(); }}><LogOut size={17} />切换账号</button></div>}</div></div>
  </header>;
}
