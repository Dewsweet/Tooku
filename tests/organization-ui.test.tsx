import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MusicApi } from '../src/api/client';
import { useSession } from '../src/state/session';
import { emptyLibraryProfile, orderKey, useLibrary } from '../src/state/library';
import { FolderEditor, PlaylistLocation, PlaylistTree } from '../src/features/library/Organization';
import { PlaylistCoverPicker } from '../src/features/library/PlaylistCoverPicker';
import { useProfiles } from '../src/state/profile';
import { Playlists, PlaylistDetail, AddToPlaylist } from '../src/pages/Playlists';
import { TrackList } from '../src/components/Common';
import { PlayerBar } from '../src/features/player/PlayerUI';
import { player, usePlayer } from '../src/features/player/engine';
import { Interactions } from '../src/components/Interactions';

let api: MusicApi; let client: QueryClient;
const song = { id:'s',title:'测试歌曲',artist:'测试歌手',artistId:'artist',album:'测试专辑',albumId:'album' };
beforeEach(() => {
  vi.stubGlobal('DragEvent', MouseEvent);
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this: HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this: HTMLDialogElement){this.open=false;}});
  api=new MusicApi('https://example.test','fixture','test'); useSession.getState().setSession(api); useSession.setState({ notice: '' });
  client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  client.setQueryData([api.identity,'libraries'],[{id:'1',name:'散歌'},{id:'2',name:'专辑'}]);
  client.setQueryData([api.identity,'playlists'],[{id:'p1',name:'华语',songCount:1,owner:'fixture'},{id:'p2',name:'日语',songCount:1,owner:'fixture'}]);
  client.setQueryData([api.identity,'favorites'],{songs:[],albums:[],artists:[]});
  useLibrary.setState({profiles:{[api.identity]:{...emptyLibraryProfile,activeId:'1',folders:[{id:'parent',name:'语言',libraryId:'1',parentId:null}],placements:{p2:{libraryId:'2',folderId:null}}}}});
});
afterEach(() => { cleanup();client.clear();api.dispose();useSession.getState().setSession(null);useLibrary.setState({profiles:{}});useProfiles.setState(useProfiles.getInitialState(), true);usePlayer.setState(usePlayer.getInitialState());vi.restoreAllMocks();vi.unstubAllGlobals();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close'); });
const surface=(child:React.ReactNode)=>render(<QueryClientProvider client={client}><MemoryRouter>{child}</MemoryRouter></QueryClientProvider>);
it('creates a nested folder and moves a playlist into that folder without server writes', () => {
  const request=vi.spyOn(api,'request'); const close=vi.fn(); const editor=surface(<FolderEditor parent="parent" onClose={close} />);
  fireEvent.change(screen.getByLabelText('名称'),{target:{value:'流行'}});fireEvent.click(screen.getByRole('button',{name:'保存'}));
  const folder=useLibrary.getState().profiles[api.identity].folders.find((f)=>f.name==='流行')!;expect(folder.parentId).toBe('parent');expect(close).toHaveBeenCalledOnce();editor.unmount();
  surface(<PlaylistLocation playlist={{id:'p1',name:'华语'}} onClose={()=>{}} />);fireEvent.click(screen.getByRole('combobox',{name:'歌单文件夹'}));fireEvent.click(screen.getByRole('option',{name:'语言 / 流行'}));fireEvent.click(screen.getByRole('button',{name:'移动'}));
  expect(useLibrary.getState().profiles[api.identity].placements.p1).toEqual({libraryId:'1',folderId:folder.id});expect(request).not.toHaveBeenCalled();
});
it('keeps the visible playlists independent when changing the active real library', () => {
  surface(<Playlists />);expect(screen.getByRole('link',{name:'华语'})).toBeInTheDocument();expect(screen.queryByRole('link',{name:'日语'})).not.toBeInTheDocument();
  act(()=>useLibrary.getState().change(api.identity,(p)=>({...p,activeId:'2'})));
  expect(screen.getByRole('link',{name:'日语'})).toBeInTheDocument();expect(screen.queryByRole('link',{name:'华语'})).not.toBeInTheDocument();
});
it('offers only editable playlists in the active library when adding a song', () => {
  surface(<AddToPlaylist track={song} onClose={()=>{}} />);expect(screen.getByRole('button',{name:'华语'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'日语'})).not.toBeInTheDocument();
});
it('plays a selected playlist entry with the remaining playlist order, including duplicates', () => {
  const replace=vi.spyOn(player,'replace').mockImplementation(()=>{});const tracks=[song,{...song,id:'second',title:'第二首'},song];
  surface(<TrackList tracks={tracks} />);fireEvent.click(screen.getByRole('button',{name:'播放 第二首'}));expect(replace).toHaveBeenCalledWith(tracks,1);
});
it('plays a row on a blank-area double click and exposes queue actions in a custom context menu', async () => {
  const replace = vi.spyOn(player, 'replace').mockImplementation(() => {}); const append = vi.spyOn(player, 'append').mockImplementation(() => {});
  surface(<Interactions><TrackList tracks={[song]} addToPlaylist={() => {}} /></Interactions>);
  const row = screen.getByRole('listitem'); fireEvent.doubleClick(within(row).getByText('0:00')); expect(replace).toHaveBeenCalledWith([song], 0);
  expect(within(row).getAllByRole('button')).toHaveLength(3);
  fireEvent.contextMenu(row, { clientX: 150, clientY: 150 }); fireEvent.click(screen.getByRole('menuitem', { name: '下一首播放' }));
  await waitFor(() => expect(append).toHaveBeenCalledWith([song], true)); expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});
it('silently saves a dragged playlist order including duplicates without an undo button', async () => {
  const songs = [song, { ...song, id: 'second', title: '第二首' }, song]; const before = { id: 'p1', name: '华语', owner: 'fixture', changed: 'v1', songs }; const after = { ...before, changed: 'v2', songs: [songs[1], songs[2], songs[0]] };
  client.setQueryData([api.identity, 'playlist', 'p1'], before); vi.spyOn(api, 'playlist').mockResolvedValue(before);
  const save = vi.spyOn(api, 'savePlaylist').mockResolvedValueOnce(after);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists/p1']}><Interactions><Routes><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={() => {}} />} /></Routes></Interactions></MemoryRouter></QueryClientProvider>);
  const rows = screen.getAllByRole('listitem'); const store = new Map(); const transfer = { types: ['application/x-tooku-track'], setData: (key: string, value: string) => store.set(key, value), getData: (key: string) => store.get(key) };
  fireEvent.dragStart(rows[0], { dataTransfer: transfer }); fireEvent.dragOver(rows[2], { dataTransfer: transfer, clientY: 10 }); fireEvent.drop(rows[2], { dataTransfer: transfer });
  await waitFor(() => expect(save).toHaveBeenCalledWith('p1', '华语', ['second', 's', 's'], 'v1'));
  await waitFor(() => expect(client.getQueryData([api.identity, 'playlist', 'p1'])).toEqual(after));
  expect(save).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '撤销上次修改' })).not.toBeInTheDocument();
  expect(useSession.getState().notice).toBe('');
});
it('keeps the saved order when a reorder fails and offers a readback without automatically retrying', async () => {
  const before = { id: 'p1', name: '华语', owner: 'fixture', changed: 'v1', songs: [song, { ...song, id: 'second', title: '第二首' }] };
  client.setQueryData([api.identity, 'playlist', 'p1'], before);
  const read = vi.spyOn(api, 'playlist').mockResolvedValue(before);
  const save = vi.spyOn(api, 'savePlaylist').mockRejectedValue(new Error('保存结果未知，请重新读取。'));
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists/p1']}><Interactions><Routes><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={() => {}} />} /></Routes></Interactions></MemoryRouter></QueryClientProvider>);
  fireEvent.contextMenu(screen.getAllByRole('listitem')[1]);
  fireEvent.click(screen.getByRole('menuitem', { name: '上移' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存结果未知');
  expect(client.getQueryData([api.identity, 'playlist', 'p1'])).toEqual(before);
  expect(save).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '重新读取服务器歌单' }));
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce(); expect(useSession.getState().notice).toBe('');
});
it('keeps another owner playlist read-only and creates folders at the current location without a location picker', () => {
  client.setQueryData([api.identity, 'playlist', 'p1'], { id: 'p1', name: '他人的歌单', owner: 'other', changed: 'v1', songs: [song] });
  const rendered = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists/p1']}><Routes><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={() => {}} />} /></Routes></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole('listitem')).toHaveAttribute('draggable', 'false'); expect(screen.getByRole('button', { name: '歌单封面（只读）' })).toBeDisabled(); rendered.unmount();
  surface(<FolderEditor parent="parent" onClose={() => {}} />); expect(screen.queryByRole('combobox', { name: '文件夹位置' })).not.toBeInTheDocument();
});

