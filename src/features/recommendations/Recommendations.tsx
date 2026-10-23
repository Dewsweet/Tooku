import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import { Empty, useApi } from '../../components/Common';
import { Select } from '../../components/Select';
import { recommendationsApi } from '../../api/recommendations';
import { defaultRecommendationSettings, emptyRecommendationCredentials, listeningSeeds, recommendationCount, recommendationContext, rememberRecommendationBatch } from '../../domain/recommendations';
import { useRecommendationProfiles, useRecommendationSecrets } from '../../state/recommendations';
import { useSession } from '../../state/session';
import { usePlayer } from '../player/engine';
import { RecommendationSongTable } from './RecommendationSongs';
import './recommendations.css';

export function Recommendations() { const api = useApi(); return <RecommendationsView key={api.identity} />; }
function RecommendationsView() {
  const api = useApi();
  const profile = useRecommendationProfiles((s) => s.profiles[api.identity]); const settings = profile?.settings ?? defaultRecommendationSettings; const batch = profile?.batch;
  const history = usePlayer((s) => s.history); const seeds = listeningSeeds(history, settings.sampleSize);
  const secrets = useRecommendationSecrets(); const credentials = secrets.identity === api.identity ? secrets.credentials : emptyRecommendationCredentials;
  const has = (field: keyof typeof credentials) => Boolean(credentials[field].trim() || secrets.identity === api.identity && secrets.saved[field]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [showSources, setShowSources] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, [api, settings]);
  async function generate() {
    if (request.current && !request.current.signal.aborted && busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const excluded = [...new Set([...(profile?.seenIds ?? []), ...(batch?.songs.map((song) => song.id) ?? [])])].slice(-300);
      const recentSongs = recommendationContext(profile);
      const result = await recommendationsApi.generate(seeds, settings, credentials, excluded, controller.signal, recentSongs);
      if (controller.signal.aborted || useSession.getState().api !== api) return;
      if (!result.songs.length && batch?.songs.length) { setError('暂未找到更多合适的新歌曲，已保留当前推荐'); return; }
      try { useRecommendationProfiles.getState().update(api.identity, (current) => rememberRecommendationBatch(current, result)); }
      catch { setError('推荐结果暂未保存到本机，本次会话仍可查看；请核实用户数据同步或导出备份'); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '推荐未完成'); }
    finally { if (request.current === controller) setBusy(false); }
  }
  function changeCount(value: string) {
    setError('');
    try { useRecommendationProfiles.getState().update(api.identity, (current) => ({ ...current, settings: { ...current.settings, resultCount: Number(value) } })); }
    catch { setError('推荐数量暂未保存到本机，请核实用户数据同步或导出备份'); }
  }
  const ready = settings.mode === 'algorithm' ? Boolean(has('lastfmKey')) : settings.mode === 'ai' ? Boolean(settings.aiBaseUrl && settings.model.trim() && has('aiKey')) : Boolean(has('lastfmKey') || settings.aiBaseUrl && settings.model.trim() && has('aiKey'));
  return <div className="recommendations-page">
    <header className="recommendation-page-heading"><div><h1>为你推荐</h1><p>{batch ? `${batch.songs.length} 首 · ${({ algorithm: 'Last.fm 推荐', ai: 'AI 推荐', hybrid: '混合推荐' })[batch.mode]} · ${new Date(batch.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}更新` : `最近 ${seeds.length} 首收听，发现新的喜欢`}</p></div>
      <div className="recommendation-actions">{!!seeds.length && <button className="text-button" aria-expanded={showSources} aria-controls="recommendation-listening-sources" onClick={() => setShowSources(!showSources)}>收听参考 · {seeds.length} 首</button>}<Select aria-label="推荐数量" value={String(recommendationCount(settings))} disabled={busy} onChange={changeCount}><option value="10">10 首</option><option value="20">20 首</option><option value="30">30 首</option></Select>
        <button className="primary-button" disabled={busy || !seeds.length || !ready} onClick={() => { void generate(); }}>{busy ? <LoaderCircle size={17} className="spin" /> : batch?.songs.length ? <RefreshCw size={17} /> : <Sparkles size={17} />}{busy ? '正在推荐…' : batch?.songs.length ? '换一批' : '生成推荐'}</button></div>
    </header>
    {!ready && <p className="recommendation-status" role="status">请从头像进入账户与设置，配置音乐推荐服务。</p>}
    {showSources && <div className="recommendation-sources" id="recommendation-listening-sources"><p>以下是本次生成将使用的收听记录{batch ? `；上次提交了 ${batch.sampleCount} 首` : ''}。</p><ul>{seeds.map((seed) => <li key={JSON.stringify([seed.title, seed.artists])}><strong>{seed.title}</strong><span>{seed.artists.join(' / ')}</span></li>)}</ul></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {busy && <p className="recommendation-status" role="status">正在挑选并核实音乐，略过的候选会继续补充，请稍候…</p>}
    {!!batch?.notices.length && <div className="recommendation-notices">{batch.notices.map((notice) => <p className="recommendation-status" key={notice}>{notice}</p>)}</div>}
    {batch?.songs.length ? <RecommendationSongTable key={batch.id} songs={batch.songs} settings={settings} /> : <Empty title={busy ? '正在寻找适合你的音乐' : '暂无推荐'}>从最近在听推荐新歌</Empty>}
  </div>;
}
