import { normalizeServer } from '../api/client';

const key = 'tooku-login-server';

function safeAddress(value: string | null) {
  const address = value?.trim() ?? '';
  if (!address || address.length > 2048) return '';
  try { normalizeServer(address); return address; } catch { return ''; }
}

export function readLoginServer() {
  try { return safeAddress(localStorage.getItem(key)); } catch { return ''; }
}

/** Store only a validated base address; never credentials, query strings or fragments. */
export function rememberLoginServer(input: string) {
  const address = safeAddress(input);
  if (!address) return;
  try { localStorage.setItem(key, address); } catch { /* Address memory must not block login. */ }
}
