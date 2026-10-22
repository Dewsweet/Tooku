import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Select } from '../../components/Select';
import { useApi } from '../../components/Common';
import { recommendationsApi } from '../../api/recommendations';
import { defaultRecommendationSettings, emptyRecommendationCredentials, isRecommendationSettings, musicPlatforms, platformNames, recommendationCount, type RecommendationCredentials, type RecommendationMode } from '../../domain/recommendations';
import { useRecommendationProfiles, useRecommendationSecrets } from '../../state/recommendations';
import { useSession } from '../../state/session';
import { SettingsSection } from './SettingsSection';

export function RecommendationSettings() { const api = useApi(); return <SettingsView key={api.identity} />; }
type CheckTarget = 'lastfm' | 'ai' | 'apple' | 'spotify';
type CheckResult = { phase: 'checking' | 'success' | 'error'; message: string };
const checkNames: Record<CheckTarget, string> = { lastfm: 'Last.fm', ai: 'AI 模型', apple: 'Apple Music', spotify: 'Spotify' };
const credentialTargets: Record<keyof RecommendationCredentials, CheckTarget> = { lastfmKey: 'lastfm', aiKey: 'ai', appleToken: 'apple', spotifyClientId: 'spotify', spotifyClientSecret: 'spotify' };
const regions = [
  { code: 'cn', name: '中国大陆' }, { code: 'hk', name: '中国香港' }, { code: 'tw', name: '中国台湾' },
  { code: 'jp', name: '日本' }, { code: 'kr', name: '韩国' }, { code: 'us', name: '美国' },
  { code: 'gb', name: '英国' }, { code: 'ca', name: '加拿大' }, { code: 'au', name: '澳大利亚' },
  { code: 'sg', name: '新加坡' }, { code: 'de', name: '德国' }, { code: 'fr', name: '法国' },
  { code: 'in', name: '印度' }, { code: 'br', name: '巴西' },
];
function SettingsView() {
  const api = useApi(); const profile = useRecommendationProfiles((s) => s.profiles[api.identity]);
  const [draft, setDraft] = useState(profile?.settings ?? defaultRecommendationSettings);
  const [checks, setChecks] = useState<Partial<Record<CheckTarget, CheckResult>>>({}); const [error, setError] = useState('');
  const secrets = useRecommendationSecrets(); const credentials = secrets.identity === api.identity ? secrets.credentials : emptyRecommendationCredentials;
  const requests = useRef<Partial<Record<CheckTarget, AbortController>>>({});
  const dirty = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  useEffect(() => {
    const restored = profile?.settings ?? defaultRecommendationSettings;
    if (!dirty.current && JSON.stringify(restored) !== JSON.stringify(draftRef.current)) {
      Object.values(requests.current).forEach((request) => request.abort()); requests.current = {};
      setChecks({}); setDraft(restored);
    }
  }, [profile?.settings]);
  useEffect(() => () => { Object.values(requests.current).forEach((request) => request.abort()); }, []);
  const edit = (target?: CheckTarget) => {
    dirty.current = true; setError('');
    if (target) { requests.current[target]?.abort(); delete requests.current[target]; setChecks((current) => ({ ...current, [target]: undefined })); }
  };
  const credential = (label: string, field: keyof RecommendationCredentials) => <label className="recommendation-field"><span>{label}</span><input type="password" autoComplete="off" spellCheck={false} maxLength={8192} value={credentials[field]} onChange={(event) => { edit(credentialTargets[field]); useRecommendationSecrets.getState().update(api.identity, { [field]: event.target.value }); }} /></label>;
  function missingConfiguration(target: CheckTarget) {
    if (target === 'lastfm') return credentials.lastfmKey.trim() ? '' : '请先填写 Last.fm API Key（不是 Shared secret）';
    if (target === 'ai') {
      const missing = [!draft.aiBaseUrl.trim() && '模型服务地址', !draft.model.trim() && '模型名称', !credentials.aiKey.trim() && 'API Key'].filter(Boolean);
      if (missing.length) return `请先填写${missing.join('、')}`;
      if (!isRecommendationSettings({ ...defaultRecommendationSettings, aiBaseUrl: draft.aiBaseUrl, model: draft.model })) return '请使用不含凭据或查询参数的 HTTPS 模型地址';
    }
    if (target === 'apple') {
      if (!credentials.appleToken.trim()) return '请先填写 Apple Music Developer Token';
      if (!/^[a-z]{2}$/.test(draft.appleStorefront)) return '商店地区需填写两位小写字母，如 cn';
    }
    if (target === 'spotify') {
      if (!credentials.spotifyClientId.trim() || !credentials.spotifyClientSecret.trim()) return '请先填写 Spotify Client ID 和 Client Secret';
      if (!/^[A-Z]{2}$/.test(draft.spotifyMarket)) return '市场地区需填写两位大写字母，如 US';
    }
    return '';
  }
  async function check(target: CheckTarget) {
    if (requests.current[target]) return;
    const missing = missingConfiguration(target);
    if (missing) { setChecks((current) => ({ ...current, [target]: { phase: 'error', message: missing } })); return; }
    const controller = new AbortController(); requests.current[target] = controller;
    setChecks((current) => ({ ...current, [target]: { phase: 'checking', message: '正在检测，请稍候…' } }));
    try {
      const result = await recommendationsApi.check(target, draft, credentials, controller.signal);
      if (!controller.signal.aborted && requests.current[target] === controller) setChecks((current) => ({ ...current, [target]: { phase: 'success', message: `${checkNames[target]} · ${result}` } }));
    } catch (e) {
      if (!controller.signal.aborted && requests.current[target] === controller) setChecks((current) => ({ ...current, [target]: { phase: 'error', message: e instanceof Error ? e.message : '连接未完成，请重试' } }));
    } finally { if (requests.current[target] === controller) delete requests.current[target]; }
  }
  const detect = (target: CheckTarget, label: string) => {
    const result = checks[target]; const checking = result?.phase === 'checking'; const statusId = `recommendation-check-${target}`;
    return <div className="recommendation-check" role="group" aria-label={`${label} 连接检测`}>
      <button type="button" className="subtle-button" aria-label={`检测 ${label}`} aria-describedby={statusId} aria-busy={checking} disabled={checking} onClick={() => { void check(target); }}>{checking && <LoaderCircle size={16} className="spin" />}{checking ? '检测中…' : `检测 ${label}`}</button>
      <p id={statusId} className="recommendation-check-result" data-state={result?.phase ?? 'idle'} role={result?.phase === 'error' ? 'alert' : 'status'}>{result?.message ?? '未检测'}</p>
    </div>;
  };
  const regionOptions = (value: string, spotify = false) => {
    const options = regions.filter((region) => !spotify || region.code !== 'cn').map((region) => ({ value: spotify ? region.code.toUpperCase() : region.code, name: region.name }));
    // Preserve older valid region codes that are outside this compact list.
    const available = options.some((option) => option.value === value) ? options : [{ value, name: '当前地区' }, ...options];
    return available.map((option) => <option key={option.value} value={option.value}>{option.name} · {option.value.toUpperCase()}</option>);
  };
  const summary = (target: CheckTarget, label: string, optional = false) => {
    const phase = checks[target]?.phase ?? 'idle';
    const status = { idle: '未检测', checking: '检测中', success: '可用', error: '检测失败' }[phase];
    return <summary data-state={phase}>{label}{optional && <span className="recommendation-optional-label">可选</span>}<span className="status-light" role="img" aria-label={`${label}：${status}`} /></summary>;
  };
  const checking = Object.values(checks).some((result) => result?.phase === 'checking');
  return <SettingsSection title="音乐推荐" className="recommendation-settings">
    <p className="settings-notice">生成时向所选服务发送近期收听和已推荐歌曲的歌名、歌手，以及专辑与偏好摘要。密钥仅本次会话有效，刷新或退出后需重新填写。</p>
    <form onSubmit={(event) => { event.preventDefault(); edit(); if (!isRecommendationSettings(draft)) { setError('请使用不含凭据、查询参数的 HTTPS 模型地址，并检查地区配置'); return; } dirty.current = false; try { useRecommendationProfiles.getState().update(api.identity, (current) => ({ ...current, settings: draft })); useSession.getState().notify('推荐设置已保存'); } catch { setError('本机设置未能保存，本次会话仍可使用；请在用户数据中核实同步或导出备份'); } }}>
      <div className="settings-subsection recommendation-preferences"><h3>推荐偏好</h3><div className="recommendation-settings-grid">
        <label className="recommendation-field"><span>推荐模式</span><Select aria-label="推荐模式" value={draft.mode} onChange={(mode) => { edit(); setDraft({ ...draft, mode: mode as RecommendationMode }); }}><option value="hybrid">混合推荐</option><option value="algorithm">Last.fm 推荐</option><option value="ai">AI 推荐</option></Select></label>
        <label className="recommendation-field"><span>收听样本</span><Select aria-label="收听样本" value={String(draft.sampleSize)} onChange={(value) => { edit(); setDraft({ ...draft, sampleSize: Number(value) }); }}><option value="30">最近 30 首</option><option value="40">最近 40 首</option><option value="50">最近 50 首</option></Select></label>
        <label className="recommendation-field"><span>推荐数量</span><Select aria-label="推荐数量" value={String(recommendationCount(draft))} onChange={(value) => { edit(); setDraft({ ...draft, resultCount: Number(value) }); }}><option value="10">10 首</option><option value="20">20 首</option><option value="30">30 首</option></Select></label>
        <label className="recommendation-field"><span>新歌手目标占比</span><Select aria-label="新歌手目标占比" aria-describedby="recommendation-exploration-help" value={String(draft.exploration)} onChange={(value) => { edit(); setDraft({ ...draft, exploration: Number(value) }); }}><option value="0">不设目标</option><option value="0.1">10%</option><option value="0.3">30%</option><option value="0.5">50%</option><option value="0.7">70%</option><option value="1">100%</option></Select></label>
      </div>
      <p className="settings-note" id="recommendation-exploration-help">优先安排未出现在本次收听样本中的歌手，实际占比取决于可用候选。</p>
      <fieldset className="recommendation-platforms"><legend>显示平台</legend>{musicPlatforms.map((platform) => <label key={platform}><input type="checkbox" checked={draft.platforms.includes(platform)} disabled={draft.platforms.length === 1 && draft.platforms.includes(platform)} onChange={() => { edit(); setDraft({ ...draft, platforms: draft.platforms.includes(platform) ? draft.platforms.filter((id) => id !== platform) : musicPlatforms.filter((id) => id === platform || draft.platforms.includes(id)) }); }} />{platformNames[platform]}</label>)}</fieldset></div>
      <details open className="recommendation-service recommendation-connection">{summary('lastfm', 'Last.fm')}<div className="recommendation-service-heading">{detect('lastfm', 'Last.fm')}</div>{credential('Last.fm API Key', 'lastfmKey')}</details>
      <details open className="recommendation-service recommendation-connection">{summary('ai', 'AI 模型')}<div className="recommendation-service-heading">{detect('ai', 'AI 模型')}</div>
        <div className="recommendation-settings-grid"><label className="recommendation-field"><span>模型服务地址</span><input type="url" autoComplete="off" placeholder="https://api.example.com/v1" maxLength={512} value={draft.aiBaseUrl} onChange={(event) => { edit('ai'); setDraft({ ...draft, aiBaseUrl: event.target.value.trim() }); }} /></label><label className="recommendation-field"><span>模型名称</span><input autoComplete="off" maxLength={120} value={draft.model} onChange={(event) => { edit('ai'); setDraft({ ...draft, model: event.target.value }); }} /></label></div>
        {credential('模型 API Key', 'aiKey')}<p className="settings-note">填写兼容 Chat Completions 的 HTTPS 地址（通常以 /v1 结尾）、模型名称和 API Key。</p>
      </details>
      <details className="recommendation-service recommendation-connection">{summary('apple', 'Apple Music', true)}<div className="recommendation-service-heading">{detect('apple', 'Apple Music')}</div>{credential('Apple Music Developer Token', 'appleToken')}
        <label className="recommendation-field recommendation-region"><span>商店地区</span><Select aria-label="商店地区" value={draft.appleStorefront} onChange={(value) => { edit('apple'); setDraft({ ...draft, appleStorefront: value }); }}>{regionOptions(draft.appleStorefront)}</Select></label>
      </details>
      <details className="recommendation-service recommendation-connection">{summary('spotify', 'Spotify', true)}<div className="recommendation-service-heading">{detect('spotify', 'Spotify')}</div>
        <div className="recommendation-settings-grid">{credential('Spotify Client ID', 'spotifyClientId')}{credential('Spotify Client Secret', 'spotifyClientSecret')}</div>
        <label className="recommendation-field recommendation-region"><span>市场地区</span><Select aria-label="市场地区" value={draft.spotifyMarket} onChange={(value) => { edit('spotify'); setDraft({ ...draft, spotifyMarket: value }); }}>{regionOptions(draft.spotifyMarket, true)}</Select></label>
      </details>
      <p className="settings-note">可选平台未配置时，仍可使用平台搜索入口。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="settings-form-actions"><button type="submit" className="primary-button" disabled={checking}>保存推荐设置</button></div>
    </form>
  </SettingsSection>;
}
