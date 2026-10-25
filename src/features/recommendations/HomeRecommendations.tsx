import { Link } from 'react-router-dom';
import { ArrowUpRight, Compass } from 'lucide-react';
import { useApi } from '../../components/Common';
import { useRecommendationProfiles } from '../../state/recommendations';
import './recommendations.css';

export function HomeRecommendations() {
  const api = useApi(); const profile = useRecommendationProfiles((state) => state.profiles[api.identity]);
  const batch = profile?.batch;
  return <section className="home-section home-recommendations" aria-label="为你推荐"><Link className="home-recommendation-feature" to="/recommendations"><span className="home-recommendation-mark" aria-hidden="true"><Compass size={38} strokeWidth={1.2} /></span><div className="home-recommendation-copy"><h2>为你推荐</h2><p>{batch?.songs.length ? `${batch.songs.length} 首音乐，沿着最近的聆听继续探索。` : '从最近喜欢的音乐出发，发现新歌与新歌手。'}</p><span>在你喜欢的音乐平台，遇见下一首心动</span></div><span className="home-recommendation-action">{batch?.songs.length ? '查看推荐' : '开始发现'}<ArrowUpRight size={18} /></span></Link></section>;
}
