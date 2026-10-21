import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Music2 } from 'lucide-react';
import { useApi } from '../../components/Common';
import { recommendationsApi } from '../../api/recommendations';
import { emptyRecommendationCredentials, platformNames, platformSearchLink, type RecommendationBatch, type RecommendationSettings, type RecommendationSong, type ResolvedSong } from '../../domain/recommendations';
import { useRecommendationSecrets } from '../../state/recommendations';

export function useRecommendationLinks(batch: RecommendationBatch | undefined, settings: RecommendationSettings) {
  const api = useApi(); const secrets = useRecommendationSecrets();
  const credentials = secrets.identity === api.identity ? secrets.credentials : emptyRecommendationCredentials;
  return useQuery({ queryKey: [api.identity, 'recommendation-links-v2', batch?.id, settings.platforms, settings.appleStorefront, settings.spotifyMarket, secrets.revision], enabled: Boolean(batch?.songs.length), staleTime: 300000, gcTime: 300000, retry: false,
    queryFn: ({ signal }) => recommendationsApi.links(batch!.songs, settings, credentials, signal),
  });
}

export function RecommendationSongCard({ song, index, resolved, settings }: { song: RecommendationSong; index: number; resolved?: ResolvedSong; settings: RecommendationSettings }) {
  return <article className="recommendation-card" aria-label={`${index + 1}. ${song.title}`}>
    <div className="recommendation-art" aria-hidden="true"><Music2 size={28} />{resolved?.artwork && <img key={resolved.artwork} src={resolved.artwork} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}</div>
    <div className="recommendation-copy"><div className="recommendation-song-heading"><span className="recommendation-number">{String(index + 1).padStart(2, '0')}</span><h3>{song.title}</h3></div><p className="recommendation-artist">{song.artists.join(' / ')}</p>{song.album && <p className="recommendation-album">{song.album}</p>}</div>
    <p className="recommendation-reason">{song.reason}</p>
    <div className="recommendation-links">{settings.platforms.map((platform) => {
      const link = resolved?.links.find((item) => item.platform === platform); const direct = link?.kind === 'direct';
      return <a href={link?.url ?? platformSearchLink(platform, song, settings)} key={platform} target="_blank" rel="noreferrer" data-direct={direct || undefined} aria-label={`${direct ? '打开' : '搜索'}${platformNames[platform]}：${song.title}`}>{platformNames[platform]}{!direct && <span>搜索</span>}<ExternalLink size={12} aria-hidden="true" /></a>;
    })}</div>
  </article>;
}
