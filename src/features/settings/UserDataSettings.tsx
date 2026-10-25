import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { isBackup, isUserData, maxUserDataBytes, type UserData } from '../../domain/userData';
import { chooseUserData, displacedLocalData, exportUserBackup, localUserData, previousUserData, refreshUserSync, syncOwner, useUserSync } from '../../storage/userSync';
import { SettingsSection } from './SettingsSection';

function Summary({ data }: { data: UserData | null }) {
  if (!data) return <p>暂无数据</p>;
  return <p>{data.profile.avatar ? '有头像 · ' : ''}{Object.keys(data.profile.playlistCovers).length} 张歌单封面 · {Object.keys(data.profile.artistCovers ?? {}).length} 张歌手图片 · {data.organization.folders.length} 个文件夹 · {data.queue?.entries.length ?? 0} 首队列 · {data.history.length} 条历史{data.recommendations ? ` · 推荐设置 / ${data.recommendations.batch?.songs.length ?? 0} 首推荐` : ''}</p>;
}
export function UserDataSettings() {
  const state = useUserSync(); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ title: string; data: UserData; source: 'local' | 'server' } | null>(null);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作未完成。'); } finally { setBusy(false); } }
  async function download() {
    const backup = await exportUserBackup('account');
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `tooku-account-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const local = localUserData(); const connected = state.status !== 'local';
  const needsChoice = state.status === 'review' || state.status === 'conflict';
  return <SettingsSection title="用户数据">
    <div className="settings-status-row"><div><strong role="status">{state.status === 'local' ? '仅保存在此浏览器' : state.message}</strong><p className="settings-note">管理此账号的头像、封面、目录、偏好、歌词与推荐设置、队列和收听历史。</p></div><button className="subtle-button" disabled={busy || state.status === 'saving'} onClick={() => void run(refreshUserSync)}>重新连接</button></div>
    {state.status === 'local' && <p className="settings-notice">直连模式仅保存在此浏览器，可导出备份。</p>}
    {needsChoice && <div className="settings-subsection"><h3>处理数据冲突</h3>
      <div className="setting-row"><div><strong>此浏览器的数据</strong><p>当前正在使用的设置与记录。</p><Summary data={local} /></div><button className="subtle-button" disabled={busy || state.status === 'saving' || !local || !state.remote} onClick={() => local && setPreview({ title: '用此浏览器数据覆盖服务器', data: local, source: 'local' })}>保存到服务器</button></div>
      <div className="setting-row"><div><strong>服务器已保存的数据{state.remote ? ` · 版本 ${state.remote.revision}` : ''}</strong><p>同一账号在其他浏览器登录时读取的数据。</p><Summary data={state.remote?.data ?? null} /></div>{state.remote?.data && <button className="subtle-button" disabled={busy || state.status === 'saving'} onClick={() => state.remote?.data && setPreview({ title: '从服务器恢复到此浏览器', data: state.remote.data, source: 'server' })}>从服务器恢复</button>}</div>
      <p className="settings-note">平时自动保存与读取；两端数据冲突时，选择要保留的一份。操作前会显示覆盖范围，服务器离线时仍可使用此浏览器的数据。</p>
      </div>}
      <div className="settings-subsection"><h3>备份与恢复</h3><p className="settings-note">备份包含推荐设置与最近结果，恢复旧备份会重置它们；服务密钥不进入备份。歌单内容保存在 Navidrome。</p>
      <div className="settings-action-list">
        <div className="setting-row"><strong>导出账号数据</strong><button className="subtle-button" disabled={busy || !local} onClick={() => void run(download)}>导出备份</button></div>
        <div className="setting-row"><strong>从文件恢复</strong><button className="subtle-button" disabled={busy || state.status === 'saving'} onClick={() => input.current?.click()}>选择备份文件</button></div>
      </div>
      <details className="settings-recovery"><summary>恢复旧版本</summary><div className="button-row">{connected && <button className="subtle-button" disabled={busy || state.status === 'saving'} onClick={() => void run(async () => { const versions = await previousUserData(); const data = versions[0]?.data; if (!data) throw new Error('暂无服务器上一版本。'); setPreview({ title: `恢复服务器版本 ${versions[0].revision}`, data, source: 'local' }); })}>恢复服务器上一版本</button>}<button className="subtle-button" disabled={busy || state.status === 'saving'} onClick={() => void run(async () => { const data = await displacedLocalData(); if (!isUserData(data)) throw new Error('暂无上次覆盖前的数据。'); setPreview({ title: '恢复上次覆盖前的数据', data, source: 'local' }); })}>恢复上次覆盖前的数据</button></div></details>
      </div>
    <input ref={input} type="file" accept="application/json,.json" hidden aria-label="选择用户数据备份" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; void run(async () => {
      if (file.size > maxUserDataBytes + 4096) throw new Error('备份不能超过 12 MB。');
      const backup: unknown = JSON.parse(await file.text()); if (!isBackup(backup)) throw new Error('备份格式或版本无效。');
      if (backup.owner !== syncOwner()) throw new Error('备份不属于当前音乐服务账号。');
      if (connected && !state.remote) throw new Error('请先重新连接并读取服务器版本。');
      setPreview({ title: '从备份恢复', data: backup.data, source: 'local' });
    }); }} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <Modal title={preview.title} busy={busy} onClose={() => !busy && setPreview(null)}>
      <p>{!connected ? '将用备份恢复此账号的浏览器数据。' : preview.source === 'server' ? '将使用服务器保存的数据，替换此浏览器的头像、封面、目录、偏好、歌词与推荐设置及播放记录。服务器数据保持不变。' : '将用以下数据覆盖服务器和此浏览器的头像、封面、目录、偏好、歌词与推荐设置及播放记录。其他浏览器下次登录时会读取这份数据。'}</p>
      <Summary data={preview.data} />
      <p>原数据保留为恢复前副本。当前音乐继续播放，队列和历史在下次登录时应用，本次播放不覆盖恢复结果。</p><p>服务密钥及 Navidrome 的音乐、歌单和收藏保持不变。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row"><button className="subtle-button" disabled={busy} onClick={() => setPreview(null)}>取消</button><button className="primary-button" disabled={busy} onClick={() => void run(async () => { await chooseUserData(preview.source, preview.source === 'local' ? preview.data : undefined); setPreview(null); })}>{busy ? '正在保存…' : !connected ? '确认恢复' : preview.source === 'server' ? '确认恢复到此浏览器' : '确认覆盖并同步'}</button></div>
    </Modal>}
  </SettingsSection>;
}
