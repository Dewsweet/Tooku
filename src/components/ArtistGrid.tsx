import { Link } from 'react-router-dom';
import type { Artist } from '../domain/models';
import { EntityArtwork } from './EntityArtwork';

export function ArtistGrid({ artists }: { artists: Artist[] }) {
  return <div className="artist-grid">{artists.map((artist) => <Link to={`/artists/${encodeURIComponent(artist.id)}`} className="artist-card" key={artist.id}>
    <EntityArtwork id={artist.id} name={artist.name} kind="artist" coverArt={artist.coverArt} />
    <h3>{artist.name}</h3>
    {artist.albumCount !== undefined && <p className="muted">{artist.albumCount} 张专辑</p>}
  </Link>)}</div>;
}
