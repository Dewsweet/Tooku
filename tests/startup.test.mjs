import { describe, expect, it, vi } from 'vitest';
import { startOnAvailablePort } from '../scripts/port-selection.mjs';

describe('Windows startup port recovery', () => {
  it('closes the failed listener and falls back after Windows EACCES', async () => {
    const failed = { listen: vi.fn().mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' })), close: vi.fn() };
    const ready = { listen: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
    const create = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(ready);
    expect(await startOnAvailablePort([5173, 18733], create)).toBe(ready);
    expect(failed.close).toHaveBeenCalledOnce(); expect(ready.close).not.toHaveBeenCalled();
    expect(create.mock.calls.map(([port]) => port)).toEqual([5173, 18733]);
  });
  it('handles the Vite occupied-port error even when it has no OS code', async () => {
    const create = vi.fn().mockResolvedValueOnce({ listen: () => Promise.reject(new Error('Port 18733 is already in use')), close: vi.fn() }).mockResolvedValueOnce({ listen: () => Promise.resolve(), close: vi.fn() });
    await startOnAvailablePort([18733, 18734], create); expect(create).toHaveBeenCalledTimes(2);
  });
  it('does not disguise a broken configuration as a port problem', async () => {
    const create = vi.fn().mockResolvedValue({ listen: () => Promise.reject(new Error('invalid configuration')), close: vi.fn() });
    await expect(startOnAvailablePort([18733, 18734], create)).rejects.toThrow('invalid configuration'); expect(create).toHaveBeenCalledTimes(1);
  });
  it('ends after a bounded set of unavailable ports', async () => {
    const create = vi.fn().mockResolvedValue({ listen: () => Promise.reject(Object.assign(new Error(), { code: 'EADDRINUSE' })), close: vi.fn() });
    await expect(startOnAvailablePort([18733, 18734], create)).rejects.toThrow('No available'); expect(create).toHaveBeenCalledTimes(2);
  });
});
