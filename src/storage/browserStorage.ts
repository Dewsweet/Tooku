import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';

const memory = new Map<string, string>();
let localStorageFailed = false;
let indexedDbFailed = false;
let localDataDamaged = false;
let writeFailureRevision = 0;

function localStorageInstance() {
  try { return globalThis.localStorage; }
  catch { localStorageFailed = true; return undefined; }
}

const resilientLocalStorage: StateStorage = {
  getItem(name) {
    try {
      const value = localStorageInstance()?.getItem(name) ?? null;
      if (value !== null) {
        try { JSON.parse(value); }
        catch {
          localDataDamaged = true; memory.delete(name);
          try { localStorageInstance()?.removeItem(name); } catch { localStorageFailed = true; }
          return null;
        }
        memory.set(name, value);
      }
      return value ?? memory.get(name) ?? null;
    } catch { localStorageFailed = true; return memory.get(name) ?? null; }
  },
  setItem(name, value) {
    memory.set(name, value);
    try {
      const storage = localStorageInstance();
      if (!storage) { writeFailureRevision += 1; return; }
      storage.setItem(name, value);
    } catch { localStorageFailed = true; writeFailureRevision += 1; }
  },
  removeItem(name) {
    memory.delete(name);
    try {
      const storage = localStorageInstance();
      if (!storage) { writeFailureRevision += 1; return; }
      storage.removeItem(name);
    } catch { localStorageFailed = true; writeFailureRevision += 1; }
  },
};

export function browserJsonStorage<T>(): PersistStorage<T> {
  const storage = createJSONStorage<T>(() => resilientLocalStorage);
  if (!storage) throw new Error('无法创建浏览器存储适配器。');
  return storage;
}

export function markIndexedDbUnavailable() { indexedDbFailed = true; }

export function browserStorageWriteRevision() { return writeFailureRevision; }

export function browserStorageWarning() {
  if (localStorageFailed && indexedDbFailed) return '浏览器存储不可用；本机设置、队列和离线副本仅在本次打开期间有效，服务器账号数据仍可使用。';
  const warnings: string[] = [];
  if (localStorageFailed) warnings.push('浏览器本地设置无法保存；显示偏好仅在本次打开期间有效。');
  else if (localDataDamaged) warnings.push('浏览器中的本地设置已损坏，已忽略损坏缓存；服务器账号数据仍会读取。');
  if (indexedDbFailed) warnings.push('浏览器播放缓存无法保存；队列、历史和离线副本可能无法在刷新后恢复。');
  return warnings.join(' ');
}
