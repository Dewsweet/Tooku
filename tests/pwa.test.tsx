import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearPwaCaches, usePwa } from '../src/pwa';
import { PwaUpdatePrompt } from '../src/components/PwaUpdatePrompt';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); usePwa.setState({ updateAvailable: false }); });

it('declares an installable standalone app with the shared Tooku mark', () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>;
  expect(manifest).toMatchObject({ name: 'Tooku 音乐播放器', start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest.icons).toEqual([{ src: '/tooku.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]);
});

it('keeps the service-worker allowlist limited to the app shell and versioned build assets', () => {
  const worker = readFileSync(join(process.cwd(), 'src', 'pwa', 'service-worker.js'), 'utf8');
  expect(worker).toContain("pathname.startsWith('/assets/')");
  expect(worker).toContain("pathname === '/tooku.svg'");
  expect(worker).toContain("if (!cacheableStaticPath(url.pathname)) return");
  expect(worker).toContain('__TOOKU_CACHE_VERSION__');
  expect(worker).toContain('__TOOKU_PRECACHE__');
  expect(worker).not.toMatch(/cacheableStaticPath[^\n]+\/(?:api|nd|rest|tooku-stream)\//);
});

it('clears only Tooku app-shell caches', async () => {
  const remove = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['tooku-shell-old', 'another-app']), delete: remove });
  await expect(clearPwaCaches()).resolves.toBe(1);
  expect(remove).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith('tooku-shell-old');
});

it('shows a dismissible update action without replacing the workspace', () => {
  usePwa.setState({ updateAvailable: true }); render(<PwaUpdatePrompt />);
  expect(screen.getByText('Tooku 已有新版本')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '稍后' }));
  expect(screen.queryByText('Tooku 已有新版本')).not.toBeInTheDocument();
});
