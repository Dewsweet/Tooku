import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { Login } from '../src/pages/Login';
import { useSession } from '../src/state/session';
import { player } from '../src/features/player/engine';
import * as sync from '../src/storage/userSync';
import { enterWorkspace } from '../src/features/session/enterWorkspace';

vi.mock('../src/features/session/enterWorkspace', () => ({ enterWorkspace: vi.fn(async (commit: () => void) => commit()) }));
beforeEach(() => {
  useSession.setState({ api: null, version: '', notice: '' });
  vi.spyOn(MusicApi.prototype, 'connect').mockResolvedValue('fixture-version');
  vi.spyOn(sync, 'connectUserSync').mockResolvedValue();
  vi.spyOn(sync, 'disconnectUserSync').mockImplementation(() => {});
  vi.spyOn(player, 'attach').mockResolvedValue();
});
afterEach(() => {
  cleanup(); useSession.getState().api?.dispose(); useSession.setState({ api: null, version: '', notice: '' }); vi.restoreAllMocks();
});
function form() {
  render(<Login />);
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: ' fixture ' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } });
  const form = document.querySelector('form'); if (!form) throw new Error('Missing login form'); return form;
}

it('shows an HTTP(S) address and waits for connection, recovery and player attachment before transitioning', async () => {
  const login = form();
  expect(screen.getByLabelText('服务器地址')).toHaveValue(window.location.origin);
  expect(screen.getByLabelText('服务器地址')).toHaveAttribute('placeholder', 'https://music.example.com');
  fireEvent.submit(login);
  await waitFor(() => expect(enterWorkspace).toHaveBeenCalledTimes(1));
  expect(sync.connectUserSync).toHaveBeenCalledTimes(1); expect(player.attach).toHaveBeenCalledTimes(1);
  expect(vi.mocked(enterWorkspace).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(player.attach).mock.invocationCallOrder[0]);
  expect(vi.mocked(player.attach).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(sync.connectUserSync).mock.invocationCallOrder[0]);
  expect(useSession.getState().api?.base).toBe(`${window.location.origin}/nd`);
  expect(useSession.getState().api?.username).toBe('fixture');
  expect(screen.getByLabelText('密码')).toHaveValue('');
});

it('locks the form and ignores repeated submissions while connecting', async () => {
  let resolve: (version: string) => void = () => {};
  vi.mocked(MusicApi.prototype.connect).mockReturnValue(new Promise<string>((done) => { resolve = done; }));
  const login = form(); fireEvent.submit(login); fireEvent.submit(login);
  expect(MusicApi.prototype.connect).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('服务器地址')).toBeDisabled();
  expect(screen.getByRole('button', { name: '正在连接…' })).toBeDisabled();
  expect(enterWorkspace).not.toHaveBeenCalled();
  resolve('fixture-version');
  await waitFor(() => expect(enterWorkspace).toHaveBeenCalledTimes(1));
});

it('keeps a failed login on the form without starting a transition', async () => {
  vi.mocked(MusicApi.prototype.connect).mockRejectedValue(new Error('测试连接失败'));
  const dispose = vi.spyOn(MusicApi.prototype, 'dispose');
  fireEvent.submit(form());
  expect(await screen.findByRole('alert')).toHaveTextContent('测试连接失败');
  expect(screen.getByRole('button', { name: '进入音乐库' })).toBeEnabled();
  expect(enterWorkspace).not.toHaveBeenCalled(); expect(player.attach).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1); expect(useSession.getState().api).toBeNull();
});
