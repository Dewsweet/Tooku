import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Interactions } from '../src/components/Interactions';
import { MusicApi } from '../src/api/client';
import { UserDataApi } from '../src/api/userData';
import { RecommendationsApi, recommendationsApi } from '../src/api/recommendations';
import { Recommendations } from '../src/features/recommendations/Recommendations';
import { RecommendationSettings } from '../src/features/settings/RecommendationSettings';
import { HomeRecommendations } from '../src/features/recommendations/HomeRecommendations';
import { defaultRecommendationSettings as settings, emptyRecommendationCredentials, platformSearchLink, type RecommendationBatch } from '../src/domain/recommendations';
import { useRecommendationProfiles, useRecommendationSecrets } from '../src/state/recommendations';
import { useSession } from '../src/state/session';
import { useLibrary } from '../src/state/library';
import { usePreferences } from '../src/state/preferences';
import { player, usePlayer } from '../src/features/player/engine';

let api: MusicApi; let client: QueryClient;
const batch: RecommendationBatch = { id: 'batch-one', createdAt: 100000, mode: 'algorithm', sampleCount: 1, songs: [{ id: 'song-one', title: 'New song', artists: ['Artist'], durationMs: 180000, reason: '与你听过的歌曲相关', origin: 'lastfm' }], notices: [] };
beforeEach(() => {
  localStorage.clear();
  api = new MusicApi('http://example.test', 'fixture', crypto.randomUUID()); useSession.getState().setSession(api);
  vi.spyOn(api, 'libraries').mockResolvedValue([{ id: 'music', name: 'Music' }]);
  vi.spyOn(api, 'search').mockResolvedValue({ songs: [{ id: 'local-one', title: 'New song', artist: 'Artist', duration: 180 }], artists: [], albums: [] });
  useLibrary.setState({ profiles: {} }); useRecommendationProfiles.setState({ profiles: {} });
  usePreferences.setState({ trackColumns: [2.8, 1.5, 1.8, .6] });
  usePlayer.setState({ ...usePlayer.getInitialState(), position: 23, history: [{ occurrenceId: 'occurrence', track: { id: 'seed', title: 'Seed', artist: 'Artist' }, listenedAt: Date.now(), submitted: true }] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(recommendationsApi, 'generate').mockResolvedValue(structuredClone(batch));
  vi.spyOn(recommendationsApi, 'links').mockImplementation(async (songs, config) => songs.map((song) => ({ id: song.id, links: config.platforms.map((platform) => ({ platform, url: platformSearchLink(platform, song, config), kind: 'search', status: 'not-found' })) })));
  vi.spyOn(recommendationsApi, 'check').mockResolvedValue('连接成功');
});
afterEach(() => { cleanup(); client.clear(); api.dispose(); useSession.getState().setSession(null); usePlayer.setState(usePlayer.getInitialState()); useRecommendationProfiles.setState({ profiles: {} }); vi.restoreAllMocks(); });
const surface = (child: React.ReactNode) => render(<QueryClientProvider client={client}><MemoryRouter><Interactions>{child}</Interactions></MemoryRouter></QueryClientProvider>);
const configure = () => useRecommendationSecrets.getState().update(api.identity, { lastfmKey: crypto.randomUUID() });

it('uses server-saved key status after login, replaces keys without echoing them and enables generation without a draft', async () => {
  vi.spyOn(api, 'persistent', 'get').mockReturnValue(true);
  const account = new UserDataApi(); account.owner = 'synthetic-owner'; vi.spyOn(api, 'userData').mockResolvedValue(account);
  const saved = { lastfmKey: true, aiKey: false, appleToken: false, spotifyClientId: false, spotifyClientSecret: false };
  useRecommendationSecrets.getState().acceptSaved(api.identity, { revision: 3, saved });
  const write = vi.spyOn(account, 'saveCredentials').mockResolvedValue({ revision: 4, saved });
  const view = surface(<RecommendationSettings />);
  expect(screen.getByLabelText('Last.fm API Key')).toHaveValue('');
  expect(screen.getByLabelText('Last.fm API Key')).toHaveAttribute('placeholder', '已保存，填写可替换');
  fireEvent.click(screen.getByRole('button', { name: '检测 Last.fm' })); await screen.findByText('Last.fm · 连接成功');
  const key = crypto.randomUUID(); fireEvent.change(screen.getByLabelText('Last.fm API Key'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: '保存推荐设置' }));
  await waitFor(() => expect(write).toHaveBeenCalledWith(3, { lastfmKey: key }));
  await waitFor(() => expect(screen.getByLabelText('Last.fm API Key')).toHaveValue(''));
  expect(localStorage.getItem('tooku-recommendations')).not.toContain(key);
  view.unmount(); surface(<Recommendations />);
  expect(screen.getByRole('button', { name: '生成推荐' })).toBeEnabled();
});

it('requires listening data and configuration, and does not generate automatically', async () => {
  surface(<Recommendations />);
  expect(screen.getByText('暂无推荐')).toBeInTheDocument();
  expect(screen.getByText('从最近在听推荐新歌')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '生成推荐' })).toBeDisabled();
  expect(screen.getByText(/请从头像进入/)).toBeInTheDocument(); expect(recommendationsApi.generate).not.toHaveBeenCalled();
  act(configure); expect(screen.getByRole('button', { name: '生成推荐' })).toBeEnabled();
  act(() => usePlayer.setState({ history: [] }));
  expect(screen.getByRole('button', { name: '生成推荐' })).toBeDisabled(); expect(screen.getByText('暂无推荐')).toBeInTheDocument();
  expect(screen.getByText('从最近在听推荐新歌')).toBeInTheDocument();
});

