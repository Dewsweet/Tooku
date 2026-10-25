import { useRef, useState } from 'react';
import { Moon, Sun, RefreshCw, ExternalLink, UserRound, Palette, SlidersHorizontal, Captions, Sparkles, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Select } from '../components/Select';
import { PageTitle, QueryState, useApi } from '../components/Common';
import { usePreferences } from '../state/preferences';
import { usePlayer, player } from '../features/player/engine';
import { clearProfile } from '../storage/local';
import { useSession, errorMessage } from '../state/session';
import { useLibrary, useMusicLibrary } from '../state/library';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { useProfiles } from '../state/profile';
import { AvatarEditor } from '../components/AvatarEditor';
import { PanelLayoutControls } from '../features/player/PanelLayoutControls';
import { UserDataSettings } from '../features/settings/UserDataSettings';
import { NetworkLyricsSettings } from '../features/settings/NetworkLyricsSettings';
import { RecommendationSettings } from '../features/settings/RecommendationSettings';
import { SettingsSection } from '../features/settings/SettingsSection';
import { AccentColorControl } from '../features/settings/AccentColorControl';
import { baseFontSizes, fontFamilies, useDisplayPreferences } from '../state/display';
import { clearPwaCaches } from '../pwa';

const categories = [
  { id: 'account', name: '账户与音乐库', icon: UserRound },
  { id: 'appearance', name: '外观', icon: Palette },
  { id: 'playback', name: '播放与操作', icon: SlidersHorizontal },
  { id: 'lyrics', name: '网络歌词', icon: Captions },
  { id: 'recommendations', name: '音乐推荐', icon: Sparkles },
  { id: 'data', name: '用户数据', icon: Database },
] as const;
type Category = typeof categories[number]['id'];

