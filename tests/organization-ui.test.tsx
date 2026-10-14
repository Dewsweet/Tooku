import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MusicApi } from '../src/api/client';
import { useSession } from '../src/state/session';
import { emptyLibraryProfile, useLibrary } from '../src/state/library';
import { FolderEditor, PlaylistLocation } from '../src/features/library/Organization';
import { Playlists, AddToPlaylist } from '../src/pages/Playlists';
import { TrackList } from '../src/components/Common';
import { PlayerBar } from '../src/features/player/PlayerUI';
import { player, usePlayer } from '../src/features/player/engine';

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
  surface(<PlaylistLocation playlist={{id:'p1',name:'华语'}} onClose={()=>{}} />);fireEvent.change(screen.getByLabelText('歌单文件夹'),{target:{value:folder.id}});fireEvent.click(screen.getByRole('button',{name:'移动'}));
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
it('links the dock title and artist separately and keeps only the full-player expansion control', () => {
  usePlayer.setState({entries:[{entryId:'e',track:song}],currentId:'e'});surface(<PlayerBar openQueue={()=>{}} openLyrics={()=>{}} />);
  expect(screen.getByRole('link',{name:'测试歌曲'})).toHaveAttribute('href','/albums/album');expect(screen.getByRole('link',{name:'测试歌手'})).toHaveAttribute('href','/artists/artist');
  expect(screen.queryByRole('button',{name:'展开歌词播放器'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'展开完整播放器'})).toBeInTheDocument();
});