it('uses a text time heading and shared keyboard column sizing without restarting playback or lookups', async () => {
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  surface(<Recommendations />);
  const time = screen.getByRole('columnheader', { name: '时间' });
  expect(time).toHaveTextContent('时间'); expect(time.querySelector('svg')).toBeNull();
  await waitFor(() => expect(recommendationsApi.links).toHaveBeenCalledOnce());
  const handle = screen.getByRole('separator', { name: '调整歌曲列宽' });
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(usePreferences.getState().trackColumns[0]).toBeCloseTo(2.95);
  expect(usePreferences.getState().trackColumns[1]).toBeCloseTo(1.35);
  const container = screen.getByRole('table', { name: '推荐歌曲' }).parentElement!;
  expect(parseFloat(container.style.getPropertyValue('--track-title-width'))).toBeCloseTo(2.95);
  fireEvent.keyDown(handle, { key: 'Home' });
  expect(usePreferences.getState().trackColumns).toEqual([2.8, 1.5, 1.8, .6]);
  expect(recommendationsApi.links).toHaveBeenCalledOnce(); expect(recommendationsApi.generate).not.toHaveBeenCalled();
  expect(usePlayer.getState().position).toBe(23);
});

it('previews column dragging, saves on release, and restores cancelled or unmounted drags', () => {
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  const view = surface(<Recommendations />); const initial = [...usePreferences.getState().trackColumns];
  const container = screen.getByRole('table', { name: '推荐歌曲' }).parentElement!;
  const labels = container.querySelectorAll<HTMLElement>('.track-column-label');
  labels.forEach((label, index) => {
    Object.defineProperty(label, 'offsetWidth', { value: initial[index] * 100 });
    vi.spyOn(label, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, initial[index] * 100, 42));
  });
  const handle = screen.getByRole('separator', { name: '调整歌曲列宽' });
  Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
  const pointer = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { clientX: { value: x }, pointerId: { value: 1 } }); fireEvent(handle, event);
  };
  pointer('pointerdown', 100); pointer('pointermove', 143);
  expect(document.documentElement).toHaveClass('is-resizing-columns');
  expect(parseFloat(container.style.getPropertyValue('--track-title-width'))).toBeCloseTo(3.23);
  expect(usePreferences.getState().trackColumns).toEqual(initial);
  pointer('pointerup', 143); expect(usePreferences.getState().trackColumns[0]).toBeCloseTo(3.23);
  expect(document.documentElement).not.toHaveClass('is-resizing-columns');
  fireEvent.doubleClick(handle); expect(usePreferences.getState().trackColumns).toEqual(initial);
  pointer('pointerdown', 100); pointer('pointermove', 143); pointer('pointercancel', 143);
  expect(container.style.getPropertyValue('--track-title-width')).toBe('2.8fr');
  expect(usePreferences.getState().trackColumns).toEqual(initial);
  pointer('pointerdown', 100); pointer('pointermove', 143); view.unmount();
  expect(document.documentElement).not.toHaveClass('is-resizing-columns');
  expect(usePreferences.getState().trackColumns).toEqual(initial);
});