it('shows a lock and an explanation for an account without playlist editing permission', () => {
  client.setQueryData([api.identity, 'playlist', 'p1'], { id: 'p1', name: '共享歌单', owner: 'other', readonly: true, changed: 'v1', songs: [song] });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists/p1']}><Interactions><Routes><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={() => {}} />} /></Routes></Interactions></MemoryRouter></QueryClientProvider>);
  const badge = screen.getByText('只读歌单');
  expect(badge.querySelector('svg')).not.toBeNull();
  expect(badge).toHaveAttribute('data-tooltip', '当前账号没有编辑权限，仍可播放和浏览。');
  expect(screen.getByRole('button', { name: '歌单封面（只读）' })).toBeDisabled();
  expect(screen.getByRole('listitem')).toHaveAttribute('draggable', 'false');
  fireEvent.click(screen.getByRole('button', { name: '歌单选项' }));
  expect(screen.getByRole('menuitem', { name: '加入播放队列' })).toBeEnabled();
  expect(screen.queryByRole('menuitem', { name: '歌单信息与封面' })).not.toBeInTheDocument();
});

it('keeps server-managed tracks read-only while the owner can still edit metadata', () => {
  client.setQueryData([api.identity, 'playlist', 'p1'], { id: 'p1', name: '同步歌单', owner: 'fixture', readonly: true, changed: 'v1', songs: [song] });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists/p1']}><Interactions><Routes><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={() => {}} />} /></Routes></Interactions></MemoryRouter></QueryClientProvider>);
  expect(screen.getByText('自动维护歌单')).toHaveAttribute('data-tooltip', expect.stringContaining('请修改原文件后重新扫描'));
  expect(screen.getByRole('button', { name: '更换歌单封面' })).toBeEnabled();
  expect(screen.getByRole('listitem')).toHaveAttribute('draggable', 'false');
  fireEvent.click(screen.getByRole('button', { name: '歌单选项' }));
  expect(screen.getByRole('menuitem', { name: '歌单信息与封面' })).toBeEnabled();
});

