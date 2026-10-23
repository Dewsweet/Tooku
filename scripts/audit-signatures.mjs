import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['--yes', 'pnpm@11.25.0', 'audit', 'signatures'];

function audit(capture) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
}

const first = audit(true);
if (first.stdout) process.stdout.write(first.stdout);
if (first.stderr) process.stderr.write(first.stderr);
if (first.error) throw first.error;
if (first.status === 0) process.exit(0);

const output = `${first.stdout ?? ''}\n${first.stderr ?? ''}`;
if (!/timeout|timed out|ETIMEDOUT|ECONNRESET|operation was aborted/i.test(output)) process.exit(first.status ?? 1);

console.warn('Registry signature lookup timed out; retrying once.');
const second = audit(false);
if (second.error) throw second.error;
process.exit(second.status ?? 1);
