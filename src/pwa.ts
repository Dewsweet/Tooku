import { create } from 'zustand';

const cachePrefix = 'tooku-shell-';
let registration: ServiceWorkerRegistration | null = null;
let reloading = false;
let acceptingUpdate = false;

interface PwaState { updateAvailable: boolean; dismiss: () => void }
export const usePwa = create<PwaState>((set) => ({ updateAvailable: false, dismiss: () => set({ updateAvailable: false }) }));

function revealUpdate(next: ServiceWorkerRegistration) {
  registration = next;
  if (next.waiting && navigator.serviceWorker.controller) usePwa.setState({ updateAvailable: true });
}

export async function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const next = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  revealUpdate(next);
  next.addEventListener('updatefound', () => {
    const worker = next.installing;
    worker?.addEventListener('statechange', () => { if (worker.state === 'installed') revealUpdate(next); });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!acceptingUpdate || reloading) return; reloading = true; window.location.reload();
  });
}

export function installPwaUpdate() { if (registration?.waiting) { acceptingUpdate = true; registration.waiting.postMessage('SKIP_WAITING'); } }

export async function clearPwaCaches() {
  registration?.active?.postMessage('CLEAR_TOOKU_CACHES');
  if (!('caches' in globalThis)) return 0;
  const keys = (await caches.keys()).filter((key) => key.startsWith(cachePrefix));
  await Promise.all(keys.map((key) => caches.delete(key)));
  return keys.length;
}
