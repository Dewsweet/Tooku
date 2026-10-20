import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { Albums } from '../src/pages/Library';
import { useLibrary } from '../src/state/library';
import { useSession } from '../src/state/session';

const observers: { enter: () => void; disconnect: () => void; root: IntersectionObserverInit['root'] }[] = [];
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void, options: IntersectionObserverInit) {
      observers.push({ enter: () => callback([{ isIntersecting: true }]), disconnect: this.disconnect, root: options.root });
    }
    observe = vi.fn();
    disconnect = vi.fn();
  });
});
afterEach(() => { cleanup(); useSession.getState().setSession(null); useLibrary.setState({ profiles: {} }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const page = Array.from({ length: 30 }, (_, index) => ({ id: `a-${index}`, name: `专辑 ${index}`, artist: '歌手' }));
function setup() {
  const api = new MusicApi('https://example.test', 'fixture', 'not-real');
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'library-1', name: '测试曲库' }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSession.getState().setSession(api);
  return { api, client, show: () => render(<QueryClientProvider client={client}><MemoryRouter><main className="content"><Albums /></main></MemoryRouter></QueryClientProvider>) };
}

it('automatically reads the next page near the content viewport and stops at the end', async () => {
  const { api, client, show } = setup();
  const albums = vi.spyOn(api, 'albums').mockResolvedValueOnce(page).mockResolvedValueOnce([{ id: 'last', name: '最后一张', artist: '歌手' }]);
  const view = show();
  await screen.findByRole('link', { name: '查看专辑 专辑 0' });
  expect(screen.queryByRole('button', { name: '加载更多专辑' })).not.toBeInTheDocument();
  expect(albums).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(observers.length).toBeGreaterThan(0));
  expect(observers.at(-1)?.root).toBe(view.container.querySelector('.content'));
  act(() => observers.at(-1)?.enter());
  await screen.findByRole('link', { name: '查看专辑 最后一张' });
  expect(albums).toHaveBeenLastCalledWith('newest', 30, expect.any(AbortSignal), 'library-1');
  expect(albums).toHaveBeenCalledTimes(2);
  expect(observers.at(-1)?.disconnect).toHaveBeenCalled();
  view.unmount(); client.clear(); api.dispose();
});

it('keeps loaded albums on a failed page and only retries after an explicit retry', async () => {
  const { api, client, show } = setup();
  const albums = vi.spyOn(api, 'albums').mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('读取下一批失败')).mockResolvedValueOnce([]);
  const view = show();
  await waitFor(() => expect(observers.length).toBeGreaterThan(0));
  act(() => observers.at(-1)?.enter());
  await screen.findByRole('alert');
  expect(screen.getByRole('link', { name: '查看专辑 专辑 0' })).toBeInTheDocument();
  expect(albums).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(albums).toHaveBeenLastCalledWith('newest', 30, expect.any(AbortSignal), 'library-1');
  view.unmount(); client.clear(); api.dispose();
});

it('stops repeated server pages without rendering duplicate cards', async () => {
  const { api, client, show } = setup();
  const albums = vi.spyOn(api, 'albums').mockResolvedValue(page);
  const view = show();
  await waitFor(() => expect(observers.length).toBeGreaterThan(0));
  act(() => observers.at(-1)?.enter());
  await waitFor(() => expect(albums).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(observers.at(-1)?.disconnect).toHaveBeenCalled());
  expect(screen.getAllByRole('link', { name: /^查看专辑/ })).toHaveLength(30);
  view.unmount(); client.clear(); api.dispose();
});
