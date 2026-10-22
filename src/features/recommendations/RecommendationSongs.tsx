import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { formatTime, useApi } from '../../components/Common';
import { useContextMenu, type MenuItem } from '../../components/Interactions';
import { recommendationsApi } from '../../api/recommendations';
import { emptyRecommendationCredentials, platformNames, platformSearchLink, type RecommendationSettings, type RecommendationSong, type ResolvedSong } from '../../domain/recommendations';
import { useRecommendationSecrets } from '../../state/recommendations';
import { normalizeTrackColumns, usePreferences } from '../../state/preferences';
import { TrackColumnHandle, columnVariables } from '../../components/TrackColumns';

export function RecommendationSongTable({ songs, settings, label = '推荐歌曲' }: { songs: RecommendationSong[]; settings: RecommendationSettings; label?: string }) {
  const api = useApi(); const secrets = useRecommendationSecrets();
  // Remount ephemeral row data on account/credential/platform changes, without touching playback.
  return <SongTableView key={JSON.stringify([api.identity, secrets.revision, settings.platforms, settings.appleStorefront, settings.spotifyMarket])} songs={songs} settings={settings} label={label} />;
}
function SongTableView({ songs, settings, label }: { songs: RecommendationSong[]; settings: RecommendationSettings; label: string }) {
  const api = useApi(); const menu = useContextMenu(); const secrets = useRecommendationSecrets();
  const columns = usePreferences((state) => state.trackColumns);
  const credentials = secrets.identity === api.identity ? secrets.credentials : emptyRecommendationCredentials;
  const [resolved, setResolved] = useState<Record<string, ResolvedSong>>({});
  const opened = useRef<{ id: string; update: (result?: ResolvedSong, pending?: boolean) => void } | null>(null);
  const links = useQuery({ queryKey: [api.identity, 'recommendation-batch-links-v4', songs.map(({ id, album, durationMs }) => [id, album, durationMs]), settings.platforms, settings.appleStorefront, settings.spotifyMarket, secrets.revision], staleTime: 300000, gcTime: 300000, retry: false,
    queryFn: ({ signal }) => recommendationsApi.links(songs, settings, credentials, signal, (group) => {
      if (signal.aborted) return;
      setResolved((current) => ({ ...current, ...Object.fromEntries(group.map((song) => [song.id, song])) }));
      const active = opened.current; const result = group.find((song) => song.id === active?.id);
      if (result) active?.update(result, false);
    }),
  });
  useEffect(() => {
    if (links.data) setResolved(Object.fromEntries(links.data.map((song) => [song.id, song])));
    if (!links.isFetching && opened.current) opened.current.update(links.data?.find((song) => song.id === opened.current?.id), false);
  }, [links.data, links.isFetching]);
  const items = (song: RecommendationSong, result?: ResolvedSong, pending = false): MenuItem[] => [
    ...settings.platforms.map((platform) => {
      const link = result?.links.find((entry) => entry.platform === platform);
      return { label: `${platformNames[platform]}${link?.kind === 'direct' ? '' : ' · 搜索'}`, href: link?.url ?? platformSearchLink(platform, song, settings), icon: <ExternalLink size={16} />, action: () => {} };
    }),
    ...(pending ? [{ label: '正在核实歌曲链接…', disabled: true, action: () => {} }] : []),
  ];
  function open(event: MouseEvent<HTMLElement>, song: RecommendationSong) {
    const button = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : event.currentTarget.querySelector('button'); button?.focus();
    const cached = resolved[song.id] ?? links.data?.find((entry) => entry.id === song.id);
    const handle = menu(event, items(song, cached, !cached && links.isFetching));
    opened.current = { id: song.id, update: (result, pending) => handle.update(items(song, result, pending)) };
  }
  return <div className="recommendation-table-wrap" data-track-columns style={columnVariables(normalizeTrackColumns(columns)) as CSSProperties}>{links.error && <p className="recommendation-status">链接核实暂未完成，仍可搜索歌曲。<button className="text-button" onClick={() => { void links.refetch(); }}>重新核实</button></p>}<table className="recommendation-table" aria-label={label}><thead><tr><th className="recommendation-position">#</th><th className="track-column-label track-column-0" aria-label="歌曲">歌曲<TrackColumnHandle index={0} name="歌曲" /></th><th className="recommendation-artist-column track-column-label track-column-1" aria-label="歌手">歌手<TrackColumnHandle index={1} name="歌手" /></th><th className="recommendation-album-column track-column-label track-column-2" aria-label="专辑">专辑<TrackColumnHandle index={2} name="专辑" /></th><th className="recommendation-date-column">发行日期</th><th className="recommendation-time-column track-column-label track-column-3" aria-label="时间">时间<TrackColumnHandle index={3} name="时间" /></th></tr></thead><tbody>{songs.map((song, index) => {
    const detail = resolved[song.id] ?? links.data?.find((entry) => entry.id === song.id); const duration = detail?.durationMs ?? song.durationMs; const date = detail?.releaseDate ?? song.releaseDate;
    return <tr key={song.id} onClick={(event) => open(event, song)} onContextMenu={(event) => open(event, song)}><td className="recommendation-position">{index + 1}</td><td><button className="track-title recommendation-song-trigger" aria-label={`选择收听平台：${song.title}`} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); open(event, song); }}>{song.title}</button><span className="recommendation-mobile-artist">{song.artists.join(' / ')}</span></td><td className="recommendation-artist-column">{song.artists.join(' / ')}</td><td className="recommendation-album-column">{detail?.album || song.album || '—'}</td><td className="recommendation-date-column">{date ? <time dateTime={date}>{date}</time> : '—'}</td><td className="recommendation-time-column"><span className="track-duration">{duration ? formatTime(duration / 1000) : '—'}</span></td></tr>;
  })}</tbody></table></div>;
}
