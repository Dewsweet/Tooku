import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MusicApi } from '../src/api/client';
import { useSession } from '../src/state/session';
import { Search } from '../src/pages/Search';

afterEach(() => { cleanup(); vi.useRealTimers(); useSession.getState().setSession(null); vi.restoreAllMocks(); });
it('waits for Chinese input composition to finish before submitting a search', async () => {
  vi.useFakeTimers();
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'libraries').mockResolvedValue([{id:'1',name:'测试曲库'}]);
  const search = vi.spyOn(api, 'search').mockResolvedValue({ songs: [], albums: [], artists: [] });
  useSession.getState().setSession(api);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/search']}><Search addToPlaylist={() => {}} /></MemoryRouter></QueryClientProvider>);
  const input = screen.getByLabelText('搜索音乐');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'zhou' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(search).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '周杰伦' } });
  fireEvent.compositionEnd(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(301); });
  expect(search).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledWith('周杰伦', 0, expect.any(AbortSignal), '1');
  client.clear(); api.dispose();
});
