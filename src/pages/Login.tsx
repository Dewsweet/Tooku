import { useState, type FormEvent } from 'react';
import { ArrowRight, Music2, LoaderCircle, Check, Server } from 'lucide-react';
import { MusicApi, normalizeServer } from '../api/client';
import { useSession, errorMessage } from '../state/session';
import { player } from '../features/player/engine';
import { connectUserSync, disconnectUserSync, useUserSync } from '../storage/userSync';

export function Login() {
  const [server, setServer] = useState('/nd'); const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const notice = useSession((s) => s.notice);
  async function submit(e: FormEvent) {
    e.preventDefault(); setPending(true); setError(''); let api: MusicApi | undefined;
    try {
      api = new MusicApi(normalizeServer(server), username.trim(), password);
      const version = await api.connect(password); setPassword(''); await connectUserSync(api); await player.attach(api);
      useSession.getState().setSession(api, version);
      const sync = useUserSync.getState(); useSession.getState().notify(['review', 'offline'].includes(sync.status) ? `${sync.message} 入口：头像 → 账户与设置 → 用户数据。` : '');
    } catch (error) { disconnectUserSync(); api?.dispose(); setError(errorMessage(error)); } finally { setPending(false); }
  }
  return <div className="login-page"><header className="login-header"><a className="brand" href="/"><span className="brand-icon"><Music2 size={22} /></span>Tooku<span className="brand-caption">音乐</span></a><span className="login-nav">你的音乐，始终属于你</span></header>
    <main className="login-main"><div className="login-copy"><div className="eyebrow">为你的私人音乐库而生</div><h1>简单一点。<br />听你喜欢的。</h1><p>把珍藏的专辑、熟悉的旋律和下一首期待，<br className="desktop-only" />放进一个安静、舒服的播放器。</p><div className="feature-pills"><span><Check size={15} />自己的音乐库</span><span><Check size={15} />清晰的播放队列</span><span><Check size={15} />中文歌词体验</span></div>
      <div className="record-illustration" aria-hidden="true"><div className="record-sleeve"><span>TOOKU<br /><b>YOUR<br />COLLECTION.</b><small>Music, on your terms.</small></span></div><div className="vinyl"><div className="vinyl-label"><Music2 size={30} /></div></div></div>
    </div><section className="login-card"><span className="login-symbol"><Server size={25} /></span><h2>连接你的音乐库</h2><p className="muted">使用 Navidrome 账号，开始听歌。</p><form onSubmit={submit}>
      <label>服务器地址<input value={server} onChange={(e) => setServer(e.target.value)} required autoComplete="url" spellCheck={false} placeholder="http://127.0.0.1:44533" /></label>
      <p className="field-hint">/nd 使用此网页的代理连接本机 44533，也可填写完整服务地址。</p>
      <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" /></label>
      <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
      {(error || notice) && <p className="form-error" role="alert">{error || notice}</p>}
      <button className="primary-button login-submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={18} />正在连接…</> : <>进入音乐库<ArrowRight size={18} /></>}</button>
    </form><div className="privacy-note">凭据仅保留在本次会话。刷新后需重新登录，已保存的队列暂停恢复。</div></section></main>
    <footer className="login-footer"><span>Tooku · 属于你的音乐</span><span>独立 Navidrome 网页播放器</span></footer>
  </div>;
}
