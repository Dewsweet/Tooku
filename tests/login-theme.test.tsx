import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { usePreferences } from '../src/state/preferences';
import { useSession } from '../src/state/session';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => {
  cleanup(); client.clear();
  usePreferences.setState(usePreferences.getInitialState());
  useSession.getState().setSession(null);
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-motion');
  ['--accent-base', '--ui-font-family', '--ui-font-scale'].forEach((name) => document.documentElement.style.removeProperty(name));
  vi.unstubAllGlobals();
});

it('keeps login light without overwriting the saved dark preference, even when appearance changes', () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)', media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  useSession.getState().setSession(null);
  usePreferences.getState().update({ theme: 'dark' });
  document.documentElement.dataset.theme = 'dark';
  render(<StrictMode><QueryClientProvider client={client}><MemoryRouter><App /></MemoryRouter></QueryClientProvider></StrictMode>);

  expect(screen.getByRole('heading', { name: '登录音乐库' })).toBeVisible();
  expect(screen.getByText('Navidrome 第三方音乐播放器')).toBeVisible();
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  expect(document.documentElement.style.getPropertyValue('--accent-base')).toBe('#24252b');
  act(() => usePreferences.getState().update({ accent: '#3365c4' }));
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  expect(document.documentElement.style.getPropertyValue('--accent-base')).toBe('#24252b');
  expect(usePreferences.getState().theme).toBe('dark');
  expect(usePreferences.getState().accent).toBe('#3365c4');
  expect(JSON.parse(localStorage.getItem('tooku-preferences') ?? '{}').state.theme).toBe('dark');
});
