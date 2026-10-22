import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { MusicApi, normalizeServer } from '../api/client';
import { useSession, errorMessage } from '../state/session';
import { player } from '../features/player/engine';
import { connectUserSync, disconnectUserSync, useUserSync } from '../storage/userSync';
import { TookuMark } from '../components/TookuMark';
import { enterWorkspace } from '../features/session/enterWorkspace';
import './login.css';

export function Login() {
  const [server, setServer] = useState(() => window.location.origin); const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const inFlight = useRef(false);
  const notice = useSession((s) => s.notice);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(''); let api: MusicApi | undefined;
    try {
      const connected = new MusicApi(normalizeServer(server), username.trim(), password);
      api = connected;
      const version = await connected.connect(password); setPassword(''); await connectUserSync(connected); await player.attach(connected);
      await enterWorkspace(() => {
        useSession.getState().setSession(connected, version);
        const sync = useUserSync.getState(); useSession.getState().notify(['review', 'offline'].includes(sync.status) ? `${sync.message} 入口：头像 → 账户与设置 → 用户数据。` : '');
      });
    } catch (error) { disconnectUserSync(); api?.dispose(); setError(errorMessage(error)); } finally { inFlight.current = false; setPending(false); }
  }
  return <div className="login-page">
    <header className="login-header">
      <a className="login-brand" href="/" aria-label="Tooku 主页"><TookuMark /><span>Tooku</span></a>
    </header>
    <main className="login-main">
      <div className="login-copy">
        <div className="login-art" aria-hidden="true"><TookuMark /></div>
        <h1>让音乐，<br />陪你去远方。</h1>
        <p className="login-description">Navidrome 第三方音乐播放器</p>
      </div>
      <section className="login-card" aria-labelledby="login-heading">
        <h2 id="login-heading">登录音乐库</h2>
        <form onSubmit={submit} aria-busy={pending}>
          <label>服务器地址<input value={server} onChange={(e) => setServer(e.target.value)} required disabled={pending} autoComplete="url" spellCheck={false} autoCapitalize="none" inputMode="url" placeholder="https://music.example.com" /></label>
          <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} required disabled={pending} autoComplete="username" spellCheck={false} autoCapitalize="none" /></label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={pending} autoComplete="current-password" /></label>
          {(error || notice) && <p className="form-error" role="alert">{error || notice}</p>}
          <button className="primary-button login-submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" size={18} />正在连接…</> : <>进入音乐库<ArrowRight size={18} /></>}</button>
        </form>
      </section>
    </main>
  </div>;
}
