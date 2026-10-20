import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Heart, LoaderCircle, Play, Shuffle } from 'lucide-react';
import type { MusicApi } from '../api/client';
import { AlbumGrid, Empty, IconButton, QueryState, useApi } from '../components/Common';
import type { Track } from '../domain/models';
import { player } from '../features/player/engine';
import { useMusicLibrary } from '../state/library';
import { errorMessage, useSession } from '../state/session';
import './artist-detail.css';

function ArtistHero({ name, coverArt, albumCount }: { name: string; coverArt?: string; albumCount: number }) {
  const api = useApi();
  const [loaded, setLoaded] = useState<string>();
  const [failed, setFailed] = useState<string>();
  // Use the server's explicit artist artwork. An album cover is not an artist portrait.
  const src = api.coverUrl(coverArt, 1200);
  const hasArt = Boolean(src && loaded === src && failed !== src);
  return <header className="artist-hero" data-has-art={hasArt}>
    {src && failed !== src && <img className="artist-hero-image" src={src} alt="" referrerPolicy="no-referrer" onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />}
    <div className="artist-hero-copy"><h1>{name}</h1><p>{albumCount} 张专辑</p></div>
  </header>;
}

export function ArtistDetail() {
  const api = useApi();
  const { libraryId } = useMusicLibrary();
  const { id = '' } = useParams();
  return <ArtistDetailContent key={JSON.stringify([api.identity, libraryId, id])} api={api} libraryId={libraryId} id={id} />;
}

function ArtistDetailContent({ api, libraryId, id }: { api: MusicApi; libraryId?: string; id: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: [api.identity, 'artist', id, libraryId], enabled: Boolean(libraryId), queryFn: ({ signal }) => api.artist(id, signal, libraryId) });
  const favorites = useQuery({ queryKey: [api.identity, 'favorites'], queryFn: ({ signal }) => api.favorites(signal) });
  const starred = Boolean(favorites.data?.artists.some((artist) => artist.id === id));
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const playbackRequest = useRef<AbortController | null>(null);
  useEffect(() => () => playbackRequest.current?.abort(), []);

  async function play(shuffle = false) {
    if (!query.data?.albums.length || playbackRequest.current) return;
    const request = new AbortController();
    playbackRequest.current = request;
    setPreparing(true);
    try {
      const tracks: Track[] = [];
      for (const album of query.data.albums) {
        const detail = await api.album(album.id, request.signal);
        if (request.signal.aborted || useSession.getState().api !== api) return;
        tracks.push(...detail.songs);
      }
      if (!tracks.length) { useSession.getState().notify('这位歌手还没有可播放的歌曲。'); return; }
      player.replace(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0);
      if (shuffle) player.shuffle();
    } catch (error) {
      if (!request.signal.aborted && useSession.getState().api === api) useSession.getState().notify(errorMessage(error));
    } finally {
      if (playbackRequest.current === request) playbackRequest.current = null;
      if (!request.signal.aborted) setPreparing(false);
    }
  }

  async function favorite() {
    if (saving) return;
    setSaving(true);
    try { await api.star(id, starred, 'artist'); await client.invalidateQueries({ queryKey: [api.identity, 'favorites'] }); }
    catch (error) { if (useSession.getState().api === api) useSession.getState().notify(errorMessage(error)); }
    finally { setSaving(false); }
  }

  return <div className="artist-detail-page">
    <QueryState pending={query.isLoading} error={query.error} retry={() => query.refetch()} />
    {query.data && <>
      <ArtistHero name={query.data.name} coverArt={query.data.coverArt} albumCount={query.data.albums.length} />
      <div className="artist-detail-body">
        <div className="artist-actions">
          <button type="button" className="artist-play" aria-label={preparing ? '正在准备播放' : `播放 ${query.data.name}`} disabled={preparing || !query.data.albums.length} onClick={() => void play()} data-tooltip={preparing ? '正在准备播放' : '播放'}>{preparing ? <LoaderCircle size={25} className="spin" /> : <Play size={25} fill="currentColor" />}</button>
          <IconButton label="随机播放歌手歌曲" disabled={preparing || !query.data.albums.length} onClick={() => void play(true)}><Shuffle size={24} /></IconButton>
          <button type="button" className="subtle-button artist-favorite" disabled={saving || favorites.isPending || favorites.isError} aria-pressed={starred} onClick={() => void favorite()}><Heart size={17} fill={starred ? 'currentColor' : 'none'} />{starred ? '已收藏' : '收藏歌手'}</button>
        </div>
        <QueryState pending={false} error={favorites.error} retry={() => favorites.refetch()} />
        <section className="artist-discography" aria-labelledby="artist-albums-heading"><h2 id="artist-albums-heading">专辑</h2>{query.data.albums.length ? <AlbumGrid albums={query.data.albums} /> : <Empty title="这个音乐库还没有这位歌手的专辑" />}</section>
      </div>
    </>}
  </div>;
}
