import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UserDataSettings } from '../src/features/settings/UserDataSettings';
import { chooseUserData, localUserData, useUserSync } from '../src/storage/userSync';
import type { UserData } from '../src/domain/userData';

vi.mock('../src/storage/userSync', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/storage/userSync')>(),
  localUserData: vi.fn(), syncOwner: vi.fn(() => 'synthetic-owner'), chooseUserData: vi.fn(async () => {}),
}));
const local: UserData = {
  version: 1,
  preferences: { theme: 'light', accent: '#123456', sidePanel: true, panelWidth: 328, trackColumns: [2.8, 1.5, 1.8, .6], panelSections: [], lyricSize: 30, lyricDelay: 0, reducedMotion: false, shortcuts: true },
  profile: { playlistCovers: {} }, organization: { folders: [], placements: {}, views: {} }, queue: null, history: [],
};
const remote: UserData = { ...local, preferences: { ...local.preferences, theme: 'dark' } };

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.mocked(localUserData).mockReturnValue(local);
  useUserSync.setState({ status: 'review', message: '请选择要保留的数据', remote: { revision: 3, updatedAt: 1, data: remote }, identity: 'synthetic' });
});
afterEach(() => {
  cleanup(); vi.clearAllMocks();
  useUserSync.setState(useUserSync.getInitialState());
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

it('explains browser-to-server replacement and waits for explicit confirmation', async () => {
  render(<UserDataSettings />);
  fireEvent.click(screen.getByRole('button', { name: '保存到服务器' }));
  const modal = within(screen.getByRole('dialog', { name: '用此浏览器数据覆盖服务器' }));
  expect(modal.getByText(/覆盖服务器和此浏览器/)).toBeVisible();
  expect(chooseUserData).not.toHaveBeenCalled();
  fireEvent.click(modal.getByRole('button', { name: '确认覆盖并同步' }));
  await waitFor(() => expect(chooseUserData).toHaveBeenCalledWith('local', local));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('explains server-to-browser recovery and preserves its existing read-before-apply path', async () => {
  render(<UserDataSettings />);
  fireEvent.click(screen.getByRole('button', { name: '从服务器恢复' }));
  const modal = within(screen.getByRole('dialog', { name: '从服务器恢复到此浏览器' }));
  expect(modal.getByText(/服务器数据保持不变/)).toBeVisible();
  expect(chooseUserData).not.toHaveBeenCalled();
  fireEvent.click(modal.getByRole('button', { name: '确认恢复到此浏览器' }));
  await waitFor(() => expect(chooseUserData).toHaveBeenCalledWith('server', undefined));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