export function Settings({ logout }: { logout: () => void }) {
  const api = useApi();
  const version = useSession((s) => s.version);
  const prefs = usePreferences();
  const baseFontSize = useDisplayPreferences((s) => s.baseFontSize);
  const fontFamily = useDisplayPreferences((s) => s.fontFamily);
  const mode = usePlayer((s) => s.mode);
  const library = useMusicLibrary();
  const navigate = useNavigate();
  const [category, setCategory] = useState<Category>('account');
  const [busy, setBusy] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const [avatarError, setAvatarError] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const avatar = useProfiles((s) => s.avatars[api.identity]);
  const serverUrl = api.base.endsWith('/nd') ? 'http://127.0.0.1:44533' : api.base;

  return <div className="settings-page">
    <PageTitle title="账户与设置" />
    <div className="settings-layout">
      <nav className="settings-navigation" aria-label="设置分类" ref={navigation}>
        {categories.map(({ id, name, icon: Icon }) => <button type="button" key={id} id={`settings-nav-${id}`} aria-current={category === id ? 'true' : undefined} aria-controls={`settings-panel-${id}`} onClick={() => {
          setCategory(id);
          navigation.current?.scrollIntoView?.({ block: 'nearest' });
        }}><Icon size={18} aria-hidden="true" /><span>{name}</span></button>)}
      </nav>
      <div className="settings-content">
        {/* Keep groups mounted so navigation preserves drafts and pending checks. */}
        <div id="settings-panel-account" role="group" aria-labelledby="settings-nav-account" hidden={category !== 'account'}>
          <SettingsSection title="账户">
            <div className="avatar-setting">
              <ProfileAvatar identity={api.identity} username={api.username} large />
              <div><strong>{api.username}</strong><div className="button-row">
                <button className="subtle-button" onClick={() => avatarInput.current?.click()}>选择头像</button>
                {avatar && <button className="text-button" onClick={() => { useProfiles.getState().setAvatar(api.identity); setAvatarError(''); }}>恢复默认</button>}
              </div></div>
              <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传头像" hidden onChange={(e) => {
                const file = e.target.files?.[0]; e.target.value = '';
                if (file) { setAvatarError(''); setAvatarFile(file); }
              }} />
            </div>
            {avatarError && <p className="form-error" role="alert">{avatarError}</p>}
            <div className="setting-row"><div><strong>音乐服务器</strong><p>{serverUrl}</p></div><button className="subtle-button" onClick={logout}>切换账号</button></div>
          </SettingsSection>
          <SettingsSection title="音乐库" action={<button className="text-button" onClick={() => library.refetch()}><RefreshCw size={16} />刷新</button>}>
            <div className="setting-row"><div><strong>当前音乐库</strong><p>切换浏览内容，保留当前播放。</p></div>
              <Select aria-label="当前音乐库" value={library.libraryId ?? ''} disabled={library.isPending || !library.libraries.length} onChange={(value) => {
                useLibrary.getState().change(api.identity, (p) => ({ ...p, activeId: value })); navigate('/');
              }}>{library.libraries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
            </div>
            <QueryState pending={library.isPending} error={library.error} retry={() => library.refetch()} />
            <div className="settings-footer"><p className="settings-note">头像、目录与偏好按账号保存，可在「用户数据」中查看同步状态。音乐与歌单内容由 Navidrome 管理。</p>
              <a className="text-button settings-external" href={serverUrl} target="_blank" rel="noreferrer">在 Navidrome 管理曲库与用户<ExternalLink size={15} /></a>
            </div>
          </SettingsSection>
        </div>
        <div id="settings-panel-appearance" role="group" aria-labelledby="settings-nav-appearance" hidden={category !== 'appearance'}>
          <SettingsSection title="外观">
            <div className="setting-row"><strong>明暗模式</strong><div className="theme-options" role="group" aria-label="明暗模式">
              <button aria-pressed={prefs.theme === 'light'} onClick={() => prefs.update({ theme: 'light' })}><Sun size={18} />浅色</button>
              <button aria-pressed={prefs.theme === 'dark'} onClick={() => prefs.update({ theme: 'dark' })}><Moon size={18} />深色</button>
            </div></div>
            <AccentColorControl />
            <div className="setting-row"><strong>界面字体</strong><Select aria-label="界面字体" value={fontFamily} onChange={(value) => useDisplayPreferences.getState().setFontFamily(value)}>{fontFamilies.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}</Select></div>
            <div className="setting-row"><span className="setting-copy"><strong>基础字号</strong><span className="setting-description">仅在此浏览器生效，歌词字号单独设置。</span></span><Select aria-label="基础字号" value={baseFontSize} onChange={(value) => useDisplayPreferences.getState().setBaseFontSize(Number(value))}>{baseFontSizes.map((size) => <option key={size} value={size}>{size === 14 ? '标准' : size < 14 ? '小' : size === 16 ? '大' : '更大'} · {size} px</option>)}</Select></div>
            <label className="setting-row"><span className="setting-copy"><strong>减少动态效果</strong><span className="setting-description">减少界面过渡与文字滚动。</span></span><input aria-label="减少动态效果" className="settings-switch" type="checkbox" role="switch" checked={prefs.reducedMotion} onChange={(e) => prefs.update({ reducedMotion: e.target.checked })} /></label>
          </SettingsSection>
        </div>
        <div id="settings-panel-playback" role="group" aria-labelledby="settings-nav-playback" hidden={category !== 'playback'}>
          <SettingsSection title="播放与操作">
            <div className="setting-row"><div><strong>音频策略</strong><p>遇到格式兼容问题时，可切换为 MP3。</p></div><Select aria-label="音频策略" value={mode} onChange={(value) => player.mode(value as 'original' | 'compatible')}><option value="original">原始音频</option><option value="compatible">兼容 MP3</option></Select></div>
            <div className="setting-row"><div><strong>淡入淡出</strong><p>切歌、暂停和继续播放时平滑调整音量。</p></div><Select aria-label="淡入淡出" value={prefs.fadeDurationMs} onChange={(value) => prefs.update({ fadeDurationMs: Number(value) })}><option value="0">关闭</option><option value="200">0.2 秒</option><option value="500">0.5 秒</option><option value="1000">1 秒</option><option value="2000">2 秒</option></Select></div>
            <label className="setting-row"><span className="setting-copy"><strong>键盘快捷键</strong><span className="setting-description">空格播放 / 暂停，左右键跳转，Ctrl / ⌘ K 搜索。</span></span><input aria-label="键盘快捷键" className="settings-switch" type="checkbox" role="switch" checked={prefs.shortcuts} onChange={(e) => prefs.update({ shortcuts: e.target.checked })} /></label>
          </SettingsSection>
          <SettingsSection title="播放侧栏">
            <label className="setting-row"><strong>显示播放侧栏</strong><input className="settings-switch" type="checkbox" role="switch" checked={prefs.sidePanel} onChange={(e) => prefs.update({ sidePanel: e.target.checked })} /></label>
            <PanelLayoutControls />
          </SettingsSection>
        </div>
        <div id="settings-panel-lyrics" role="group" aria-labelledby="settings-nav-lyrics" hidden={category !== 'lyrics'}><NetworkLyricsSettings /></div>
        <div id="settings-panel-recommendations" role="group" aria-labelledby="settings-nav-recommendations" hidden={category !== 'recommendations'}><RecommendationSettings /></div>
        <div id="settings-panel-data" role="group" aria-labelledby="settings-nav-data" hidden={category !== 'data'}>
          <UserDataSettings />
          <SettingsSection title="高级设置">
            <div className="setting-row"><div><strong>Navidrome {version}</strong><p>{[...api.extensions.entries()].map(([name, versions]) => `${name} v${versions.join('/')}`).join(' · ') || '基础 Subsonic 协议'}</p></div></div>
            <div className="setting-row"><div><strong>本机队列与历史快照</strong><p>仅清除本机播放快照；保留服务器数据，下次登录可能恢复。</p></div>
              <button className="subtle-button" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await clearProfile(api.identity); useSession.getState().notify('已清除本机快照'); }
                catch (e) { useSession.getState().notify(errorMessage(e)); }
                finally { setBusy(false); }
              }}>清除快照</button>
            </div>
            <div className="setting-row"><div><strong>应用离线缓存</strong><p>只清除安装外壳和静态资源，不清除账号数据、队列或登录状态。</p></div><button className="subtle-button" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await clearPwaCaches(); useSession.getState().notify('应用缓存已清除，将在需要时重新获取。'); }
              catch (e) { useSession.getState().notify(errorMessage(e)); }
              finally { setBusy(false); }
            }}>清除应用缓存</button></div>
          </SettingsSection>
        </div>
      </div>
    </div>
    {avatarFile && <AvatarEditor file={avatarFile} onSave={(image) => useProfiles.getState().setAvatar(api.identity, image)} onClose={() => setAvatarFile(null)} />}
  </div>;
}
