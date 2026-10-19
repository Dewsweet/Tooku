import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MusicApi } from '../src/api/client';
import { useSession } from '../src/state/session';
import { emptyLibraryProfile, useLibrary } from '../src/state/library';
import { FolderEditor, PlaylistLocation } from '../src/features/library/Organization';
import { Playlists, PlaylistDetail, AddToPlaylist } from '../src/pages/Playlists';
import { TrackList } from '../src/components/Common';
import { PlayerBar } from '../src/features/player/PlayerUI';
import { player, usePlayer } from '../src/features/player/engine';
import { Interactions } from '../src/components/Interactions';

let api: MusicApi; let client: QueryClient;
const song = { id:'s',title:'测试歌曲',artist:'测试歌手',artistId:'artist',album:'测试专辑',albumId:'album' };
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this: HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this: HTMLDialogElement){this.open=false;}});
  api=new MusicApi('https://example.test','fixture','test'); useSession.getState().setSession(api);
  client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  client.setQueryData([api.identity,'libraries'],[{id:'1',name:'散歌'},{id:'2',name:'专辑'}]);
  client.setQueryData([api.identity,'playlists'],[{id:'p1',name:'华语',songCount:1,owner:'fixture'},{id:'p2',name:'日语',songCount:1,owner:'fixture'}]);
  client.setQueryData([api.identity,'favorites'],{songs:[],albums:[],artists:[]});
  useLibrary.setState({profiles:{[api.identity]:{...emptyLibraryProfile,activeId:'1',folders:[{id:'parent',name:'语言',libraryId:'1',parentId:null}],placements:{p2:{libraryId:'2',folderId:null}}}}});
});
afterEach(() => { cleanup();client.clear();api.dispose();useSession.getState().setSession(null);useLibrary.setState({profiles:{}});usePlayer.setState(usePlayer.getInitialState());vi.restoreAllMocks();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close'); });
const surface=(child:React.ReactNode)=>render(<QueryClientProvider client={client}><MemoryRouter>{child}</MemoryRouter></QueryClientProvider>);
it('creates a nested folder and moves a playlist into that folder without server writes', () => {
  const request=vi.spyOn(api,'request'); const close=vi.fn(); const editor=surface(<FolderEditor parent="parent" onClose={close} />);
  fireEvent.change(screen.getByLabelText('名称'),{target:{value:'流行'}});fireEvent.click(screen.getByRole('button',{name:'保存'}));
  const folder=useLibrary.getState().profiles[api.identity].folders.find((f)=>f.name==='流行')!;expect(folder.parentId).toBe('parent');expect(close).toHaveBeenCalledOnce();editor.unmount();
  surface(<PlaylistLocation playlist={{id:'p1',name:'华语'}} onClose={()=>{}} />);fireEvent.click(screen.getByRole('combobox',{name:'歌单文件夹'}));fireEvent.click(screen.getByRole('option',{name:'语言 / 流行'}));fireEvent.click(screen.getByRole('button',{name:'移动'}));
  expect(useLibrary.getState().profiles[api.identity].placements.p1).toEqual({libraryId:'1',folderId:folder.id});expect(request).not.toHaveBeenCalled();
});
it('keeps the visible playlists independent when changing the active real library', () => {
  surface(<Playlists />);expect(screen.getByRole('link',{name:'华语 1 首'})).toBeInTheDocument();expect(screen.queryByRole('link',{name:'日语 1 首'})).not.toBeInTheDocument();
  act(()=>useLibrary.getState().change(api.identity,(p)=>({...p,activeId:'2'})));
  expect(screen.getByRole('link',{name:'日语 1 首'})).toBeInTheDocument();expect(screen.queryByRole('link',{name:'华语 1 首'})).not.toBeInTheDocument();
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
it('saves a dragged playlist order including duplicates and can undo the saved change', async () => {
  const songs = [song, { ...song, id: 'second', title: '第二首' }, song]; const before = { id: 'p1', name: '华语', owner: 'fixture', changed: 'v1', songs }; const after = { ...before, changed: 'v2', songs: [songs[1], songs[2], songs[0]] };
  client.setQueryData([api.identity, 'playlist', 'p1'], before); vi.spyOn(api, 'playlist').mockResolvedValue(before);
  const save = vi.spyOn(api, 'savePlaylist').mockResolvedValueOnce(after).mockResolvedValueOnce({ ...before, changed: 'v3' });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists/p1']}><Interactions><Routes><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={() => {}} />} /></Routes></Interactions></MemoryRouter></QueryClientProvider>);
  const rows = screen.getAllByRole('listitem'); const store = new Map(); const transfer = { types: ['application/x-tooku-track'], setData: (key: string, value: string) => store.set(key, value), getData: (key: string) => store.get(key) };
  fireEvent.dragStart(rows[0], { dataTransfer: transfer }); fireEvent.dragOver(rows[2], { dataTransfer: transfer, clientY: 10 }); fireEvent.drop(rows[2], { dataTransfer: transfer });
  await waitFor(() => expect(save).toHaveBeenCalledWith('p1', '华语', ['second', 's', 's'], 'v1'));
  fireEvent.click(await screen.findByRole('button', { name: '撤销上次修改' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith('p1', '华语', ['s', 'second', 's'], 'v2'));
});
it('keeps another owner playlist read-only and creates folders at the current location without a location picker', () => {
  client.setQueryData([api.identity, 'playlist', 'p1'], { id: 'p1', name: '他人的歌单', owner: 'other', changed: 'v1', songs: [song] });
  const rendered = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/playlists/p1']}><Routes><Route path="/playlists/:id" element={<PlaylistDetail addToPlaylist={() => {}} />} /></Routes></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole('listitem')).toHaveAttribute('draggable', 'false'); expect(screen.getByRole('button', { name: '歌单封面' })).toBeDisabled(); rendered.unmount();
  surface(<FolderEditor parent="parent" onClose={() => {}} />); expect(screen.queryByRole('combobox', { name: '文件夹位置' })).not.toBeInTheDocument();
});
it('links the dock title and artist separately and keeps only the full-player expansion control', () => {
  usePlayer.setState({entries:[{entryId:'e',track:song}],currentId:'e'});surface(<PlayerBar openQueue={()=>{}} openLyrics={()=>{}} />);
  expect(screen.getByRole('link',{name:'测试歌曲'})).toHaveAttribute('href','/albums/album');expect(screen.getByRole('link',{name:'测试歌手'})).toHaveAttribute('href','/artists/artist');
  expect(screen.queryByRole('button',{name:'展开歌词播放器'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'展开完整播放器'})).toBeInTheDocument();
});
