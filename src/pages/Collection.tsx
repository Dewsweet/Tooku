import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlbumGrid, Empty, PageTitle, QueryState, TrackList, useApi } from '../components/Common';
import { ArtistGrid } from '../components/ArtistGrid';
import { FilterPills } from '../components/FilterPills';
import type { Track } from '../domain/models';
import { useMusicLibrary } from '../state/library';
import { usePlayer } from '../features/player/engine';

const favoriteFilters = [['songs', '歌曲'], ['albums', '专辑'], ['artists', '歌手']] as const;

export function Favorites({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const [tab, setTab] = useState<typeof favoriteFilters[number][0]>('songs');
  const query = useQuery({ queryKey: [api.identity, 'favorites', libraryId], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.favorites(signal, libraryId) }); const data = query.data;
  return <div className="favorites-page">
    <PageTitle title="收藏" />
    <FilterPills label="收藏分类" options={favoriteFilters} value={tab} onChange={setTab} />
    <QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />
    {data && <>
      {tab === 'songs' && (data.songs.length ? <TrackList tracks={data.songs} source={{ kind: 'collection', id: 'favorites', libraryId }} addToPlaylist={addToPlaylist} /> : <Empty title="还没有收藏的歌曲" />)}
      {tab === 'albums' && (data.albums.length ? <AlbumGrid albums={data.albums} /> : <Empty title="还没有收藏的专辑" />)}
      {tab === 'artists' && (data.artists.length ? <ArtistGrid artists={data.artists} /> : <Empty title="还没有收藏的歌手" />)}
    </>}
  </div>;
}
export function History({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const history = usePlayer((s) => s.history);
  return <><PageTitle title="最近听过" />{history.length ? <TrackList tracks={history.map((h) => h.track)} source={{ kind: 'collection', id: 'history' }} addToPlaylist={addToPlaylist} /> : <Empty title="让音乐留下足迹">开始听歌，达到收听阈值后会记录在这里。</Empty>}</>;
}
