import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi } from '../../components/Common';
import { Modal } from '../../components/Modal';
import { prepareServerAlias } from '../../api/client';
import type { ManagedServer } from '../../api/userData';
import { rememberLoginServer } from '../../storage/loginServer';
import { SettingsSection } from './SettingsSection';

export function ServerSettings() {
  const api = useApi(); const request = useRef<AbortController | null>(null);
  const [server, setServer] = useState<ManagedServer | null>(null); const [address, setAddress] = useState('');
  const [candidate, setCandidate] = useState<{ base: string; connectionId: string } | null>(null);
  const [removing, setRemoving] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!api.persistent) return;
    let active = true; void api.userData().then((client) => client?.server()).then((value) => { if (active && value) setServer(value); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '无法读取音乐服务器记录。'); });
    return () => { active = false; request.current?.abort(); };
  }, [api]);
  async function check(event: FormEvent) {
    event.preventDefault(); if (busy || !address.trim()) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const value = await prepareServerAlias(address, controller.signal);
      if (server?.aliases.includes(value.base)) throw new Error('这个地址已经属于当前音乐服务器。');
      setCandidate(value);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '地址验证未完成。'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function confirm() {
    if (!candidate || busy) return; setBusy(true); setError('');
    try {
      const client = await api.userData(); if (!client) throw new Error('当前连接不支持服务器地址管理。');
      setServer(await client.addServerAlias(candidate.connectionId)); setAddress(''); setCandidate(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新地址保存失败，请重新验证。'); }
    finally { setBusy(false); }
  }
  async function primary(value: string) {
    if (busy) return; setBusy(true); setError('');
    try { const client = await api.userData(); if (!client) throw new Error('当前连接不支持服务器地址管理。'); setServer(await client.setPrimaryServerAddress(value)); rememberLoginServer(value); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '首选地址保存失败。'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!removing || busy) return; setBusy(true); setError('');
    try { const client = await api.userData(); if (!client) throw new Error('当前连接不支持服务器地址管理。'); setServer(await client.removeServerAlias(removing)); setRemoving(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '地址移除失败。'); }
    finally { setBusy(false); }
  }
  if (!api.persistent) return null;
  return <SettingsSection title="服务器地址">
    <div className="setting-row"><div><strong>当前地址</strong><p>{server?.address ?? api.base}</p></div></div>
    {server && server.aliases.length > 1 && <div className="settings-subsection"><h3>已验证地址</h3><div className="server-alias-list">{server.aliases.map((value) => <div className="setting-row" key={value}><div><strong>{value === server.primary ? '首选地址' : '备用地址'}</strong><p>{value}</p></div><div className="button-row">{value !== server.primary && <button className="subtle-button" disabled={busy} onClick={() => void primary(value)}>设为首选</button>}<button className="text-button" disabled={busy || value === server.address} onClick={() => setRemoving(value)}>{value === server.address ? '当前使用' : '移除'}</button></div></div>)}</div></div>}
    <form className="setting-row" onSubmit={(event) => void check(event)}><label className="setting-copy" htmlFor="managed-server-alias"><strong>添加同一服务器的新地址</strong><span className="setting-description">用于域名、端口或反向代理地址变更，保存后继续使用同一份账号数据。</span></label><div className="server-alias-control"><input id="managed-server-alias" type="url" inputMode="url" autoComplete="off" placeholder="https://music.example.com" value={address} disabled={busy} onChange={(event) => { setAddress(event.target.value); setError(''); }} /><button className="subtle-button" disabled={busy || !address.trim()}>{busy ? '验证中…' : '验证地址'}</button></div></form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {candidate && <Modal title="确认这是同一台音乐服务器？" busy={busy} onClose={() => !busy && setCandidate(null)}><p>新地址为：{candidate.base}</p><p>确认后，此地址会使用当前服务器账号已有的设置、备份和服务密钥。只应在域名、端口或反向代理地址变更时合并。</p><p>当前播放不会切换；下次使用新地址登录后生效。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="button-row"><button type="button" className="subtle-button" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button type="button" className="primary-button" disabled={busy} onClick={() => void confirm()}>{busy ? '正在保存…' : '确认合并地址'}</button></div></Modal>}
    {removing && <Modal title="移除服务器地址？" busy={busy} onClose={() => !busy && setRemoving('')}><p>将停止通过以下地址建立新会话：</p><p>{removing}</p><p>服务器账号数据和其他已验证地址保持不变；仍使用该地址的其他标签页会在下次请求时退出。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="button-row"><button type="button" className="subtle-button" disabled={busy} onClick={() => setRemoving('')}>取消</button><button type="button" className="primary-button" disabled={busy} onClick={() => void remove()}>{busy ? '正在移除…' : '确认移除'}</button></div></Modal>}
  </SettingsSection>;
}
