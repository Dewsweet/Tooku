export function isUnavailablePort(error) {
  return error?.code === 'EACCES' || error?.code === 'EADDRINUSE' || /^Port \d+ is already in use$/.test(error?.message ?? '');
}

export async function startOnAvailablePort(ports, create, unavailable = () => {}) {
  for (const port of ports) {
    const candidate = await create(port);
    try { await candidate.listen(); return candidate; }
    catch (error) {
      await candidate.close();
      if (!isUnavailablePort(error)) throw error;
      unavailable(port);
    }
  }
  throw new Error('No available Tooku port. Check Windows reserved ports and running applications.');
}
