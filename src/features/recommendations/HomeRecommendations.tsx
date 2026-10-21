import { Link } from 'react-router-dom';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { useApi } from '../../components/Common';
import { defaultRecommendationSettings } from '../../domain/recommendations';
import { useRecommendationProfiles } from '../../state/recommendations';
import { RecommendationSongCard, useRecommendationLinks } from './RecommendationSongs';
import './recommendations.css';

export function HomeRecommendations() {
  const api = useApi(); const profile = useRecommendationProfiles((state) => state.profiles[api.identity]);
  const settings = profile?.settings ?? defaultRecommendationSettings; const batch = profile?.batch;
  const links = useRecommendationLinks(batch, settings);
  return <section className="home-section home-recommendations" aria-label="为你推荐"><div className="home-section-heading"><h2>为你推荐</h2><Link to="/recommendations">{batch?.songs.length ? '查看全部' : '发现新音乐'}<ArrowUpRight size={16} /></Link></div>
    {batch?.songs.length ? <div className="recommendation-grid">{batch.songs.slice(0, 4).map((song, index) => <RecommendationSongCard key={song.id} song={song} index={index} resolved={links.data?.find((item) => item.id === song.id)} settings={settings} />)}</div> : <Link className="home-recommendation-invite" to="/recommendations"><span><Sparkles size={24} /></span><div><strong>发现更多喜欢的音乐</strong><p>从最近的聆听中探索新歌与新歌手</p></div><ArrowUpRight size={20} /></Link>}
  </section>;
}
