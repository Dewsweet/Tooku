import { openDB } from 'idb';
import type { HistoryEntry, PlayerSnapshot } from '../domain/models';

const db = () => openDB('tooku', 1, { upgrade(database) { database.createObjectStore('profiles'); } });
export async function readProfile<T>(identity: string, kind: string): Promise<T | undefined> {
  try { return await (await db()).get('profiles', `${identity}|${kind}`); } catch { return undefined; }
}
export async function saveProfile(identity: string, kind: string, data: PlayerSnapshot | HistoryEntry[]) {
  for (const listener of listeners) listener(identity, kind, data);
  try { await (await db()).put('profiles', data, `${identity}|${kind}`); return true; } catch { return false; }
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
