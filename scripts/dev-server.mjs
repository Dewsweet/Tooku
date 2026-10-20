import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { startOnAvailablePort } from './port-selection.mjs';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateFile = path.join(root, '.local', 'server.json');
const open = process.argv.includes('--open');
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  console.error('Tooku requires Node.js 24 or newer.'); process.exit(1);
}

async function running(origin) {
  try {
    const url = new URL(origin);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.username || url.password) return false;
    const response = await fetch(`${url.origin}/__tooku/health`, { signal: AbortSignal.timeout(700) });
    return (await response.json()).app === 'tooku';
  } catch { return false; }
}
let previous;
function openUrl(origin) {
  const safe = new URL(origin).origin;
  const command = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', `start "" "${safe}"`]] : process.platform === 'darwin' ? ['open', [safe]] : ['xdg-open', [safe]];
  const child = spawn(command[0], command[1], { stdio: 'ignore', windowsHide: true, detached: true });
  child.on('error', () => console.warn(`Open Tooku manually: ${safe}`)); child.unref();
}
try { previous = JSON.parse(await readFile(stateFile, 'utf8')); } catch { /* first run or stale state */ }
if (previous?.origin && await running(previous.origin)) {
  console.log(`\nTooku is already running: ${previous.origin}\n`);
  if (open) openUrl(previous.origin);
  process.exit(0);
}

const preferred = Number(process.env.TOOKU_PORT || 18733);
if (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65535) {
  console.error('TOOKU_PORT must be an integer between 1024 and 65535.'); process.exit(1);
}
const candidates = [...new Set([preferred, ...Array.from({ length: 10 }, (_, i) => 18733 + i)])];
const server = await startOnAvailablePort(candidates,
  (port) => createServer({ root, clearScreen: false, server: { host: '127.0.0.1', port, strictPort: true, open: false } }),
  (port) => console.warn(`Port ${port} is reserved or occupied; trying another port.`));
const origin = `http://127.0.0.1:${server.config.server.port}`;
await mkdir(path.dirname(stateFile), { recursive: true });
await writeFile(stateFile, JSON.stringify({ pid: process.pid, origin, startedAt: new Date().toISOString() }, null, 2));
await writeFile(path.join(root, '.local', 'server-url.txt'), origin + '\n');
console.log(`\n  Tooku is ready: ${origin}\n  Keep this process running. Ctrl+C stops Tooku.\n`);
if (open) openUrl(origin);
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  await server.close();
  try { const state = JSON.parse(await readFile(stateFile, 'utf8')); if (state.pid === process.pid) await unlink(stateFile); } catch { /* state may already be cleared */ }
  process.exit(0);
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
