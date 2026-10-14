import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageTitle, QueryState, useApi } from '../components/Common';
import { usePreferences } from '../state/preferences';
import { usePlayer, player } from '../features/player/engine';
import { clearProfile } from '../storage/local';
import { useSession, errorMessage } from '../state/session';

export function Settings({ logout }: { logout: () => void }) {
  const api = useApi(); const version = useSession((s) => s.version); const prefs = usePreferences(); const mode = usePlayer((s) => s.mode); const [busy, setBusy] = useState(false);
  const folders = useQuery({ queryKey: [api.identity, 'folders'], queryFn: ({ signal }) => api.request('getMusicFolders', {}, signal) });
  return <><PageTitle title="设置" /><section className="settings-section"><h2>外观与操作</h2><div className="setting-row"><div><strong>主题</strong><p>默认使用简洁的白色界面。</p></div><select aria-label="主题" value={prefs.theme} onChange={(e) => prefs.update({ theme: e.target.value as 'light' | 'dark' })}><option value="light">浅色</option><option value="dark">深色</option></select></div><label className="setting-row"><div><strong>减少动态效果</strong><p>减少歌词滚动和界面动效。</p></div><input type="checkbox" checked={prefs.reducedMotion} onChange={(e) => prefs.update({ reducedMotion: e.target.checked })} /></label><label className="setting-row"><div><strong>键盘快捷键</strong><p>空格播放 / 暂停，左右跳转，Ctrl / ⌘ K 搜索。</p></div><input type="checkbox" checked={prefs.shortcuts} onChange={(e) => prefs.update({ shortcuts: e.target.checked })} /></label></section>
    <section className="settings-section"><h2>播放</h2><div className="setting-row"><div><strong>音频策略</strong><p>兼容模式请求服务器转码为 MP3。实际格式取决于服务配置。</p></div><select aria-label="音频策略" value={mode} onChange={(e) => player.mode(e.target.value as 'original' | 'compatible')}><option value="original">原始音频</option><option value="compatible">兼容 MP3</option></select></div></section>
    <section className="settings-section"><h2>连接与本机数据</h2><div className="setting-row"><div><strong>Navidrome {version}</strong><p>{api.username} · {api.base}</p></div><button className="subtle-button" onClick={logout}>退出连接</button></div><div className="setting-row"><div><strong>服务能力声明</strong><p>{[...api.extensions.entries()].map(([name, versions]) => `${name} v${versions.join('/')}`).join(' · ') || '服务器未返回扩展列表；使用基础协议。'}</p><p>这些是服务器声明，具体音频和歌词数据仍需实际播放验证。</p></div></div><QueryState pending={folders.isPending} error={folders.error} retry={() => folders.refetch()} /><div className="setting-row"><div><strong>清除本机队列与历史快照</strong><p>不会修改服务器。正在播放的队列仍在内存，下一次操作会重新保存。</p></div><button className="subtle-button" disabled={busy} onClick={async () => { setBusy(true); try { await clearProfile(api.identity); useSession.getState().notify('已清除此账号的本机快照'); } catch (e) { useSession.getState().notify(errorMessage(e)); } finally { setBusy(false); } }}>清除快照</button></div></section>
  </>;
}
