import { useSyncExternalStore } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { IconButton } from '../../components/Common';
import { useSession } from '../../state/session';

const subscribe = (changed: () => void) => {
  document.addEventListener('fullscreenchange', changed);
  return () => document.removeEventListener('fullscreenchange', changed);
};
const snapshot = () => Boolean(document.fullscreenElement);

export function FullscreenButton({ disabled = false, openPlayer }: { disabled?: boolean; openPlayer?: () => void }) {
  const active = useSyncExternalStore(subscribe, snapshot, () => false);
  const supported = typeof document.documentElement.requestFullscreen === 'function' && typeof document.exitFullscreen === 'function';
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        const focused = document.activeElement;
        // The root keeps native dialogs and their popovers in the fullscreen tree.
        const request = document.documentElement.requestFullscreen();
        openPlayer?.();
        await request;
        // Fullscreen adds the root to the top layer after an already-open dialog.
        // Re-promote existing dialogs in order, keeping their DOM and React state.
        if (document.fullscreenElement === document.documentElement) {
          for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog.modal[open]')) { dialog.close(); dialog.showModal(); }
          if (focused instanceof HTMLElement && focused.isConnected && focused.closest('dialog[open]')) focused.focus({ preventScroll: true });
        }
      }
    } catch {
      useSession.getState().notify('无法切换全屏，请重试');
    }
  }
  return <IconButton label={active ? '退出全屏' : '进入全屏'} aria-pressed={active} disabled={disabled || !supported} onClick={toggle}>
    {active ? <Minimize size={20} /> : <Maximize size={20} />}
  </IconButton>;
}
