import { useRef, useState, type DragEvent } from 'react';
import { libraryItems, moveLibraryItem, useLibrary, useMusicLibrary, type LibraryItem } from '../../state/library';
import { useApi } from '../../components/Common';
import type { Playlist } from '../../domain/models';
import { useSession } from '../../state/session';

const MIME = 'application/x-tooku-library-item';
export function useOrganizationDrag(playlists: Playlist[]) {
  const api = useApi(); const { libraryId = '', defaultId = '', profile } = useMusicLibrary();
  const source = useRef<string | null>(null); const [over, setOver] = useState<{ key: string; position: string } | null>(null);
  const valid = (e: DragEvent) => Boolean(source.current && e.dataTransfer.types.includes(MIME));
  const finish = (parent: string | null, before: string | null) => {
    if (!source.current) return;
    const key = source.current; useLibrary.getState().change(api.identity, (current) => {
      const next = moveLibraryItem(current, playlists, key, libraryId, parent, before, defaultId);
      if (next === current && key !== before) useSession.getState().notify('无法移到这里，请检查同名文件夹或父子关系。'); return next;
    }); source.current = null; setOver(null);
  };
  function row(item: LibraryItem, parent: string | null) {
    return { draggable: true, 'data-drop': over?.key === item.key ? over.position : undefined,
      onDragStart: (e: DragEvent) => { e.stopPropagation(); source.current = item.key; e.dataTransfer.setData(MIME, item.key); e.dataTransfer.effectAllowed = 'move'; },
      onDragEnd: () => { source.current = null; setOver(null); },
      onDragOver: (e: DragEvent) => { if (!valid(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; const box = e.currentTarget.getBoundingClientRect(); const fraction = (e.clientY - box.top) / box.height; setOver({ key: item.key, position: item.kind === 'folder' && fraction > .25 && fraction < .75 ? 'inside' : fraction < .5 ? 'before' : 'after' }); },
      onDrop: (e: DragEvent) => { if (!valid(e) || e.dataTransfer.getData(MIME) !== source.current) return; e.preventDefault(); e.stopPropagation(); const position = over?.key === item.key ? over.position : 'inside'; if (position === 'inside' && item.kind === 'folder') finish(item.folder.id, null); else { const siblings = libraryItems(profile, playlists, libraryId, parent, defaultId); const index = siblings.findIndex((s) => s.key === item.key); finish(parent, position === 'before' ? item.key : siblings[index + 1]?.key ?? null); } },
    };
  }
  function area(parent: string | null) { const key = `area:${parent ?? 'root'}`; return { 'data-drop': over?.key === key ? 'inside' : undefined,
    onDragOver: (e: DragEvent) => { if (!valid(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver({ key, position: 'inside' }); },
    onDrop: (e: DragEvent) => { if (!valid(e) || e.dataTransfer.getData(MIME) !== source.current) return; e.preventDefault(); e.stopPropagation(); finish(parent, null); },
  }; }
  return { row, area };
}
