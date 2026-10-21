import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { isBackup, isUserData, maxUserDataBytes, type UserData } from '../../domain/userData';
import { chooseUserData, displacedLocalData, exportUserBackup, localUserData, previousUserData, refreshUserSync, syncOwner, useUserSync } from '../../storage/userSync';

function Summary({ data }: { data: UserData | null }) {
  if (!data) return <p>暂无数据</p>;
  return <p>{data.profile.avatar ? '有头像 · ' : ''}{Object.keys(data.profile.playlistCovers).length} 张歌单封面 · {Object.keys(data.profile.artistCovers ?? {}).length} 张歌手图片 · {data.organization.folders.length} 个文件夹 · {data.queue?.entries.length ?? 0} 首队列 · {data.history.length} 条历史{data.recommendations ? ` · 推荐设置 / ${data.recommendations.batch?.songs.length ?? 0} 首推荐` : ''}</p>;
}
export function UserDataSettings() {
  const state = useUserSync(); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ title: string; data: UserData; source: 'local' | 'server' } | null>(null);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作未完成。'); } finally { setBusy(false); } }
  async function download(source: 'local' | 'server') {
    const backup = await exportUserBackup(source);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `tooku-${source}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const local = localUserData(); const connected = Boolean(syncOwner());
  return <section className="settings-section"><h2>用户数据</h2><div className="setting-row"><div><strong role="status">{state.message}</strong><p>头像、封面、目录、偏好、队列与历史。歌单内容保存在 Navidrome。</p></div><button className="subtle-button" disabled={busy || state.status === 'saving'} onClick={() => void run(refreshUserSync)}>重新连接</button></div>
    {state.status === 'local' && <p>使用 /nd 连接部署配置中的音乐服务后，可开启服务器保存。</p>}
    {connected && <><div className="setting-row"><div><strong>此设备</strong><Summary data={local} /></div><button className="subtle-button" disabled={busy || state.status === 'saving' || !local || !state.remote} onClick={() => local && setPreview({ title: '将此设备数据保存到服务器', data: local, source: 'local' })}>预览导入</button></div>
      <div className="setting-row"><div><strong>服务器{state.remote ? ` · 版本 ${state.remote.revision}` : ''}</strong><Summary data={state.remote?.data ?? null} /></div>{state.remote?.data && <button className="subtle-button" disabled={busy || state.status === 'saving'} onClick={() => state.remote?.data && setPreview({ title: '使用服务器数据', data: state.remote.data, source: 'server' })}>预览使用</button>}</div>
      <div className="button-row"><button className="subtle-button" disabled={busy} onClick={() => void run(() => download('local'))}>导出此设备备份</button><button className="subtle-button" disabled={busy || !state.remote?.data} onClick={() => void run(() => download('server'))}>导出服务器备份</button><button className="subtle-button" disabled={busy || state.status === 'saving'} onClick={() => input.current?.click()}>从备份恢复</button></div>
      <div className="button-row"><button className="text-button" disabled={busy || state.status === 'saving'} onClick={() => void run(async () => { const versions = await previousUserData(); const data = versions[0]?.data; if (!data) throw new Error('暂无服务器上一版本。'); setPreview({ title: `恢复服务器版本 ${versions[0].revision}`, data, source: 'local' }); })}>恢复服务器上一版本</button><button className="text-button" disabled={busy || state.status === 'saving'} onClick={() => void run(async () => { const data = await displacedLocalData(); if (!isUserData(data)) throw new Error('暂无导入前的本地副本。'); setPreview({ title: '恢复导入前的本地副本', data, source: 'local' }); })}>恢复导入前副本</button></div>
      <p className="settings-note">空白端自动迁移或读取；两端有不同数据时需选择版本。恢复会替换所列用户数据，保留导入前副本；队列在下次登录时恢复，当前播放保持不变。服务器离线时继续使用本地数据。</p>
    </>}
    <input ref={input} type="file" accept="application/json,.json" hidden aria-label="选择用户数据备份" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; void run(async () => {
      if (file.size > maxUserDataBytes + 4096) throw new Error('备份不能超过 12 MB。');
      const backup: unknown = JSON.parse(await file.text()); if (!isBackup(backup)) throw new Error('备份格式或版本无效。');
      if (backup.owner !== syncOwner()) throw new Error('备份不属于当前音乐服务账号。');
      if (!state.remote) throw new Error('请先重新连接并读取服务器版本。');
      setPreview({ title: '从备份恢复', data: backup.data, source: 'local' });
    }); }} />
    <p className="settings-note">备份包含推荐设置与最近结果，恢复旧备份会重置它们；服务密钥不进入备份。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <Modal title={preview.title} onClose={() => !busy && setPreview(null)}><Summary data={preview.data} /><p>将替换头像、封面、目录、外观及播放快照。此设备原数据保留为导入前副本，服务器保留最近两个旧版本。</p><p>此操作不修改 Navidrome 的音乐、歌单或收藏。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="button-row"><button className="subtle-button" disabled={busy} onClick={() => setPreview(null)}>取消</button><button className="primary-button" disabled={busy} onClick={() => void run(async () => { await chooseUserData(preview.source, preview.source === 'local' ? preview.data : undefined); setPreview(null); })}>{busy ? '正在保存…' : '确认使用'}</button></div></Modal>}
  </section>;
}
