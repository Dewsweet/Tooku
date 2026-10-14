export interface Artist { id: string; name: string; albumCount?: number; coverArt?: string }
export interface Album {
  id: string; name: string; artist: string; artistId?: string; coverArt?: string;
  year?: number; songCount?: number; duration?: number; starred?: string;
}
export interface Track {
  id: string; title: string; artist: string; album?: string; albumId?: string;
  coverArt?: string; duration?: number; track?: number; discNumber?: number;
  suffix?: string; bitRate?: number; starred?: string;
}
export interface Playlist { id: string; name: string; owner?: string; songCount?: number; changed?: string }
export interface QueueEntry { entryId: string; track: Track }
export interface LyricLine { startMs?: number; text: string }
export interface Lyrics { lines: LyricLine[]; offsetMs: number; synced: boolean; lang?: string }
export interface HistoryEntry { occurrenceId: string; track: Track; listenedAt: number; submitted: boolean }
export interface PlayerSnapshot {
  version: 1; entries: QueueEntry[]; currentId: string | null; position: number;
  repeat: 'off' | 'all' | 'one'; volume: number;
}