it('generates only on click, retains results across navigation and provides all four search links', async () => {
  configure(); const attach = vi.spyOn(player, 'attach'); const replace = vi.spyOn(player, 'replace').mockImplementation(() => {});
  const view = surface(<Recommendations />); fireEvent.click(screen.getByRole('button', { name: '生成推荐' }));
  await screen.findByText('New song'); expect(recommendationsApi.generate).toHaveBeenCalledOnce();
  await waitFor(() => expect(recommendationsApi.links).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '选择收听平台：New song' }));
  expect(screen.getAllByRole('menuitem').filter((item) => item instanceof HTMLAnchorElement)).toHaveLength(4);
  expect(screen.getByRole('menuitem', { name: 'Apple Music · 搜索' })).toHaveAttribute('href', expect.stringContaining('music.apple.com/cn/search'));
  expect(attach).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(usePlayer.getState().position).toBe(23);
  view.unmount(); surface(<Recommendations />); await screen.findByText('New song'); expect(recommendationsApi.generate).toHaveBeenCalledOnce();
  expect(recommendationsApi.links).toHaveBeenCalledOnce();
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

it('shows a compact home entry without song rows, generation or link requests', async () => {
  const songs = Array.from({ length: 30 }, (_, index) => ({ ...batch.songs[0], id: `song-${index}`, title: `Discover ${index}` }));
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch: { ...batch, songs } }));
  const view = surface(<HomeRecommendations />);
  expect(screen.getByRole('region', { name: '为你推荐' })).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByText('30 首音乐，沿着最近的聆听继续探索。')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /查看推荐/ })).toHaveAttribute('href', '/recommendations');
  expect(recommendationsApi.links).not.toHaveBeenCalled();
  expect(recommendationsApi.generate).not.toHaveBeenCalled();
  view.unmount(); surface(<Recommendations />);
  expect(within(screen.getByRole('table', { name: '推荐歌曲' })).getAllByRole('row')).toHaveLength(31);
  await waitFor(() => expect(recommendationsApi.links).toHaveBeenCalledOnce());
  expect(vi.mocked(recommendationsApi.links).mock.calls[0][0]).toHaveLength(30);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.queryByText('本次推荐')).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '歌手' })).toBeInTheDocument();
});

it('updates a song menu with direct links and real metadata without stealing focus or requesting covers', async () => {
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  let resolve!: (value: Awaited<ReturnType<typeof recommendationsApi.links>>) => void;
  vi.mocked(recommendationsApi.links).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  surface(<Recommendations />);
  await waitFor(() => expect(recommendationsApi.links).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '选择收听平台：New song' }));
  const qq = screen.getByRole('menuitem', { name: 'QQ 音乐 · 搜索' }); qq.focus();
  expect(screen.getByRole('menuitem', { name: '正在核实歌曲链接…' })).toBeInTheDocument();
  await waitFor(() => expect(recommendationsApi.links).toHaveBeenCalledOnce());
  expect(vi.mocked(recommendationsApi.links).mock.calls[0][0]).toHaveLength(1);
  await act(async () => resolve([{ id: 'song-one', album: 'Real record', durationMs: 235000, releaseDate: '2003-03', links: [{ platform: 'netease', kind: 'direct', status: 'matched', url: 'https://music.163.com/#/song?id=123' }] }]));
  expect(await screen.findByRole('menuitem', { name: '网易云音乐' })).toHaveAttribute('href', 'https://music.163.com/#/song?id=123');
  expect(screen.queryByText('正在核实歌曲链接…')).not.toBeInTheDocument();
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

it('verifies the entire batch upfront and updates completed groups while other songs remain pending', async () => {
  const songs = [batch.songs[0], { ...batch.songs[0], id: 'second', title: 'Second song' }];
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch: { ...batch, songs } }));
  let resolve!: (value: Awaited<ReturnType<typeof recommendationsApi.links>>) => void;
  vi.mocked(recommendationsApi.links).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  surface(<Recommendations />);
  await waitFor(() => expect(recommendationsApi.links).toHaveBeenCalledOnce());
  const call = vi.mocked(recommendationsApi.links).mock.calls[0]; expect(call[0]).toEqual(songs);
  fireEvent.click(screen.getByRole('button', { name: '选择收听平台：New song' }));
  expect(screen.getByText('正在核实歌曲链接…')).toBeInTheDocument();
  const first = { id: songs[0].id, links: [{ platform: 'netease' as const, kind: 'direct' as const, status: 'matched' as const, url: 'https://music.163.com/#/song?id=123' }] };
  act(() => call[4]?.([first]));
  expect(screen.getByRole('menuitem', { name: '网易云音乐' })).toHaveAttribute('href', first.links[0].url);
  expect(screen.queryByText('正在核实歌曲链接…')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '选择收听平台：Second song' }));
  expect(screen.getByText('正在核实歌曲链接…')).toBeInTheDocument();
  await act(async () => resolve([first, { id: 'second', links: [] }]));
  await waitFor(() => expect(screen.queryByText('正在核实歌曲链接…')).not.toBeInTheDocument());
  expect(recommendationsApi.links).toHaveBeenCalledOnce();
});

