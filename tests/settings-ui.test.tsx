import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { lyricsApi } from '../src/api/lyrics';
import { recommendationsApi } from '../src/api/recommendations';
import { Settings } from '../src/pages/Settings';
import { useSession } from '../src/state/session';
import { useLibrary } from '../src/state/library';
import { usePreferences } from '../src/state/preferences';
import { useRecommendationProfiles, useRecommendationSecrets } from '../src/state/recommendations';
import { player, usePlayer } from '../src/features/player/engine';

let api: MusicApi;
let client: QueryClient;
beforeEach(() => {
  localStorage.clear();
  api = new MusicApi('http://example.test', 'fixture', crypto.randomUUID());
  useSession.getState().setSession(api);
  useLibrary.setState({ profiles: {} });
  usePreferences.setState(usePreferences.getInitialState());
  useRecommendationProfiles.setState({ profiles: {} });
  usePlayer.setState({ ...usePlayer.getInitialState(), position: 23 });
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'music', name: '测试音乐库' }]);
  vi.spyOn(lyricsApi, 'status').mockResolvedValue({ version: 1, enabled: true, cache: 'memory', providers: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup(); client.clear(); api.dispose();
  useSession.getState().setSession(null);
  usePlayer.setState(usePlayer.getInitialState());
  usePreferences.setState(usePreferences.getInitialState());
  vi.restoreAllMocks();
});
function surface() {
  render(<QueryClientProvider client={client}><MemoryRouter><Settings logout={vi.fn()} /></MemoryRouter></QueryClientProvider>);
  return within(screen.getByRole('navigation', { name: '设置分类' }));
}

it('supports keyboard category navigation and keeps hidden settings out of the focus order', async () => {
  const user = userEvent.setup(); const nav = surface();
  await screen.findByRole('combobox', { name: '当前音乐库' });
  expect(nav.getByRole('button', { name: '账户与音乐库' })).toHaveAttribute('aria-current', 'true');
  expect(screen.queryByRole('combobox', { name: '推荐模式' })).not.toBeInTheDocument();
  nav.getByRole('button', { name: '外观' }).focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('region', { name: '外观', hidden: false })).toBeVisible();
  expect(screen.queryByRole('button', { name: '选择头像' })).not.toBeInTheDocument();
  await user.tab();
  expect(nav.getByRole('button', { name: '播放与操作' })).toHaveFocus();
  await user.keyboard(' ');
  expect(screen.getByRole('switch', { name: '显示播放侧栏' })).toBeVisible();
  fireEvent.click(screen.getByRole('switch', { name: '显示播放侧栏' }));
  expect(usePreferences.getState().sidePanel).toBe(false);
});

it('preserves unsaved recommendation drafts and in-flight checks across categories without changing playback', async () => {
  const attach = vi.spyOn(player, 'attach'); const replace = vi.spyOn(player, 'replace'); const seek = vi.spyOn(player, 'seek');
  let finish!: (message: string) => void;
  const check = vi.spyOn(recommendationsApi, 'check').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const nav = surface();
  fireEvent.click(nav.getByRole('button', { name: '音乐推荐' }));
  const model = screen.getByLabelText('模型名称');
  fireEvent.change(model, { target: { value: 'fixture-draft' } });
  fireEvent.change(screen.getByLabelText('Last.fm API Key'), { target: { value: 'synthetic-session-key' } });
  fireEvent.click(screen.getByRole('button', { name: '检测 Last.fm' }));
  expect(check).toHaveBeenCalledOnce();
  fireEvent.click(nav.getByRole('button', { name: '网络歌词' }));
  expect(check.mock.calls[0][3]?.aborted).toBe(false);
  await act(async () => finish('连接成功'));
  fireEvent.click(nav.getByRole('button', { name: '音乐推荐' }));
  expect(screen.getByLabelText('模型名称')).toBe(model);
  expect(model).toHaveValue('fixture-draft');
  expect(screen.getByText('Last.fm · 连接成功')).toBeVisible();
  expect(useRecommendationProfiles.getState().profiles[api.identity]).toBeUndefined();
  expect(localStorage.getItem('tooku-recommendations') ?? '').not.toContain('synthetic-session-key');
  expect(useRecommendationSecrets.getState().credentials.lastfmKey).toBe('synthetic-session-key');
  expect(usePlayer.getState().position).toBe(23);
  expect(attach).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(seek).not.toHaveBeenCalled();
});

it('does not probe external services when browsing settings and retains the sync and snapshot controls', async () => {
  const check = vi.spyOn(lyricsApi, 'check');
  const nav = surface();
  fireEvent.click(nav.getByRole('button', { name: '网络歌词' }));
  await screen.findByText('服务运行中 · 内存缓存');
  expect(check).not.toHaveBeenCalled();
  fireEvent.click(nav.getByRole('button', { name: '用户数据' }));
  expect(screen.getByRole('button', { name: '重新连接' })).toBeVisible();
  expect(screen.getByRole('button', { name: '清除快照' })).toBeVisible();
  await waitFor(() => expect(lyricsApi.status).toHaveBeenCalledOnce());
});
