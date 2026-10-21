import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Clock3, ExternalLink } from 'lucide-react';
import { formatTime, useApi } from '../../components/Common';
import { useContextMenu, type MenuItem } from '../../components/Interactions';
import { recommendationsApi } from '../../api/recommendations';
import { emptyRecommendationCredentials, platformNames, platformSearchLink, type RecommendationSettings, type RecommendationSong, type ResolvedSong } from '../../domain/recommendations';
import { useRecommendationSecrets } from '../../state/recommendations';

export function RecommendationSongTable({ songs, settings, label = '推荐歌曲' }: { songs: RecommendationSong[]; settings: RecommendationSettings; label?: string }) {
  const api = useApi(); const secrets = useRecommendationSecrets();
  // Remount ephemeral row data on account/credential/platform changes, without touching playback.
  return <SongTableView key={JSON.stringify([api.identity, secrets.revision, settings.platforms, settings.appleStorefront, settings.spotifyMarket])} songs={songs} settings={settings} label={label} />;
}
function SongTableView({ songs, settings, label }: { songs: RecommendationSong[]; settings: RecommendationSettings; label: string }) {
  const api = useApi(); const client = useQueryClient(); const menu = useContextMenu(); const secrets = useRecommendationSecrets();
  const credentials = secrets.identity === api.identity ? secrets.credentials : emptyRecommendationCredentials;
  const [resolved, setResolved] = useState<Record<string, ResolvedSong>>({}); const requests = useRef(new Set<AbortController>());
  useEffect(() => { const active = requests.current; return () => { active.forEach((request) => request.abort()); }; }, []);
  const key = (song: RecommendationSong) => [api.identity, 'recommendation-song-links-v3', song.id, song.album, song.durationMs, settings.platforms, settings.appleStorefront, settings.spotifyMarket, secrets.revision];
  const items = (song: RecommendationSong, result?: ResolvedSong, pending = false): MenuItem[] => [
    ...settings.platforms.map((platform) => {
      const link = result?.links.find((entry) => entry.platform === platform);
      return { label: `${platformNames[platform]}${link?.kind === 'direct' ? '' : ' · 搜索'}`, href: link?.url ?? platformSearchLink(platform, song, settings), icon: <ExternalLink size={16} />, action: () => {} };
    }),
    ...(pending ? [{ label: '正在核实歌曲链接…', disabled: true, action: () => {} }] : []),
  ];
  async function open(event: MouseEvent<HTMLElement>, song: RecommendationSong) {
    const button = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : event.currentTarget.querySelector('button'); button?.focus();
    const state = client.getQueryState<ResolvedSong>(key(song)); const cached = state && Date.now() - state.dataUpdatedAt < 300000 ? state.data : undefined;
    const handle = menu(event, items(song, cached, !cached));
    if (cached) { setResolved((current) => ({ ...current, [song.id]: cached })); return; }
    const controller = new AbortController(); requests.current.add(controller);
    try {
      const result = await client.fetchQuery({ queryKey: key(song), staleTime: 300000, gcTime: 300000, retry: false, queryFn: async ({ signal }) => (await recommendationsApi.links([song], settings, credentials, AbortSignal.any([signal, controller.signal])))[0] });
      if (controller.signal.aborted) return;
      setResolved((current) => ({ ...current, [song.id]: result })); handle.update(items(song, result));
    } catch { if (!controller.signal.aborted) handle.update(items(song)); }
    finally { requests.current.delete(controller); }
  }
  return <div className="recommendation-table-wrap"><table className="recommendation-table" aria-label={label}><thead><tr><th className="recommendation-position">#</th><th>标题</th><th className="recommendation-album-column">专辑</th><th className="recommendation-date-column">发行日期</th><th className="recommendation-time-column"><Clock3 size={16} aria-label="时长" /></th></tr></thead><tbody>{songs.map((song, index) => {
    const detail = resolved[song.id] ?? client.getQueryData<ResolvedSong>(key(song)); const duration = detail?.durationMs ?? song.durationMs; const date = detail?.releaseDate ?? song.releaseDate;
    return <tr key={song.id} onClick={(event) => { void open(event, song); }} onContextMenu={(event) => { void open(event, song); }}><td className="recommendation-position">{index + 1}</td><td><button className="recommendation-song-trigger" aria-label={`选择收听平台：${song.title}`} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); void open(event, song); }}><strong>{song.title}</strong><span>{song.artists.join(' / ')}</span></button></td><td className="recommendation-album-column">{detail?.album || song.album || '—'}</td><td className="recommendation-date-column">{date ? <time dateTime={date}>{date}</time> : '—'}</td><td className="recommendation-time-column">{duration ? formatTime(duration / 1000) : '—'}</td></tr>;
  })}</tbody></table></div>;
}
