import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const minimum = [24, 22, 1];

export const minimumNodeVersion = minimum.join('.');

export function parseNodeVersion(input) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(input);
  return match ? match.slice(1, 4).map(Number) : undefined;
}

export function supportsNodeVersion(input) {
  const version = parseNodeVersion(input);
  if (!version || input.includes('-')) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

export function assertSupportedNodeVersion(input = process.versions.node) {
  if (supportsNodeVersion(input)) return;
  throw new Error(`Tooku requires Node.js ${minimumNodeVersion} or newer; current version is ${input}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { assertSupportedNodeVersion(); }
  catch (error) { console.error(error.message); process.exit(1); }
}