it('defaults folders to open and retains folding across tree remounts and library changes', () => {
  const view = surface(<PlaylistTree closeNavigation={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '收起文件夹 语言' }));
  expect(useLibrary.getState().profiles[api.identity].collapsedFolders).toEqual(['parent']);
  view.unmount();
  surface(<PlaylistTree closeNavigation={() => {}} />);
  expect(screen.getByRole('button', { name: '展开文件夹 语言' })).toHaveAttribute('aria-expanded', 'false');
  act(() => useLibrary.getState().change(api.identity, (p) => ({ ...p, activeId: '2' })));
  expect(screen.queryByRole('button', { name: '展开文件夹 语言' })).not.toBeInTheDocument();
  act(() => useLibrary.getState().change(api.identity, (p) => ({ ...p, activeId: '1' })));
  fireEvent.click(screen.getByRole('button', { name: '展开文件夹 语言' }));
  expect(useLibrary.getState().profiles[api.identity].collapsedFolders).toBeUndefined();
  expect(screen.getByRole('button', { name: '收起文件夹 语言' })).toHaveAttribute('aria-expanded', 'true');
});
it('keeps folding usable and explains a browser storage failure', () => {
  surface(<PlaylistTree closeNavigation={() => {}} />);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  fireEvent.click(screen.getByRole('button', { name: '收起文件夹 语言' }));
  expect(screen.getByRole('button', { name: '展开文件夹 语言' })).toHaveAttribute('aria-expanded', 'false');
  expect(useSession.getState().notice).toBe('文件夹状态暂未保存到浏览器，刷新后可能恢复。');
});

