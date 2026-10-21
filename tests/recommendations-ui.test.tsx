import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Interactions } from '../src/components/Interactions';
import { MusicApi } from '../src/api/client';
import { RecommendationsApi, recommendationsApi } from '../src/api/recommendations';
import { Recommendations } from '../src/features/recommendations/Recommendations';
import { RecommendationSettings } from '../src/features/settings/RecommendationSettings';
import { HomeRecommendations } from '../src/features/recommendations/HomeRecommendations';
import { defaultRecommendationSettings as settings, emptyRecommendationCredentials, platformSearchLink, type RecommendationBatch } from '../src/domain/recommendations';
import { useRecommendationProfiles, useRecommendationSecrets } from '../src/state/recommendations';
import { useSession } from '../src/state/session';
import { useLibrary } from '../src/state/library';
import { player, usePlayer } from '../src/features/player/engine';

let api: MusicApi; let client: QueryClient;
const batch: RecommendationBatch = { id: 'batch-one', createdAt: 100000, mode: 'algorithm', sampleCount: 1, songs: [{ id: 'song-one', title: 'New song', artists: ['Artist'], durationMs: 180000, reason: '与你听过的歌曲相关', origin: 'lastfm' }], notices: [] };
beforeEach(() => {
  localStorage.clear();
  api = new MusicApi('http://example.test', 'fixture', crypto.randomUUID()); useSession.getState().setSession(api);
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'music', name: 'Music' }]);
  vi.spyOn(api, 'search').mockResolvedValue({ songs: [{ id: 'local-one', title: 'New song', artist: 'Artist', duration: 180 }], artists: [], albums: [] });
  useLibrary.setState({ profiles: {} }); useRecommendationProfiles.setState({ profiles: {} });
  usePlayer.setState({ ...usePlayer.getInitialState(), position: 23, history: [{ occurrenceId: 'occurrence', track: { id: 'seed', title: 'Seed', artist: 'Artist' }, listenedAt: Date.now(), submitted: true }] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(recommendationsApi, 'generate').mockResolvedValue(structuredClone(batch));
  vi.spyOn(recommendationsApi, 'links').mockImplementation(async (songs, config) => songs.map((song) => ({ id: song.id, links: config.platforms.map((platform) => ({ platform, url: platformSearchLink(platform, song, config), kind: 'search', status: 'not-found' })) })));
  vi.spyOn(recommendationsApi, 'check').mockResolvedValue('连接成功');
});
afterEach(() => { cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null); usePlayer.setState(usePlayer.getInitialState()); useRecommendationProfiles.setState({ profiles: {} }); vi.restoreAllMocks(); });
const surface = (child: React.ReactNode) => render(<QueryClientProvider client={client}><MemoryRouter><Interactions>{child}</Interactions></MemoryRouter></QueryClientProvider>);
const configure = () => useRecommendationSecrets.getState().update(api.identity, { lastfmKey: crypto.randomUUID() });

it('requires listening data and configuration, and does not generate automatically', async () => {
  surface(<Recommendations />);
  expect(screen.getByRole('button', { name: '生成推荐' })).toBeDisabled();
  expect(screen.getByText(/请从头像进入/)).toBeInTheDocument(); expect(recommendationsApi.generate).not.toHaveBeenCalled();
  act(configure); expect(screen.getByRole('button', { name: '生成推荐' })).toBeEnabled();
  act(() => usePlayer.setState({ history: [] }));
  expect(screen.getByRole('button', { name: '生成推荐' })).toBeDisabled(); expect(screen.getByText('听些音乐，再来发现新歌')).toBeInTheDocument();
});

it('generates only on click, retains results across navigation and provides all four search links', async () => {
  configure(); const attach = vi.spyOn(player, 'attach'); const replace = vi.spyOn(player, 'replace').mockImplementation(() => {});
  const view = surface(<Recommendations />); fireEvent.click(screen.getByRole('button', { name: '生成推荐' }));
  await screen.findByText('New song'); expect(recommendationsApi.generate).toHaveBeenCalledOnce();
  expect(recommendationsApi.links).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '选择收听平台：New song' }));
  expect(screen.getAllByRole('menuitem').filter((item) => item instanceof HTMLAnchorElement)).toHaveLength(4);
  expect(screen.getByRole('menuitem', { name: 'Apple Music · 搜索' })).toHaveAttribute('href', expect.stringContaining('music.apple.com/cn/search'));
  expect(attach).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(usePlayer.getState().position).toBe(23);
  view.unmount(); surface(<Recommendations />); await screen.findByText('New song'); expect(recommendationsApi.generate).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '换一批' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /本库播放/ })).not.toBeInTheDocument();
  expect(api.search).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
});

