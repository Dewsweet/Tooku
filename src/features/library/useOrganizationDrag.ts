import { useEffect, useRef, useState, type DragEvent } from 'react';
import { libraryItems, moveLibraryItem, useLibrary, useMusicLibrary, type LibraryItem } from '../../state/library';
import { useApi } from '../../components/Common';
import type { Playlist } from '../../domain/models';
import { useSession } from '../../state/session';
import { startInternalDrag } from '../../components/dragPreview';

const MIME = 'application/x-tooku-library-item';
export function useOrganizationDrag(playlists: Playlist[]) {
  const api = useApi(); const { libraryId = '', defaultId = '', profile } = useMusicLibrary();
  const source = useRef<string | null>(null); const [over, setOver] = useState<{ key: string; position: string } | null>(null);
  const releasePreview = useRef<(() => void) | null>(null);
  useEffect(() => { setOver(null); return () => { source.current = null; releasePreview.current?.(); }; }, [api.identity, libraryId]);
  const hover = (key: string, position: string) => setOver((previous) => previous?.key === key && previous.position === position ? previous : { key, position });
  const valid = (e: DragEvent) => Boolean(source.current && e.dataTransfer.types.includes(MIME));
  const finish = (parent: string | null, before: string | null) => {
    if (!source.current) return;
    const key = source.current; useLibrary.getState().change(api.identity, (current) => {
      const next = moveLibraryItem(current, playlists, key, libraryId, parent, before, defaultId);
      if (next === current && key !== before) useSession.getState().notify('无法移到这里，请检查同名文件夹或父子关系。'); return next;
    }); source.current = null; setOver(null); releasePreview.current?.();
  };
  function row(item: LibraryItem, parent: string | null) {
    return { draggable: true, 'data-drop': over?.key === item.key ? over.position : undefined,
      onDragStart: (e: DragEvent) => { e.stopPropagation(); source.current = item.key; releasePreview.current?.(); releasePreview.current = startInternalDrag(e.dataTransfer, MIME, item.key, item.kind === 'folder' ? item.folder.name : item.playlist.name); },
      onDragEnd: () => { source.current = null; setOver(null); releasePreview.current?.(); },
      onDragOver: (e: DragEvent) => { if (!valid(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; const box = e.currentTarget.getBoundingClientRect(); const fraction = box.height ? (e.clientY - box.top) / box.height : .5; hover(item.key, item.kind === 'folder' && fraction > .25 && fraction < .75 ? 'inside' : fraction < .5 ? 'before' : 'after'); },
      onDrop: (e: DragEvent) => { if (!valid(e) || e.dataTransfer.getData(MIME) !== source.current) return; e.preventDefault(); e.stopPropagation(); const position = over?.key === item.key ? over.position : 'inside'; if (position === 'inside' && item.kind === 'folder') finish(item.folder.id, null); else { const siblings = libraryItems(profile, playlists, libraryId, parent, defaultId); const index = siblings.findIndex((s) => s.key === item.key); finish(parent, position === 'before' ? item.key : siblings[index + 1]?.key ?? null); } },
    };
  }
  function area(parent: string | null) { const key = `area:${parent ?? 'root'}`; return { 'data-drop': over?.key === key ? 'after' : undefined,
    onDragOver: (e: DragEvent) => { if (!valid(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; hover(key, 'after'); },
    onDrop: (e: DragEvent) => { if (!valid(e) || e.dataTransfer.getData(MIME) !== source.current) return; e.preventDefault(); e.stopPropagation(); finish(parent, null); },
  }; }
  return { row, area };
}