it('keeps card and tree folder actions in context menus and uses / for creation at root', () => {
  const view = surface(<Interactions><Playlists /></Interactions>);
  expect(screen.queryByRole('button', { name: '管理文件夹 语言' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '歌单选项 华语' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '新建歌单' }));
  expect(screen.queryByText(/创建于/)).not.toBeInTheDocument();
  view.unmount();
  surface(<Interactions><PlaylistTree closeNavigation={() => {}} /></Interactions>);
  expect(screen.queryByRole('button', { name: '管理文件夹 语言' })).not.toBeInTheDocument();
  fireEvent.contextMenu(screen.getByRole('link', { name: '语言' }));
  expect(screen.getByRole('menuitem', { name: '管理文件夹' })).toBeEnabled();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '新建歌单' }));
  expect(screen.getByRole('combobox', { name: '新歌单文件夹' })).toHaveTextContent('/');
  fireEvent.click(screen.getByRole('combobox', { name: '新歌单文件夹' }));
  expect(screen.getByRole('option', { name: '/' })).toBeInTheDocument();
  expect(screen.queryByText('根目录（留空）')).not.toBeInTheDocument();
});
it('links the dock title and artist separately and keeps only the full-player expansion control', () => {
  usePlayer.setState({entries:[{entryId:'e',track:song}],currentId:'e'});surface(<PlayerBar openQueue={()=>{}} openLyrics={()=>{}} />);
  expect(screen.getByRole('link',{name:'测试歌曲'})).toHaveAttribute('href','/albums/album');expect(screen.getByRole('link',{name:'测试歌手'})).toHaveAttribute('href','/artists/artist');
  expect(screen.queryByRole('button',{name:'展开歌词播放器'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'展开完整播放器'})).toBeInTheDocument();
});

it('disables management-grid dragging and keeps its content free of guidance text', () => {
  const { container } = surface(<Playlists />);
  expect(container.querySelector('[draggable=true]')).toBeNull();
  expect(container.querySelector('.organization-grid p')).toBeNull();
  expect(screen.queryByText(/拖动排序|移入文件夹|可拖到这里/)).not.toBeInTheDocument();
  expect(fireEvent.dragStart(screen.getByRole('link', { name: '华语' }))).toBe(false);
});

it('uses compact internal-only drags for the tree, with folder and root drops', () => {
  const { container } = surface(<PlaylistTree closeNavigation={() => {}} />);
  const source = screen.getByRole('link', { name: '华语' });
  const folder = container.querySelector('.tree-folder-heading');
  if (!folder) throw new Error('缺少文件夹');
  vi.spyOn(folder, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40, toJSON: () => ({}) });
  const store = new Map<string, string>([['text/uri-list', 'https://example.test/playlists/p1']]);
  const transfer = { get types() { return [...store.keys()]; }, clearData: vi.fn(() => store.clear()), setData: (key: string, value: string) => store.set(key, value), getData: (key: string) => store.get(key), setDragImage: vi.fn() };
  fireEvent.dragStart(source, { dataTransfer: transfer });
  expect([...store.keys()]).toEqual(['application/x-tooku-library-item']);
  const preview = transfer.setDragImage.mock.calls[0]?.[0];
  expect(preview).toHaveTextContent('华语');
  fireEvent.dragOver(folder, { dataTransfer: transfer, clientY: 20 });
  expect(folder).toHaveAttribute('data-drop', 'inside');
  fireEvent.drop(folder, { dataTransfer: transfer });
  expect(useLibrary.getState().profiles[api.identity].placements.p1.folderId).toBe('parent');
  expect(preview).not.toBeInTheDocument();
  const nested = screen.getByRole('link', { name: '华语' });
  fireEvent.dragStart(nested, { dataTransfer: transfer });
  const root = container.querySelector('.tree-root-drop');
  if (!root) throw new Error('缺少根目录落点');
  fireEvent.dragOver(root, { dataTransfer: transfer });
  expect(root).toHaveAttribute('data-drop', 'after');
  fireEvent.drop(root, { dataTransfer: transfer });
  expect(useLibrary.getState().profiles[api.identity].placements.p1.folderId).toBeNull();
});