it('keeps the existing batch when a new generation fails or has no usable songs', async () => {
  configure(); useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  vi.mocked(recommendationsApi.generate).mockRejectedValueOnce(new Error('fixture failure')).mockResolvedValueOnce({ ...batch, id: 'empty', songs: [] });
  surface(<Recommendations />); fireEvent.click(screen.getByRole('button', { name: '换一批' }));
  await screen.findByText('fixture failure'); expect(screen.getByText('New song')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '换一批' }));
  await screen.findByText('暂未找到更多合适的新歌曲，已保留当前推荐'); expect(useRecommendationProfiles.getState().profiles[api.identity].batch?.id).toBe(batch.id);
  expect(vi.mocked(recommendationsApi.generate).mock.calls[0][3]).toEqual(['song-one']);
});

it('cancels late generations on account change and clears all session credentials', async () => {
  configure(); let resolve!: (value: RecommendationBatch) => void;
  vi.mocked(recommendationsApi.generate).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  surface(<Recommendations />); fireEvent.click(screen.getByRole('button', { name: '生成推荐' }));
  const signal = vi.mocked(recommendationsApi.generate).mock.calls[0][4];
  const next = new MusicApi('http://example.test', 'other', crypto.randomUUID()); vi.spyOn(next, 'libraries').mockResolvedValue([]);
  act(() => useSession.getState().setSession(next));
  await act(async () => resolve(batch));
  expect(signal?.aborted).toBe(true); expect(useRecommendationProfiles.getState().profiles[next.identity]).toBeUndefined(); expect(useRecommendationProfiles.getState().profiles[api.identity]).toBeUndefined();
  expect(useRecommendationSecrets.getState().credentials.lastfmKey).toBe(''); expect(screen.queryByText('New song')).not.toBeInTheDocument(); next.dispose();
});

it('uses external platform links and preserves the current audio without library lookup', async () => {
  configure(); useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  const replace = vi.spyOn(player, 'replace').mockImplementation(() => {});
  surface(<Recommendations />); fireEvent.click(screen.getByRole('button', { name: '选择收听平台：New song' })); const link = screen.getByRole('menuitem', { name: 'Spotify · 搜索' });
  expect(link).toHaveAttribute('target', '_blank'); expect(api.search).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /本库播放/ })).not.toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled(); expect(usePlayer.getState().position).toBe(23);
});

it('shares the current batch with home without generating or prefetching links, and shows four rows', async () => {
  const songs = Array.from({ length: 30 }, (_, index) => ({ ...batch.songs[0], id: `song-${index}`, title: `Discover ${index}` }));
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch: { ...batch, songs } }));
  const view = surface(<HomeRecommendations />);
  expect(screen.getByRole('region', { name: '为你推荐' })).toBeInTheDocument();
  expect(within(screen.getByRole('table', { name: '主页推荐歌曲' })).getAllByRole('row')).toHaveLength(5);
  expect(screen.getByRole('link', { name: '查看全部' })).toHaveAttribute('href', '/recommendations');
  expect(recommendationsApi.links).not.toHaveBeenCalled();
  expect(recommendationsApi.generate).not.toHaveBeenCalled();
  view.unmount(); surface(<Recommendations />);
  expect(within(screen.getByRole('table', { name: '推荐歌曲' })).getAllByRole('row')).toHaveLength(31);
  expect(recommendationsApi.links).not.toHaveBeenCalled(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('updates a song menu with direct links and real metadata without stealing focus or requesting covers', async () => {
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  let resolve!: (value: Awaited<ReturnType<typeof recommendationsApi.links>>) => void;
  vi.mocked(recommendationsApi.links).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  surface(<Recommendations />);
  expect(recommendationsApi.links).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '选择收听平台：New song' }));
  const qq = screen.getByRole('menuitem', { name: 'QQ 音乐 · 搜索' }); qq.focus();
  await waitFor(() => expect(recommendationsApi.links).toHaveBeenCalledOnce());
  expect(vi.mocked(recommendationsApi.links).mock.calls[0][0]).toHaveLength(1);
  await act(async () => resolve([{ id: 'song-one', album: 'Real record', durationMs: 235000, releaseDate: '2003-03', links: [{ platform: 'netease', kind: 'direct', status: 'matched', url: 'https://music.163.com/#/song?id=123' }] }]));
  expect(screen.getByRole('menuitem', { name: '网易云音乐' })).toHaveAttribute('href', 'https://music.163.com/#/song?id=123');
  expect(qq).toHaveFocus(); expect(screen.getByText('2003-03')).toBeInTheDocument(); expect(screen.getByText('3:55')).toBeInTheDocument(); expect(screen.getByText('Real record')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  fireEvent.keyDown(qq, { key: 'Escape' }); expect(screen.getByRole('button', { name: '选择收听平台：New song' })).toHaveFocus();
});

