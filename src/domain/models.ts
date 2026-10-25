export interface Artist { id: string; name: string; albumCount?: number; coverArt?: string }
export interface Album {
  id: string; name: string; artist: string; artistId?: string; coverArt?: string;
  year?: number; songCount?: number; duration?: number; starred?: string;
}
export interface Track {
  id: string; title: string; artist: string; album?: string; albumId?: string;
  artistId?: string; artists?: { id?: string; name: string }[];
  coverArt?: string; duration?: number; track?: number; discNumber?: number;
  suffix?: string; bitRate?: number; starred?: string;
}
export interface Playlist { id: string; name: string; owner?: string; songCount?: number; changed?: string; coverArt?: string; duration?: number; comment?: string; readonly?: boolean }
export interface MusicLibrary { id: string; name: string }
export interface PlaybackSource { kind: 'album' | 'playlist' | 'artist' | 'collection'; id: string; libraryId?: string }
export interface QueueEntry { entryId: string; track: Track; source?: PlaybackSource; sourceIndex?: number }
export interface LyricWord { startMs: number; endMs?: number; text: string }
export interface LyricLine { startMs?: number; text: string; words?: LyricWord[]; translation?: string[]; romanization?: string[] }
export interface Lyrics { lines: LyricLine[]; offsetMs: number; synced: boolean; lang?: string; instrumental?: boolean; document?: import('./lyrics/types').LyricDocument }
export interface HistoryEntry { occurrenceId: string; track: Track; listenedAt: number; submitted: boolean }
export interface PlayerSnapshot {
  version: 1; entries: QueueEntry[]; currentId: string | null; position: number;
  repeat: 'off' | 'all' | 'one'; volume: number;
  shuffle?: boolean; originalOrder?: string[];
}
