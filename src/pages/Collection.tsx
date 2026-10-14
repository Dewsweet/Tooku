import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlbumGrid, Empty, PageTitle, QueryState, TrackList, useApi } from '../components/Common';
import type { Track } from '../domain/models';
import { usePlayer } from '../features/player/engine';

export function Favorites({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const [tab, setTab] = useState('songs');
  const query = useQuery({ queryKey: [api.identity, 'favorites'], queryFn: ({ signal }) => api.favorites(signal) }); const data = query.data;
  return <><PageTitle title="收藏" /><div className="tabs" role="tablist" aria-label="收藏分类">{[['songs', '歌曲'], ['albums', '专辑'], ['artists', '歌手']].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{data && <>{tab === 'songs' && (data.songs.length ? <TrackList tracks={data.songs} addToPlaylist={addToPlaylist} /> : <Empty title="收藏喜欢的歌曲">点击歌曲旁的爱心，下次就能轻松找到。</Empty>)}{tab === 'albums' && (data.albums.length ? <AlbumGrid albums={data.albums} /> : <Empty title="还没有收藏的专辑" />)}{tab === 'artists' && <div className="artist-chips">{data.artists.map((a) => <Link key={a.id} to={`/artists/${encodeURIComponent(a.id)}`}>{a.name}</Link>)}{!data.artists.length && <Empty title="还没有收藏的歌手" />}</div>}</>}</>;
}
export function History({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const history = usePlayer((s) => s.history);
  return <><PageTitle eyebrow="此设备 · 达到收听时长后记录" title="最近听过" /><p className="muted">这里只显示此设备的收听记录，不包含其他客户端的完整历史。</p>{history.length ? <TrackList tracks={history.map((h) => h.track)} addToPlaylist={addToPlaylist} /> : <Empty title="让音乐留下足迹">开始听歌，达到收听阈值后会记录在这里。</Empty>}</>;
}