it('does not reopen a dismissed menu when a late lookup finishes', async () => {
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  let resolve!: (value: Awaited<ReturnType<typeof recommendationsApi.links>>) => void;
  vi.mocked(recommendationsApi.links).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  surface(<Recommendations />); fireEvent.click(screen.getByRole('button', { name: '选择收听平台：New song' }));
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await act(async () => resolve([{ id: 'song-one', links: [] }]));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('stores the requested count, exposes all listening references and excludes more than the last batch', async () => {
  configure();
  const history = Array.from({ length: 50 }, (_, index) => ({ occurrenceId: `listen${index}`, track: { id: `track${index}`, title: `Recent ${index}`, artist: `Artist ${index}` }, listenedAt: Date.now() - index * 1000, submitted: true }));
  usePlayer.setState({ history });
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch, seenIds: ['older-result'] }));
  surface(<Recommendations />);
  fireEvent.click(screen.getByRole('combobox', { name: '推荐数量' }));
  fireEvent.click(screen.getByRole('option', { name: '20 首' }));
  expect(useRecommendationProfiles.getState().profiles[api.identity].settings.resultCount).toBe(20);
  fireEvent.click(screen.getByRole('button', { name: '收听参考 · 50 首' }));
  expect(screen.getByText('Recent 49')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '换一批' }));
  await waitFor(() => expect(recommendationsApi.generate).toHaveBeenCalledOnce());
  const input = vi.mocked(recommendationsApi.generate).mock.calls[0];
  expect(input[0]).toHaveLength(50); expect(input[1].resultCount).toBe(20); expect(input[3]).toEqual(['older-result', 'song-one']);
  expect(input[5]).toEqual([{ id: 'song-one', title: 'New song', artists: ['Artist'] }]);
  await waitFor(() => expect(useRecommendationProfiles.getState().profiles[api.identity].seenIds).toEqual(['older-result', 'song-one']));
});

it('resolves thirty platform-link results in bounded groups and keeps successful groups on partial failure', async () => {
  const isolated = new RecommendationsApi(); const songs = Array.from({ length: 30 }, (_, index) => ({ ...batch.songs[0], id: `song-${index}` }));
  let active = 0; let maximum = 0;
  const request = vi.spyOn(isolated, 'request').mockImplementation(async (_path, payload) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((done) => setTimeout(done, 1)); active--;
    const data = payload as { songs: typeof songs };
    expect(data.songs.length).toBeLessThanOrEqual(6);
    if (data.songs[0].id === 'song-6') throw new Error('fixture failure');
    return data.songs.map((item) => ({ id: item.id, links: [{ platform: 'spotify', url: platformSearchLink('spotify', item), kind: 'search', status: 'not-found' }] }));
  });
  const result = await isolated.links(songs, settings, emptyRecommendationCredentials);
  expect(request).toHaveBeenCalledTimes(5); expect(maximum).toBe(2); expect(result).toHaveLength(30);
  expect(result[6].links.every((link) => link.status === 'unavailable')).toBe(true);
  expect(result[12].links[0].status).toBe('not-found');
});

it('stores ordinary settings while keeping credentials out of localStorage and clears them at logout', async () => {
  const view = surface(<RecommendationSettings />);
  const key = crypto.randomUUID(); const modelKey = crypto.randomUUID();
  fireEvent.change(screen.getByLabelText('Last.fm API Key'), { target: { value: key } });
  fireEvent.change(screen.getByLabelText('模型 API Key'), { target: { value: modelKey } });
  fireEvent.change(screen.getByLabelText('模型服务地址'), { target: { value: 'https://example.com/v1' } });
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'fixture-model' } });
  fireEvent.click(screen.getByRole('button', { name: '检测 AI 模型' }));
  await screen.findByText('AI 模型 · 连接成功');
  fireEvent.click(screen.getByRole('button', { name: '保存推荐设置' }));
  expect(screen.getByText('AI 模型 · 连接成功')).toBeInTheDocument();
  expect(useRecommendationProfiles.getState().profiles[api.identity].settings.model).toBe('fixture-model');
  const stored = localStorage.getItem('tooku-recommendations')!;
  expect(stored).toContain('fixture-model'); expect(stored).not.toContain(key); expect(stored).not.toContain(modelKey);
  expect(useRecommendationSecrets.getState().credentials.aiKey).toBe(modelKey);
  view.unmount(); act(() => useSession.getState().setSession(null));
  expect(useRecommendationSecrets.getState().credentials.aiKey).toBe('');
});

