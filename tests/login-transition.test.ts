import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enterWorkspace } from '../src/features/session/enterWorkspace';
import { usePreferences } from '../src/state/preferences';

const originalStart = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
beforeEach(() => {
  usePreferences.setState(usePreferences.getInitialState());
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Reflect.deleteProperty(document, 'startViewTransition');
  const main = document.createElement('main'); main.id = 'workspace-content'; main.tabIndex = -1; document.body.append(main);
});
afterEach(() => {
  document.getElementById('workspace-content')?.remove();
  document.documentElement.classList.remove('login-transition');
  for (const [key, descriptor] of [['startViewTransition', originalStart], ['visibilityState', originalVisibility]] as const) {
    if (descriptor) Object.defineProperty(document, key, descriptor); else Reflect.deleteProperty(document, key);
  }
  usePreferences.setState(usePreferences.getInitialState()); localStorage.clear(); vi.unstubAllGlobals();
});
function setTransition(start: (update: () => void) => unknown) {
  const mock = vi.fn(start); Object.defineProperty(document, 'startViewTransition', { configurable: true, value: mock }); return mock;
}

it('hands off once, keeps shared-element styling until the transition finishes, then focuses the workspace', async () => {
  let finish = () => {};
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  setTransition((update) => ({ ready: Promise.resolve(), updateCallbackDone: Promise.resolve().then(() => { update(); update(); }), finished }));
  const commit = vi.fn(); const completion = enterWorkspace(commit);
  await Promise.resolve();
  expect(commit).toHaveBeenCalledTimes(1);
  expect(document.documentElement).toHaveClass('login-transition');
  finish(); await completion;
  expect(document.documentElement).not.toHaveClass('login-transition');
  expect(document.getElementById('workspace-content')).toHaveFocus();
});

it('enters immediately when the browser does not support view transitions', async () => {
  const commit = vi.fn(); await enterWorkspace(commit);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(document.getElementById('workspace-content')).toHaveFocus();
});

it.each(['app', 'system', 'hidden'])('skips animation for %s while preserving the session handoff', async (reason) => {
  const start = setTransition(() => { throw new Error('Animation should not start'); });
  if (reason === 'app') usePreferences.setState({ reducedMotion: true });
  if (reason === 'system') vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  if (reason === 'hidden') Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const commit = vi.fn(); await enterWorkspace(commit);
  expect(start).not.toHaveBeenCalled(); expect(commit).toHaveBeenCalledTimes(1);
});

it('falls back and cleans up when snapshot setup throws', async () => {
  setTransition(() => { throw new Error('Snapshot unavailable'); });
  const commit = vi.fn(); await enterWorkspace(commit);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(document.documentElement).not.toHaveClass('login-transition');
});

it('does not lose the handoff when a transition is rejected before its callback runs', async () => {
  setTransition(() => ({ ready: Promise.reject(new Error('Skipped')), updateCallbackDone: Promise.reject(new Error('Skipped')), finished: Promise.resolve() }));
  const commit = vi.fn(); await enterWorkspace(commit);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(document.documentElement).not.toHaveClass('login-transition');
});

it('does not replay a committed login if finishing the animation fails', async () => {
  setTransition((update) => ({ ready: Promise.resolve(), updateCallbackDone: Promise.resolve().then(update), finished: Promise.reject(new Error('Interrupted')) }));
  const commit = vi.fn(); await enterWorkspace(commit);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(document.documentElement).not.toHaveClass('login-transition');
});