it('cancels an entire batch lookup on account change and ignores its late progress', async () => {
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch }));
  let resolve!: (value: Awaited<ReturnType<typeof recommendationsApi.links>>) => void;
  vi.mocked(recommendationsApi.links).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  surface(<Recommendations />);
  await waitFor(() => expect(recommendationsApi.links).toHaveBeenCalledOnce());
  const call = vi.mocked(recommendationsApi.links).mock.calls[0];
  const next = new MusicApi('http://example.test', 'other', crypto.randomUUID()); vi.spyOn(next, 'libraries').mockResolvedValue([]);
  act(() => useSession.getState().setSession(next));
  expect(call[3]?.aborted).toBe(true);
  await act(async () => { const late = [{ id: 'song-one', album: 'Late metadata', links: [] }]; call[4]?.(late); resolve(late); });
  expect(screen.queryByText('Late metadata')).not.toBeInTheDocument(); expect(screen.queryByText('New song')).not.toBeInTheDocument();
  next.dispose();
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
  const progress = vi.fn();
  const result = await isolated.links(songs, settings, emptyRecommendationCredentials, undefined, progress);
  expect(request).toHaveBeenCalledTimes(5); expect(maximum).toBe(2); expect(result).toHaveLength(30);
  expect(progress).toHaveBeenCalledTimes(5);
  expect(progress.mock.calls.flatMap(([group]) => group)).toHaveLength(30);
  expect(result[6].links.every((link) => link.status === 'unavailable')).toBe(true);
  expect(result[12].links[0].status).toBe('not-found');
});

it('keeps search links when every lookup group fails and does not add retry controls', async () => {
  const isolated = new RecommendationsApi();
  const request = vi.spyOn(isolated, 'request').mockRejectedValue(new Error('fixture failure'));
  const songs = Array.from({ length: 10 }, (_, index) => ({ ...batch.songs[0], id: `fallback-${index}` }));
  const result = await isolated.links(songs, settings, emptyRecommendationCredentials);
  expect(request).toHaveBeenCalledTimes(2); expect(result).toHaveLength(10);
  expect(result.every((song) => song.links.length === 4 && song.links.every((link) => link.kind === 'search' && link.status === 'unavailable'))).toBe(true);
  useRecommendationProfiles.getState().update(api.identity, () => ({ settings, batch: { ...batch, songs } }));
  vi.mocked(recommendationsApi.links).mockResolvedValueOnce(result);
  surface(<Recommendations />); fireEvent.click(screen.getAllByRole('button', { name: '选择收听平台：New song' })[0]);
  await waitFor(() => expect(screen.queryByText('正在核实歌曲链接…')).not.toBeInTheDocument());
  expect(screen.getByRole('menuitem', { name: '网易云音乐 · 搜索' })).toHaveAttribute('href', expect.stringContaining('music.163.com'));
  expect(screen.queryByRole('button', { name: /重新核实|重试/ })).not.toBeInTheDocument();
  expect(recommendationsApi.links).toHaveBeenCalledOnce();
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
  expect(screen.getByRole('img', { name: 'Last.fm：检测失败' })).toHaveClass('status-light');
  fireEvent.click(screen.getByRole('button', { name: '检测 AI 模型' }));
  expect(within(screen.getByRole('group', { name: 'AI 模型 连接检测' })).getByRole('alert')).toHaveTextContent('请先填写模型服务地址、模型名称、API Key');
  expect(recommendationsApi.check).not.toHaveBeenCalled();
});

