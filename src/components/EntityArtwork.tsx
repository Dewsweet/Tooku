import { useState } from 'react';
import { useSession } from '../state/session';
import { useProfiles } from '../state/profile';
import { useArtistImage } from './useArtistImage';

export function EntityArtwork({ id, name, kind, coverArt, fallback, className = '', local = true }: { id: string; name: string; kind: 'artist' | 'playlist'; coverArt?: string; fallback?: string; className?: string; local?: boolean }) {
  const api = useSession((s) => s.api); const [failed, setFailed] = useState<string[]>([]);
  const serverImage = useArtistImage(api?.identity ?? '', kind === 'artist' ? id : '');
  const custom = useProfiles((s) => local && api ? (kind === 'playlist' ? s.playlistCovers?.[api.identity]?.[id] : s.artistCovers?.[api.identity]?.[id]) : undefined);
  const candidates = [...new Set([coverArt, `${kind === 'artist' ? 'ar' : 'pl'}-${id}`, fallback].filter((v): v is string => Boolean(v)))];
  const src = [serverImage?.preview, ...(serverImage ? [api?.coverUrl(`ar-${id}`, 500, serverImage.revision)] : [custom]), ...candidates.map((candidate) => api?.coverUrl(candidate, 500, serverImage?.revision))].find((url): url is string => Boolean(url && !failed.includes(url)));
  return <div className={`cover entity-artwork entity-${kind} ${className}`}>{src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed((old) => [...old, src])} /> : <span className="entity-initials" aria-hidden="true">{name.trim().slice(0, 2)}</span>}</div>;
}
