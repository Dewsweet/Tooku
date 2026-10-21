import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicApi } from '../src/api/client';
import { RecommendationsApi, recommendationsApi } from '../src/api/recommendations';
import { Recommendations } from '../src/features/recommendations/Recommendations';
import { RecommendationSettings } from '../src/features/settings/RecommendationSettings';
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
const surface = (child: React.ReactNode) => render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
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
  expect(screen.getAllByRole('link')).toHaveLength(4); expect(screen.getByRole('link', { name: '搜索Apple Music：New song' })).toHaveAttribute('href', expect.stringContaining('music.apple.com/cn/search'));
  expect(attach).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(usePlayer.getState().position).toBe(23);
  view.unmount(); surface(<Recommendations />); await screen.findByText('New song'); expect(recommendationsApi.generate).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '换一批' })).toBeEnabled();
  await waitFor(() => expect(screen.getByRole('button', { name: '在本库播放：New song' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '在本库播放：New song' }));
  await waitFor(() => expect(replace).toHaveBeenCalledOnce());
  expect(replace).toHaveBeenCalledWith([expect.objectContaining({ id: 'local-one' })], 0, { source: { kind: 'collection', id: 'recommendations-batch-one', libraryId: 'music' } });
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

it('does not play a different library version and preserves the current audio on lookup failure', async () => {
  configure(); useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  vi.mocked(api.search).mockResolvedValue({ songs: [{ id: 'live', title: 'New song (Live)', artist: 'Artist', duration: 180 }], artists: [], albums: [] });
  const replace = vi.spyOn(player, 'replace').mockImplementation(() => {});
  surface(<Recommendations />); await waitFor(() => expect(screen.getByRole('button', { name: '在本库播放：New song' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '在本库播放：New song' }));
  await waitFor(() => expect(useSession.getState().notice).toContain('本库未找到'));
  expect(replace).not.toHaveBeenCalled(); expect(usePlayer.getState().position).toBe(23);
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