it('collapses optional platform credentials and preserves edits and checks when reopened', async () => {
  surface(<RecommendationSettings />);
  const apple = screen.getByText('Apple Music', { selector: 'summary' });
  const spotify = screen.getByText('Spotify', { selector: 'summary' });
  expect(apple.closest('details')).not.toHaveAttribute('open');
  expect(spotify.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('button', { name: '检测 Spotify' })).not.toBeVisible();
  fireEvent.click(spotify);
  fireEvent.change(screen.getByLabelText('Spotify Client ID'), { target: { value: 'synthetic-client' } });
  fireEvent.change(screen.getByLabelText('Spotify Client Secret'), { target: { value: 'synthetic-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '检测 Spotify' }));
  await screen.findByText('Spotify · 连接成功');
  fireEvent.click(spotify); fireEvent.click(spotify);
  expect(screen.getByLabelText('Spotify Client ID')).toHaveValue('synthetic-client');
  expect(screen.getByText('Spotify · 连接成功')).toBeVisible();
  expect(screen.queryByRole('link', { name: '填写说明' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '新歌手目标占比' })).toHaveAccessibleDescription(/本次收听样本/);
  fireEvent.click(screen.getByRole('combobox', { name: '推荐模式' }));
  fireEvent.click(screen.getByRole('option', { name: 'Last.fm 推荐' }));
  fireEvent.click(screen.getByRole('button', { name: '保存推荐设置' }));
  expect(useRecommendationProfiles.getState().profiles[api.identity].settings.mode).toBe('algorithm');
});

it('starts Last.fm and AI expanded, retains status when collapsed and selects region codes', async () => {
  useRecommendationProfiles.getState().apply(api.identity, { settings: { ...settings, appleStorefront: 'nz', spotifyMarket: 'NZ' } });
  surface(<RecommendationSettings />);
  const lastfmSummary = screen.getByText('Last.fm', { selector: 'summary' });
  const aiSummary = screen.getByText('AI 模型', { selector: 'summary' });
  expect(lastfmSummary.closest('details')).toHaveAttribute('open');
  expect(aiSummary.closest('details')).toHaveAttribute('open');
  expect(screen.queryByText('按近期收听查找相似歌曲。')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Last.fm API Key'), { target: { value: 'synthetic-lastfm-key' } });
  fireEvent.click(screen.getByRole('button', { name: '检测 Last.fm' }));
  await screen.findByText('Last.fm · 连接成功');
  fireEvent.click(lastfmSummary);
  expect(screen.getByRole('img', { name: 'Last.fm：可用' })).toBeVisible();
  expect(screen.getByText('Last.fm · 连接成功')).not.toBeVisible();
  fireEvent.click(lastfmSummary);
  fireEvent.change(screen.getByLabelText('Last.fm API Key'), { target: { value: 'synthetic-replacement-key' } });
  expect(screen.getByRole('img', { name: 'Last.fm：未检测' })).toBeVisible();
  fireEvent.click(screen.getByText('Apple Music', { selector: 'summary' }));
  const storefront = screen.getByRole('combobox', { name: '商店地区' });
  expect(storefront).toHaveTextContent('nz');
  fireEvent.click(storefront);
  expect(screen.getAllByRole('option')).toHaveLength(6);
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['nz', 'cn', 'us', 'jp', 'hk', 'tw']);
  fireEvent.click(screen.getByRole('option', { name: 'jp' }));
  fireEvent.click(screen.getByText('Spotify', { selector: 'summary' }));
  const market = screen.getByRole('combobox', { name: '市场地区' });
  expect(market).toHaveTextContent('NZ');
  fireEvent.click(market);
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['NZ', 'US', 'JP', 'HK', 'TW', 'GB']);
  fireEvent.click(screen.getByRole('option', { name: 'TW' }));
  fireEvent.click(screen.getByRole('button', { name: '保存推荐设置' }));
  expect(useRecommendationProfiles.getState().profiles[api.identity].settings).toMatchObject({ appleStorefront: 'jp', spotifyMarket: 'TW' });
});

it('keeps per-service progress and results visible until related settings change', async () => {
  let resolve!: (value: string) => void;
  vi.mocked(recommendationsApi.check).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  surface(<RecommendationSettings />);
  fireEvent.change(screen.getByLabelText('Last.fm API Key'), { target: { value: crypto.randomUUID() } });
  const lastfm = within(screen.getByRole('group', { name: 'Last.fm 连接检测' }));
  fireEvent.click(lastfm.getByRole('button'));
  expect(lastfm.getByRole('status')).toHaveTextContent('正在检测');
  expect(screen.getByRole('img', { name: 'Last.fm：检测中' })).toHaveClass('status-light');
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
