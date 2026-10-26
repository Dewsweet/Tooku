import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8');
const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

const requireText = (source, expected, label) => {
  if (!source.includes(expected)) throw new Error(`${label} is missing: ${expected}`);
};

for (const expected of [
  'USER 1000:1000',
  'HEALTHCHECK --interval=30s',
  'CMD ["node", "server/index.ts"]',
]) requireText(runtime, expected, 'Docker runtime stage');

if (/CMD\s+\[\s*["']npm["']/.test(runtime)) throw new Error('Docker runtime stage must launch Node directly');
if (!runtime.includes('rm -rf /usr/local/lib/node_modules/npm')) throw new Error('Docker runtime stage must remove npm');

for (const expected of [
  'init: true',
  'user: "1000:1000"',
  'read_only: true',
  '/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
  'cap_drop:',
  '- ALL',
  'no-new-privileges:true',
  'pids_limit: 128',
  'mem_limit: 512m',
  'cpus: 1.0',
  '${TOOKU_BIND_ADDRESS:-127.0.0.1}',
  'tooku-data:/data',
  'tooku-security-key:/run/tooku-secret',
  'TOOKU_SECRET_KEY_FILE: /run/tooku-secret/tooku-secret.key',
]) requireText(compose, expected, 'Compose service');

const docker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', windowsHide: true });
if (docker.error?.code === 'ENOENT') {
  console.log('Container configuration invariants passed; Docker Compose syntax check skipped (docker not installed).');
  process.exit(0);
}
if (docker.status !== 0) throw new Error(`docker compose is unavailable: ${docker.stderr.trim()}`);
const composeCheck = spawnSync('docker', ['compose', 'config', '--quiet'], { encoding: 'utf8', windowsHide: true });
if (composeCheck.status !== 0) throw new Error(`docker compose config failed: ${composeCheck.stderr.trim()}`);
console.log('Container configuration invariants and Docker Compose syntax passed.');
