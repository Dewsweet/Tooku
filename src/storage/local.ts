import { openDB } from 'idb';
import type { HistoryEntry, PlayerSnapshot } from '../domain/models';
import { markIndexedDbUnavailable } from './browserStorage';

const db = async () => {
  try { return await openDB('tooku', 1, { upgrade(database) { database.createObjectStore('profiles'); } }); }
  catch (error) { markIndexedDbUnavailable(); throw error; }
};
export async function readProfile<T>(identity: string, kind: string): Promise<T | undefined> {
  try { return await (await db()).get('profiles', `${identity}|${kind}`); } catch { return undefined; }
}
export async function saveProfile(identity: string, kind: string, data: PlayerSnapshot | HistoryEntry[]) {
  if (heldPlaybackSnapshots.has(identity)) return true;
  for (const listener of listeners) listener(identity, kind, data);
  try { await (await db()).put('profiles', data, `${identity}|${kind}`); return true; } catch { return false; }
}
// An explicit restore belongs to the next login. The still-running player must not overwrite it.
const heldPlaybackSnapshots = new Set<string>();
export function holdPlaybackSnapshots(identity: string, hold: boolean) {
  if (hold) heldPlaybackSnapshots.add(identity); else heldPlaybackSnapshots.delete(identity);
}
const listeners = new Set<(identity: string, kind: string, data: PlayerSnapshot | HistoryEntry[]) => void>();
export function onProfileSave(listener: (identity: string, kind: string, data: PlayerSnapshot | HistoryEntry[]) => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
// User sync caches retain both the last acknowledged base and local edits. Never removed by clearing playback snapshots.
export async function writeLocalData(identity: string, kind: string, data: unknown) {
  try { await (await db()).put('profiles', data, `${identity}|${kind}`); return true; } catch { return false; }
}
export async function clearProfile(identity: string) {
  const database = await db();
  const tx = database.transaction('profiles', 'readwrite');
  for (const kind of ['queue', 'history']) await tx.store.delete(`${identity}|${kind}`);
  await tx.done;
}
