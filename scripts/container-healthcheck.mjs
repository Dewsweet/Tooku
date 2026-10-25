import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkContainerHealth(port = Number(process.env.TOOKU_PORT ?? 8080)) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/__tooku/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    const payload = await response.json();
    return response.ok && payload?.app === 'tooku' && payload?.persistence === 1;
  } catch {
    return false;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain && !(await checkContainerHealth())) process.exit(1);
