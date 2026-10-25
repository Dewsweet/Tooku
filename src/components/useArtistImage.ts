import { useQuery } from '@tanstack/react-query';

export interface ArtistImageDisplay { revision: number; preview?: string }
export const artistImageKey = (identity: string, id: string) => [identity, 'artist-image-display', id];
// A confirmed upload preview lives only in the query cache while Navidrome builds its artwork.
export function useArtistImage(identity: string, id: string) {
  return useQuery<ArtistImageDisplay | null>({ queryKey: artistImageKey(identity, id), queryFn: () => null, enabled: false, initialData: null }).data;
}
