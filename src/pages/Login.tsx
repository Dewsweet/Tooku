import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { MusicApi, normalizeServer, testServerConnection } from '../api/client';
import { useSession, errorMessage } from '../state/session';
import { player } from '../features/player/engine';
import { connectUserSync, disconnectUserSync, useUserSync } from '../storage/userSync';
import { TookuMark } from '../components/TookuMark';
import { enterWorkspace } from '../features/session/enterWorkspace';
import './login.css';

type ConnectionState = { status: 'checking' } | { status: 'success'; latencyMs: number } | { status: 'error'; message: string };

export function Login() {
  const [server, setServer] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const connectionRequest = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const notice = useSession((s) => s.notice);
  useEffect(() => () => { connectionRequest.current?.abort(); connectionRequest.current = null; }, []);
  function changeServer(value: string) {
    connectionRequest.current?.abort(); connectionRequest.current = null;
    setConnection(null); setError(''); setServer(value);
  }
  async function checkConnection() {
    if (inFlight.current || connectionRequest.current || !server.trim()) return;
    const controller = new AbortController(); connectionRequest.current = controller;
    setConnection({ status: 'checking' });
    try {
      const result = await testServerConnection(server, controller.signal);
      if (connectionRequest.current === controller && !controller.signal.aborted) setConnection({ status: 'success', ...result });
    } catch (error) {
      if (connectionRequest.current === controller && !controller.signal.aborted) setConnection({ status: 'error', message: errorMessage(error) });
    } finally {
      if (connectionRequest.current === controller) connectionRequest.current = null;
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current || connectionRequest.current) return;
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
        <form onSubmit={submit} aria-busy={pending || connection?.status === 'checking'}>
          <div className="login-server-field">
            <div className="login-field-heading"><label htmlFor="login-server">服务器地址</label><button type="button" className="login-connection-button" disabled={pending || !server.trim()} aria-disabled={connection?.status === 'checking' || undefined} aria-busy={connection?.status === 'checking' || undefined} onClick={() => void checkConnection()}>{connection?.status === 'checking' ? <><LoaderCircle className="spin" size={14} />检测中…</> : '测试连接'}</button></div>
            <input id="login-server" value={server} onChange={(e) => changeServer(e.target.value)} required disabled={pending} autoComplete="url" spellCheck={false} autoCapitalize="none" inputMode="url" placeholder="https://music.example.com" aria-describedby={connection ? 'login-connection-result' : undefined} />
            <div id="login-connection-result" className="login-connection-result" role="status" aria-atomic="true" data-status={connection?.status}>{connection && <><span className="login-connection-light" aria-hidden="true" /><span>{connection.status === 'checking' ? '正在检测连接…' : connection.status === 'success' ? `服务可达 · ${connection.latencyMs} ms` : connection.message}</span></>}</div>
          </div>
          <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} required disabled={pending} autoComplete="username" spellCheck={false} autoCapitalize="none" /></label>
          <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={pending} autoComplete="current-password" /></label>
          {(error || notice) && <p className="form-error" role="alert">{error || notice}</p>}
          <button className="primary-button login-submit" disabled={pending || connection?.status === 'checking'}>{pending ? <><LoaderCircle className="spin" size={18} />正在连接…</> : <>进入音乐库<ArrowRight size={18} /></>}</button>
        </form>
      </section>
    </main>
  </div>;
}
