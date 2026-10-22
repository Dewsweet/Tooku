import { flushSync } from 'react-dom';
import { usePreferences } from '../../state/preferences';
import './login-transition.css';

/** Only the session/DOM handoff is captured; authentication and recovery finish first. */
export async function enterWorkspace(commit: () => void) {
  let committed = false;
  const update = () => {
    if (committed) return;
    committed = true;
    flushSync(commit);
  };
  const focusWorkspace = () => document.getElementById('workspace-content')?.focus({ preventScroll: true });
  const reduced = usePreferences.getState().reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced || document.visibilityState === 'hidden') {
    update(); focusWorkspace(); return;
  }

  const root = document.documentElement;
  root.classList.add('login-transition');
  try {
    const transition = document.startViewTransition(update);
    // A skipped snapshot (for example after switching tabs) must not cancel login.
    void transition.ready.catch(() => {});
    await transition.updateCallbackDone.catch(update);
    await transition.finished.catch(() => {});
  } catch {
    update();
  } finally {
    root.classList.remove('login-transition');
    focusWorkspace();
  }
}
