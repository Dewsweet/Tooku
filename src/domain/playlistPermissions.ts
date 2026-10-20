import type { Playlist } from './models';

export function playlistPermissions(playlist: Playlist, username: string) {
  // Explicit server editability takes precedence over the legacy owner-name fallback.
  const canEdit = playlist.readonly === false || !playlist.owner || playlist.owner.trim().toLocaleLowerCase() === username.trim().toLocaleLowerCase();
  // Synced and smart playlists may allow metadata edits while their tracks remain managed by the server.
  return { canEdit, canReorder: canEdit && playlist.readonly !== true };
}
