import type { Album } from './models';

export interface ArtistArtworkCandidate { kind: 'artist' | 'album'; coverArt: string; albumId?: string }

export function artistArtworkCandidates(artistId: string, coverArt: string | undefined, albums: Album[]): ArtistArtworkCandidate[] {
  const candidates: ArtistArtworkCandidate[] = coverArt?.trim() ? [{ kind: 'artist', coverArt }] : [];
  const ownAlbums = albums.filter((album) => album.coverArt?.trim() && (!album.artistId || album.artistId === artistId));
  // Stable IDs keep the fallback consistent when the server changes album ordering.
  ownAlbums.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const seen = new Set(candidates.map((candidate) => candidate.coverArt));
  for (const album of ownAlbums) {
    const coverArt = album.coverArt;
    if (!coverArt || seen.has(coverArt)) continue;
    seen.add(coverArt);
    candidates.push({ kind: 'album', coverArt, albumId: album.id });
  }
  return candidates;
}
