import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { AlbumGrid, Empty, PageTitle, QueryState, TrackList, useApi } from '../components/Common';
import { useMusicLibrary } from '../state/library';
import type { Track } from '../domain/models';

export function Search({ addToPlaylist }: { addToPlaylist: (track: Track) => void }) {
  const api = useApi(); const { libraryId } = useMusicLibrary(); const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? ''); const [composing, setComposing] = useState(false);
  const term = params.get('q') ?? '';
  const committed = useRef(term);
  useEffect(() => { if (term !== committed.current) { committed.current = term; setInput(term); } }, [term]);
  useEffect(() => { if (composing || term !== committed.current) return; const timer = setTimeout(() => { if (input.trim() !== term) { committed.current = input.trim(); setParams(input.trim() ? { q: input.trim() } : {}, { replace: true }); } }, 300); return () => clearTimeout(timer); }, [input, composing, term, setParams]);
  const query = useInfiniteQuery({ queryKey: [api.identity, 'search', term, libraryId], enabled: Boolean(term && libraryId), initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.search(term, pageParam, signal, libraryId), getNextPageParam: (last, pages) => Math.max(last.songs.length, last.albums.length, last.artists.length) === 30 ? pages.length * 30 : undefined });
  const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()];
  const songs = unique(query.data?.pages.flatMap((p) => p.songs) ?? []); const albums = unique(query.data?.pages.flatMap((p) => p.albums) ?? []); const artists = unique(query.data?.pages.flatMap((p) => p.artists) ?? []);
  return <><PageTitle title="搜索" /><label className="search-input"><SearchIcon size={21} /><input aria-label="搜索音乐" autoFocus placeholder="歌曲、专辑或歌手" value={input} onChange={(e) => setInput(e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={(e) => { setInput(e.currentTarget.value); setComposing(false); }} /></label>
    {!term ? <Empty title="从一首歌开始">搜索音乐库中的歌曲、专辑或歌手。</Empty> : <><QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} />{!!artists.length && <section className="section"><h2>歌手</h2><div className="artist-chips">{artists.map((a) => <Link key={a.id} to={`/artists/${encodeURIComponent(a.id)}`}>{a.name}</Link>)}</div></section>}{!!albums.length && <section className="section"><h2>专辑</h2><AlbumGrid albums={albums} /></section>}{!!songs.length && <section className="section"><h2>歌曲</h2><TrackList tracks={songs} addToPlaylist={addToPlaylist} /></section>}{query.data && !artists.length && !albums.length && !songs.length && <Empty title="没有找到匹配的音乐">试试歌曲原名或另一位歌手。目前搜索由 Navidrome 提供。</Empty>}{query.hasNextPage && <button className="load-more subtle-button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>加载更多结果</button>}</>}
  </>;
}
