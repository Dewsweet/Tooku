import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Heart, LoaderCircle, Pencil, Play, Shuffle } from 'lucide-react';
import type { MusicApi } from '../api/client';
import { AlbumGrid, Empty, IconButton, QueryState, useApi } from '../components/Common';
import type { Album, Track } from '../domain/models';
import { artistArtworkCandidates } from '../domain/artistArtwork';
import { AvatarEditor } from '../components/AvatarEditor';
import { artistImageKey, useArtistImage, type ArtistImageDisplay } from '../components/useArtistImage';
import { useContextMenu } from '../components/Interactions';
import { player } from '../features/player/engine';
import { useMusicLibrary } from '../state/library';
import { errorMessage, useSession } from '../state/session';
import { useProfiles } from '../state/profile';
import './artist-detail.css';

function ArtistHero({ id, name, coverArt, albums }: { id: string; name: string; coverArt?: string; albums: Album[] }) {
  const api = useApi();
  const client = useQueryClient();
  const serverImage = useArtistImage(api.identity, id);
  const editable = api.canEditArtistImages;
  const imageInfo = useQuery({ queryKey: [api.identity, 'artist-image-info', id], enabled: editable, retry: false, queryFn: () => api.artistImage(id) });
  const custom = useProfiles((state) => state.artistCovers?.[api.identity]?.[id]);
  const menu = useContextMenu();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState<string>();
  const [failed, setFailed] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);
  const candidates = [
    ...(serverImage ? [{ kind: 'artist', src: serverImage.preview ?? api.coverUrl(`ar-${id}`, 600, serverImage.revision) }] : custom ? [{ kind: 'custom', src: custom }] : []),
    ...artistArtworkCandidates(id, coverArt, albums).map((image) => ({ kind: image.kind, src: api.coverUrl(image.coverArt, 600, serverImage?.revision) })),
  ];
  const candidate = candidates.find((image) => image.src && !failed.includes(image.src));
  const src = candidate?.src;
  const hasArt = Boolean(src && loaded === src);
  function refreshImage(preview?: string) {
    client.setQueryData<ArtistImageDisplay>(artistImageKey(api.identity, id), { revision: Date.now(), preview });
    void client.invalidateQueries({ queryKey: [api.identity, 'artist'] });
    void client.invalidateQueries({ queryKey: [api.identity, 'artists'] });
  }
  async function saveImage(image?: string) {
    const info = await api.saveArtistImage(id, image);
    client.setQueryData([api.identity, 'artist-image-info', id], info);
    refreshImage(image);
    try { useProfiles.getState().setArtistCover(api.identity, id, undefined); }
    catch { if (useSession.getState().api === api) useSession.getState().notify('图片已保存到 Navidrome，本机旧图片缓存未能清除。'); }
  }
  async function verifyImage() {
    const info = await api.artistImage(id);
    client.setQueryData([api.identity, 'artist-image-info', id], info); refreshImage();
  }
  async function restoreImage() {
    if (restoring) return;
    setRestoring(true);
    try { await saveImage(); }
    catch (error) { if (useSession.getState().api === api) useSession.getState().notify(errorMessage(error)); }
    finally { setRestoring(false); }
  }
  return <><header className="artist-hero" data-has-art={hasArt} data-artwork={hasArt ? candidate?.kind : 'none'}>
    {src && <img key={src} className="artist-hero-image" src={src} alt="" referrerPolicy="no-referrer" onLoad={() => setLoaded(src)} onError={() => setFailed((previous) => [...previous, src])} />}
    <button type="button" className="artist-portrait" disabled={!editable || restoring} aria-label={editable ? '更换歌手图片' : '歌手图片'} data-tooltip={editable ? '更换歌手图片（保存到 Navidrome）' : '更换图片需要 Navidrome 管理员会话'} onClick={() => input.current?.click()} onContextMenu={(event) => editable && menu(event, [
      { label: '选择照片', icon: <Pencil size={16} />, action: () => input.current?.click() },
      { label: '重新读取服务器图片', action: verifyImage },
      { label: '恢复服务器默认图片', disabled: !imageInfo.data?.uploadedImage, action: restoreImage },
      ...(custom ? [{ label: '移除旧版私人图片', action: () => useProfiles.getState().setArtistCover(api.identity, id, undefined) }] : []),
    ])}>
      {hasArt ? <img src={src} alt={candidate?.kind === 'album' ? '专辑封面' : `${name}的图片`} referrerPolicy="no-referrer" /> : <span className="artist-portrait-initials" aria-hidden="true">{name.trim().slice(0, 2)}</span>}
      {editable && <span className="artist-portrait-edit"><Pencil size={34} /><span>{restoring ? '正在恢复…' : '选择照片'}</span></span>}
    </button>
    <div className="artist-hero-copy"><h1>{name}</h1><p>{albums.length} 张专辑</p></div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="上传歌手图片" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) setFile(selected); }} />
  </header>{file && <AvatarEditor kind="artist" file={file} onSave={saveImage} onVerify={verifyImage} onClose={() => setFile(null)} />}</>;
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
      <ArtistHero id={id} name={query.data.name} coverArt={query.data.coverArt} albums={query.data.albums} />
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
