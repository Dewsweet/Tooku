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
import { useDisplayPreferences } from '../src/state/display';
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
  useDisplayPreferences.setState(useDisplayPreferences.getInitialState());
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
  useDisplayPreferences.setState(useDisplayPreferences.getInitialState());
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
  expect(screen.queryByText('默认浏览入口')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: /浏览入口/ })).not.toBeInTheDocument();
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

it('applies custom colors without persisting incomplete values and restores the default', async () => {
  const nav = surface();
  fireEvent.click(nav.getByRole('button', { name: '外观' }));
  const scheme = screen.getByRole('combobox', { name: '主题色方案' });
  expect(scheme).toHaveTextContent('默认 · 莓红');
  expect(screen.queryByRole('textbox', { name: '主题色值' })).not.toBeInTheDocument();
  fireEvent.click(scheme); fireEvent.click(screen.getByRole('option', { name: '海蓝' }));
  expect(usePreferences.getState().accent).toBe('#3365c4');
  fireEvent.click(scheme); fireEvent.click(screen.getByRole('option', { name: '自定义' }));
  const hex = screen.getByRole('textbox', { name: '主题色值' });
  expect(hex.parentElement).toBe(screen.getByLabelText('选择主题色').parentElement);
  fireEvent.change(screen.getByLabelText('选择主题色'), { target: { value: '#123456' } });
  expect(hex).toHaveValue('#123456');
  expect(usePreferences.getState().accent).toBe('#123456');
  fireEvent.change(hex, { target: { value: '#12' } });
  fireEvent.blur(hex);
  expect(hex).toHaveAttribute('aria-invalid', 'true');
  expect(usePreferences.getState().accent).toBe('#123456');
  expect(localStorage.getItem('tooku-preferences')).toContain('#123456');
  fireEvent.change(hex, { target: { value: '#Aa88FF' } });
  expect(usePreferences.getState().accent).toBe('#aa88ff');
  act(() => usePreferences.getState().update({ accent: '#334455' }));
  expect(hex).toHaveValue('#334455');
  fireEvent.click(scheme); fireEvent.click(screen.getByRole('option', { name: '默认 · 莓红' }));
  expect(usePreferences.getState().accent).toBe(usePreferences.getInitialState().accent);
  expect(screen.queryByRole('textbox', { name: '主题色值' })).not.toBeInTheDocument();
});

it('keeps text size in browser display preferences without changing lyrics or account appearance', () => {
  const nav = surface(); const initial = usePreferences.getState();
  fireEvent.click(nav.getByRole('button', { name: '外观' }));
  fireEvent.click(screen.getByRole('combobox', { name: '基础字号' }));
  fireEvent.click(screen.getByRole('option', { name: '大 · 16 px' }));
  expect(useDisplayPreferences.getState().baseFontSize).toBe(16);
  expect(localStorage.getItem('tooku-display')).toContain('"baseFontSize":16');
  expect(usePreferences.getState()).toBe(initial);
  act(() => useDisplayPreferences.getState().setBaseFontSize(100));
  expect(useDisplayPreferences.getState().baseFontSize).toBe(14);
});

it('shows available, failed and stale lyric observations as labelled status lights', async () => {
  const now = Date.now();
  vi.mocked(lyricsApi.status).mockResolvedValue({ version: 1, enabled: true, cache: 'memory', providers: [
    { id: 'netease', search: { checkedAt: now, successAt: now }, lyrics: { checkedAt: now, error: 'timeout' } },
    { id: 'qq', search: { checkedAt: now - 1801000, successAt: now - 1801000 }, lyrics: {} },
  ] });
  const nav = surface();
  fireEvent.click(nav.getByRole('button', { name: '网络歌词' }));
  expect(await screen.findByLabelText('搜索：可用')).toHaveAttribute('data-state', 'available');
  expect(screen.getByLabelText('歌词：请求超时')).toHaveAttribute('data-state', 'error');
  expect(screen.getByLabelText('搜索：未检测')).toHaveAttribute('data-state', 'unknown');
  expect(screen.getAllByText('检测详情')).toHaveLength(2);
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
