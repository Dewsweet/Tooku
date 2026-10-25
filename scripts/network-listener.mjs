import { networkInterfaces } from 'node:os';

export function canReuseListener(previousHost, requestedHost) {
  // Older state files describe the original loopback-only launcher.
  return requestedHost === '127.0.0.1' || previousHost === '0.0.0.0';
}

export function lanOrigins(port, interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flatMap((addresses) =>
    (addresses ?? []).filter((address) => address.family === 'IPv4' && !address.internal)
      .map((address) => `http://${address.address}:${port}`)))];
}