it('adopts asynchronously restored account settings without overwriting a form being edited', () => {
  surface(<RecommendationSettings />);
  act(() => useRecommendationProfiles.getState().apply(api.identity, { settings: { ...settings, model: 'restored' } }));
  expect(screen.getByLabelText('模型名称')).toHaveValue('restored');
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'editing' } });
  act(() => useRecommendationProfiles.getState().apply(api.identity, { settings: { ...settings, model: 'remote' } }));
  expect(screen.getByLabelText('模型名称')).toHaveValue('editing');
});

it('shows missing configuration next to each check without sending requests', () => {
  surface(<RecommendationSettings />);
  const lastfm = within(screen.getByRole('group', { name: 'Last.fm 连接检测' }));
  fireEvent.click(lastfm.getByRole('button'));
  expect(lastfm.getByRole('alert')).toHaveTextContent('请先填写 Last.fm API Key（不是 Shared secret）');
  expect(lastfm.getByRole('button')).toHaveAttribute('aria-busy', 'false');
  fireEvent.click(screen.getByRole('button', { name: '检测 AI 模型' }));
  expect(within(screen.getByRole('group', { name: 'AI 模型 连接检测' })).getByRole('alert')).toHaveTextContent('请先填写模型服务地址、模型名称、API Key');
  expect(recommendationsApi.check).not.toHaveBeenCalled();
});

it('keeps per-service progress and results visible until related settings change', async () => {
  let resolve!: (value: string) => void;
  vi.mocked(recommendationsApi.check).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  surface(<RecommendationSettings />);
  fireEvent.change(screen.getByLabelText('Last.fm API Key'), { target: { value: crypto.randomUUID() } });
  const lastfm = within(screen.getByRole('group', { name: 'Last.fm 连接检测' }));
  fireEvent.click(lastfm.getByRole('button'));
  expect(lastfm.getByRole('status')).toHaveTextContent('正在检测');
  expect(lastfm.getByRole('button')).toBeDisabled();
  expect(screen.getByRole('button', { name: '检测 AI 模型' })).toBeEnabled();
  await act(async () => resolve('连接成功'));
  expect(lastfm.getByRole('status')).toHaveTextContent('Last.fm · 连接成功');
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'deepseek-flash' } });
  expect(lastfm.getByRole('status')).toHaveTextContent('连接成功');
  fireEvent.change(screen.getByLabelText('Last.fm API Key'), { target: { value: crypto.randomUUID() } });
  expect(lastfm.getByRole('status')).toHaveTextContent('未检测');
});

it('shows check failures and ignores late responses after a credential edit', async () => {
  vi.mocked(recommendationsApi.check).mockRejectedValueOnce(new Error('模型账户余额不足（HTTP 402）'));
  surface(<RecommendationSettings />);
  fireEvent.change(screen.getByLabelText('模型服务地址'), { target: { value: 'https://api.deepseek.com' } });
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'deepseek-flash' } });
  fireEvent.change(screen.getByLabelText('模型 API Key'), { target: { value: crypto.randomUUID() } });
  const ai = within(screen.getByRole('group', { name: 'AI 模型 连接检测' }));
  fireEvent.click(ai.getByRole('button'));
  expect(await ai.findByRole('alert')).toHaveTextContent('HTTP 402');
  let resolve!: (value: string) => void;
  vi.mocked(recommendationsApi.check).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.click(ai.getByRole('button'));
  const signal = vi.mocked(recommendationsApi.check).mock.calls[1][3];
  fireEvent.change(screen.getByLabelText('模型 API Key'), { target: { value: crypto.randomUUID() } });
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve('连接成功'));
  expect(ai.getByRole('status')).toHaveTextContent('未检测');
  expect(ai.queryByRole('alert')).not.toBeInTheDocument();
});

it('checks only the selected service and trims its credential', async () => {
  const isolated = new RecommendationsApi();
  const request = vi.spyOn(isolated, 'request').mockResolvedValue({ ok: true });
  const key = crypto.randomUUID();
  await isolated.check('lastfm', { ...settings, aiBaseUrl: 'invalid' }, { ...emptyRecommendationCredentials, lastfmKey: `  ${key}  `, aiKey: crypto.randomUUID() });
  expect(request).toHaveBeenCalledWith('check', { target: 'lastfm', settings, credentials: { ...emptyRecommendationCredentials, lastfmKey: key } }, undefined);
});
