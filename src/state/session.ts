import { create } from 'zustand';
import { QueryClient } from '@tanstack/react-query';
import { ApiError, type MusicApi } from '../api/client';

interface Session { api: MusicApi | null; version: string; notice: string; setSession: (api: MusicApi | null, version?: string) => void; notify: (message: string) => void }
export const useSession = create<Session>((set) => ({
  api: null, version: '', notice: '',
  setSession: (api, version = '') => set({ api, version }),
  notify: (notice) => set({ notice }),
}));
export const queryClient = new QueryClient({ defaultOptions: { queries: {
  staleTime: 60000,
  retry: (attempt, error) => !(error instanceof ApiError && error.code && [40, 50, 70].includes(error.code)) && attempt < 1,
  refetchOnWindowFocus: false,
}, mutations: { retry: false } } });

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作未完成，请稍后重试。'; }