it('sorts sidebar playlists using an insertion line without changing their folder', () => {
  useLibrary.getState().place(api.identity, 'p2', '1', null);
  surface(<PlaylistTree closeNavigation={() => {}} />);
  const first = screen.getByRole('link', { name: '华语' });
  const second = screen.getByRole('link', { name: '日语' });
  vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40, toJSON: () => ({}) });
  const store = new Map<string, string>();
  const transfer = { types: ['application/x-tooku-library-item'], setData: (key: string, value: string) => store.set(key, value), getData: (key: string) => store.get(key) };
  fireEvent.dragStart(second, { dataTransfer: transfer });
  fireEvent.dragOver(first, { dataTransfer: transfer, clientY: 2 });
  expect(first).toHaveAttribute('data-drop', 'before');
  fireEvent.drop(first, { dataTransfer: transfer });
  const profile = useLibrary.getState().profiles[api.identity];
  expect(profile.order?.[orderKey('1', null)]).toEqual(['folder:parent', 'playlist:p2', 'playlist:p1']);
  expect(profile.placements.p2.folderId).toBeNull();
});

it('opens the direct cover cropper, saves only this account cover and restores focus', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 640, height: 640, close: vi.fn() }));
  const context = { clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(), restore: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const image = 'data:image/png;base64,AA==';
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(image);
  const metadata = vi.spyOn(api, 'updatePlaylistDetails');
  surface(<PlaylistCoverPicker playlist={{ id: 'p1', name: '华语' }} editable disabled={false} />);
  const picture = screen.getByRole('button', { name: '更换歌单封面' }); picture.focus();
  fireEvent.change(screen.getByLabelText('上传歌单封面'), { target: { files: [new File(['fixture'], 'cover.png', { type: 'image/png' })] } });
  await screen.findByRole('dialog', { name: '编辑封面' });
  await waitFor(() => expect(screen.getByRole('button', { name: '使用封面' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '使用封面' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(useProfiles.getState().playlistCovers[api.identity]?.p1).toBe(image);
  expect(picture).toHaveFocus(); expect(metadata).not.toHaveBeenCalled();
  vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue('data:image/png;base64,AQ==');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  fireEvent.change(screen.getByLabelText('上传歌单封面'), { target: { files: [new File(['replacement'], 'replacement.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '使用封面' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '使用封面' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('封面未能保存');
  expect(useProfiles.getState().playlistCovers[api.identity]?.p1).toBe(image);
  expect(picture.querySelector('img')).toHaveAttribute('src', image);
});

it('retains the detail editor in the playlist menu without persistent reorder hints', async () => {
  client.setQueryData([api.identity, 'playlist', 'p1'], { id: 'p1', name: '华语', owner: 'fixture', duration: 4980, changed: 'v1', songs: [song] });
  const { container } = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists/p1']}><Interactions><Routes><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={() => {}} />} /></Routes></Interactions></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole('button', { name: '更换歌单封面' })).toBeEnabled();
  expect(container.querySelector('.playlist-summary')).toHaveTextContent('约 1 小时');
  expect(container.querySelector('.playlist-summary')).not.toHaveTextContent('分钟');
  expect(screen.queryByText('拖动歌曲调整顺序')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '歌单选项' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '歌单信息与封面' }));
  expect(await screen.findByRole('dialog', { name: '歌单信息' })).toBeInTheDocument();
  expect(screen.getByLabelText('名称')).toHaveValue('华语');
});
