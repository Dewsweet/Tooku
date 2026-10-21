import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, LoaderCircle, Music2, Play, RefreshCw, Sparkles } from 'lucide-react';
import { Empty, PageTitle, useApi } from '../../components/Common';
import { recommendationsApi } from '../../api/recommendations';
import { defaultRecommendationSettings, emptyRecommendationCredentials, listeningSeeds, platformNames, platformSearchLink, type RecommendationSong } from '../../domain/recommendations';
import { canUseLyricCandidate, rankCandidates } from '../../domain/lyrics/matching';
import { useRecommendationProfiles, useRecommendationSecrets } from '../../state/recommendations';
import { useMusicLibrary } from '../../state/library';
import { useSession } from '../../state/session';
import { player, usePlayer } from '../player/engine';
import './recommendations.css';

export function Recommendations() { const api = useApi(); return <RecommendationsView key={api.identity} />; }
function RecommendationsView() {
  const api = useApi(); const client = useQueryClient(); const { libraryId } = useMusicLibrary();
  const profile = useRecommendationProfiles((s) => s.profiles[api.identity]); const settings = profile?.settings ?? defaultRecommendationSettings; const batch = profile?.batch;
  const history = usePlayer((s) => s.history); const seeds = listeningSeeds(history, settings.sampleSize);
  const secrets = useRecommendationSecrets(); const credentials = secrets.identity === api.identity ? secrets.credentials : emptyRecommendationCredentials;
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [finding, setFinding] = useState('');
  const request = useRef<AbortController | null>(null); const localRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, [api, settings]);
  useEffect(() => () => { localRequest.current?.abort(); }, [api, libraryId]);
  const links = useQuery({ queryKey: [api.identity, 'recommendation-links', batch?.id, settings.platforms, settings.appleStorefront, settings.spotifyMarket, secrets.revision], enabled: Boolean(batch?.songs.length), staleTime: 300000, gcTime: 300000, retry: false,
    queryFn: ({ signal }) => recommendationsApi.links(batch!.songs, settings, credentials, signal),
  });
  async function generate() {
    if (request.current && !request.current.signal.aborted && busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const result = await recommendationsApi.generate(seeds, settings, credentials, batch?.songs.map((song) => song.id) ?? [], controller.signal);
      if (controller.signal.aborted || useSession.getState().api !== api) return;
      if (!result.songs.length && batch?.songs.length) { setError('暂未找到更多合适的新歌曲，已保留当前推荐'); return; }
      try { useRecommendationProfiles.getState().update(api.identity, (current) => ({ ...current, batch: result })); }
      catch { setError('推荐结果暂未保存到本机，本次会话仍可查看；请核实用户数据同步或导出备份'); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '推荐未完成'); }
    finally { if (request.current === controller) setBusy(false); }
  }
  async function playLocal(song: RecommendationSong) {
    if (finding) return;
    const controller = new AbortController(); localRequest.current = controller; setFinding(song.id);
    try {
      const results = await client.fetchQuery({ queryKey: [api.identity, 'recommendation-local', libraryId, song.id], queryFn: ({ signal }) => api.search(song.title, 0, AbortSignal.any([signal, controller.signal]), libraryId) });
      if (controller.signal.aborted || useSession.getState().api !== api) return;
      const found = rankCandidates(song, results.songs.map((track) => ({ track, title: track.title, artists: track.artists?.map((artist) => artist.name) ?? [track.artist], album: track.album, durationMs: track.duration === undefined ? undefined : track.duration * 1000 }))).find((candidate) => canUseLyricCandidate(song, candidate));
      if (found) player.replace([found.track], 0, { source: { kind: 'collection', id: `recommendations-${batch?.id ?? 'local'}`, libraryId } });
      else useSession.getState().notify('本库未找到对应歌曲，可通过平台链接收听');
    } catch { if (!controller.signal.aborted) useSession.getState().notify('本库查询未完成，请稍后再试'); }
    finally { setFinding(''); }
  }
  const ready = settings.mode === 'algorithm' ? Boolean(credentials.lastfmKey) : settings.mode === 'ai' ? Boolean(settings.aiBaseUrl && settings.model && credentials.aiKey) : Boolean(credentials.lastfmKey || settings.aiBaseUrl && settings.model && credentials.aiKey);
  return <div className="recommendations-page"><PageTitle title="为你推荐"><button className="primary-button" disabled={busy || !seeds.length || !ready} onClick={() => { void generate(); }}>{busy ? <LoaderCircle size={17} className="spin" /> : batch?.songs.length ? <RefreshCw size={17} /> : <Sparkles size={17} />}{busy ? '正在推荐…' : batch?.songs.length ? '换一批' : '生成推荐'}</button></PageTitle>
    {!ready && <p className="recommendation-status" role="status">请从头像进入账户与设置，配置音乐推荐服务。密钥刷新后需重新填写。</p>}
    {(batch || seeds.length > 0) && <p className="recommendation-status">{batch ? `参考 ${batch.sampleCount} 首不同歌曲 · ${new Date(batch.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}生成` : `将参考最近 ${seeds.length} 首不同歌曲`}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {batch?.notices.map((notice) => <p className="recommendation-status" key={notice}>{notice}</p>)}
    {links.isFetching && <p className="recommendation-status" role="status">正在核实平台链接…</p>}
    {links.error && <p className="recommendation-status" role="status">平台链接暂未核实，仍可搜索歌曲。<button className="text-button" disabled={links.isFetching} onClick={() => { void links.refetch(); }}>重新核实</button></p>}
    {batch?.songs.length ? <div className="recommendation-list">{batch.songs.map((song, index) => {
      const resolved = links.data?.find((item) => item.id === song.id);
      return <article className="recommendation-card" key={song.id}>
        <div className="recommendation-art" aria-hidden="true"><Music2 size={26} />{resolved?.artwork && <img src={resolved.artwork} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}</div>
        <div className="recommendation-copy"><h2><span className="recommendation-number">{index + 1}</span>{song.title}</h2><p>{song.artists.join(' / ')}{song.album ? ` · ${song.album}` : ''}</p><p className="recommendation-reason">{song.reason}</p>
          <div className="recommendation-links">{settings.platforms.map((platform) => {
            const link = resolved?.links.find((item) => item.platform === platform); const direct = link?.kind === 'direct';
            return <a href={link?.url ?? platformSearchLink(platform, song, settings)} key={platform} target="_blank" rel="noreferrer" aria-label={`${direct ? '打开' : '搜索'}${platformNames[platform]}：${song.title}`}>{platformNames[platform]}{!direct && <span>搜索</span>}<ExternalLink size={12} /></a>;
          })}</div>
        </div><button className="subtle-button recommendation-local-play" disabled={Boolean(finding) || !libraryId} onClick={() => { void playLocal(song); }} aria-label={`在本库播放：${song.title}`}>{finding === song.id ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}<span>本库播放</span></button>
      </article>;
    })}</div> : <Empty title={!seeds.length ? '听些音乐，再来发现新歌' : busy ? '正在寻找适合你的音乐' : '下一首喜欢的歌，等你发现'}>{!seeds.length ? '达到收听阈值后，会使用最近的收听记录生成推荐。' : '配置服务后，点击生成推荐。'}</Empty>}
  </div>;
}
