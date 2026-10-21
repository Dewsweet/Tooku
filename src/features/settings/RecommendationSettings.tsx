import { useEffect, useRef, useState } from 'react';
import { Select } from '../../components/Select';
import { useApi } from '../../components/Common';
import { recommendationsApi } from '../../api/recommendations';
import { defaultRecommendationSettings, emptyRecommendationCredentials, isRecommendationSettings, musicPlatforms, platformNames, type RecommendationCredentials, type RecommendationMode } from '../../domain/recommendations';
import { useRecommendationProfiles, useRecommendationSecrets } from '../../state/recommendations';
import { useSession } from '../../state/session';
import '../recommendations/recommendations.css';

export function RecommendationSettings() { const api = useApi(); return <SettingsView key={api.identity} />; }
function SettingsView() {
  const api = useApi(); const profile = useRecommendationProfiles((s) => s.profiles[api.identity]);
  const [draft, setDraft] = useState(profile?.settings ?? defaultRecommendationSettings);
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const secrets = useRecommendationSecrets(); const credentials = secrets.identity === api.identity ? secrets.credentials : emptyRecommendationCredentials;
  const request = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setDraft(profile?.settings ?? defaultRecommendationSettings); }, [profile?.settings]);
  useEffect(() => () => { request.current?.abort(); }, []);
  const edit = () => { dirty.current = true; request.current?.abort(); setMessage(''); setError(''); };
  const credential = (label: string, field: keyof RecommendationCredentials) => <label className="recommendation-field"><span>{label}</span><input type="password" autoComplete="off" spellCheck={false} maxLength={8192} value={credentials[field]} onChange={(event) => { edit(); useRecommendationSecrets.getState().update(api.identity, { [field]: event.target.value }); }} /></label>;
  async function check(target: 'lastfm' | 'ai' | 'apple' | 'spotify') {
    if (busy) return;
    if (!isRecommendationSettings(draft)) { setError('请检查服务地址、地区与推荐配置'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(target); setError(''); setMessage('');
    try { const result = await recommendationsApi.check(target, draft, credentials, controller.signal); if (!controller.signal.aborted) setMessage(`${({ lastfm: 'Last.fm', ai: 'AI 模型', apple: 'Apple Music', spotify: 'Spotify' })[target]} · ${result}`); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '连接未完成'); }
    finally { if (request.current === controller) setBusy(''); }
  }
  const detect = (target: 'lastfm' | 'ai' | 'apple' | 'spotify', label: string) => <button type="button" className="subtle-button" disabled={Boolean(busy)} onClick={() => { void check(target); }}>{busy === target ? '检测中…' : `检测 ${label}`}</button>;
  return <section className="settings-section recommendation-settings"><h2>音乐推荐</h2>
    <p className="settings-note">生成时向配置的服务发送歌名、歌手、专辑与偏好摘要。密钥仅在本次会话有效，刷新或退出后需重新填写。</p>
    <form onSubmit={(event) => { event.preventDefault(); edit(); if (!isRecommendationSettings(draft)) { setError('请使用不含凭据、查询参数的 HTTPS 模型地址，并检查地区配置'); return; } dirty.current = false; try { useRecommendationProfiles.getState().update(api.identity, (current) => ({ ...current, settings: draft })); useSession.getState().notify('推荐设置已保存'); } catch { setError('本机设置未能保存，本次会话仍可使用；请在用户数据中核实同步或导出备份'); } }}>
      <div className="recommendation-settings-grid">
        <label className="recommendation-field"><span>推荐模式</span><Select aria-label="推荐模式" value={draft.mode} onChange={(mode) => { edit(); setDraft({ ...draft, mode: mode as RecommendationMode }); }}><option value="hybrid">混合推荐</option><option value="algorithm">算法推荐</option><option value="ai">AI 推荐</option></Select></label>
        <label className="recommendation-field"><span>收听样本</span><Select aria-label="收听样本" value={String(draft.sampleSize)} onChange={(value) => { edit(); setDraft({ ...draft, sampleSize: Number(value) }); }}><option value="30">最近 30 首</option><option value="40">最近 40 首</option><option value="50">最近 50 首</option></Select></label>
        <label className="recommendation-field"><span>探索新歌手</span><Select aria-label="探索新歌手" value={String(draft.exploration)} onChange={(value) => { edit(); setDraft({ ...draft, exploration: Number(value) }); }}><option value="0.1">少量 · 10%</option><option value="0.3">均衡 · 30%</option><option value="0.5">更多 · 50%</option></Select></label>
      </div>
      <fieldset className="recommendation-platforms"><legend>显示平台</legend>{musicPlatforms.map((platform) => <label key={platform}><input type="checkbox" checked={draft.platforms.includes(platform)} disabled={draft.platforms.length === 1 && draft.platforms.includes(platform)} onChange={() => { edit(); setDraft({ ...draft, platforms: draft.platforms.includes(platform) ? draft.platforms.filter((id) => id !== platform) : musicPlatforms.filter((id) => id === platform || draft.platforms.includes(id)) }); }} />{platformNames[platform]}</label>)}</fieldset>
      <div className="recommendation-service"><div className="recommendation-service-heading"><h3>相似歌曲 · Last.fm</h3>{detect('lastfm', 'Last.fm')}</div>{credential('Last.fm API Key', 'lastfmKey')}</div>
      <div className="recommendation-service"><div className="recommendation-service-heading"><h3>AI 模型</h3>{detect('ai', 'AI 模型')}</div>
        <div className="recommendation-settings-grid"><label className="recommendation-field"><span>模型服务地址</span><input type="url" autoComplete="off" placeholder="https://api.example.com/v1" maxLength={512} value={draft.aiBaseUrl} onChange={(event) => { edit(); setDraft({ ...draft, aiBaseUrl: event.target.value.trim() }); }} /></label><label className="recommendation-field"><span>模型名称</span><input autoComplete="off" maxLength={120} value={draft.model} onChange={(event) => { edit(); setDraft({ ...draft, model: event.target.value }); }} /></label></div>
        {credential('模型 API Key', 'aiKey')}<p className="settings-note">支持兼容 Chat Completions 的公网 HTTPS 接口，可填写服务基址或完整接口地址。</p>
      </div>
      <div className="recommendation-service"><div className="recommendation-service-heading"><h3>Apple Music · 可选</h3>{detect('apple', 'Apple Music')}</div>{credential('Apple Music Developer Token', 'appleToken')}
        <label className="recommendation-field"><span>商店地区</span><input autoComplete="off" maxLength={2} placeholder="cn" value={draft.appleStorefront} onChange={(event) => { edit(); setDraft({ ...draft, appleStorefront: event.target.value.toLowerCase() }); }} /></label>
      </div>
      <div className="recommendation-service"><div className="recommendation-service-heading"><h3>Spotify · 可选</h3>{detect('spotify', 'Spotify')}</div>
        <div className="recommendation-settings-grid">{credential('Spotify Client ID', 'spotifyClientId')}{credential('Spotify Client Secret', 'spotifyClientSecret')}</div>
        <label className="recommendation-field"><span>市场地区</span><input autoComplete="off" maxLength={2} placeholder="US" value={draft.spotifyMarket} onChange={(event) => { edit(); setDraft({ ...draft, spotifyMarket: event.target.value.toUpperCase() }); }} /></label>
      </div>
      <p className="settings-note">Apple Music、Spotify 未配置或无法核实版本时，提供平台搜索入口。地区代码如 cn / us，Spotify 使用大写。</p>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button type="submit" className="primary-button" disabled={Boolean(busy)}>保存推荐设置</button>
    </form>
  </section>;
}
