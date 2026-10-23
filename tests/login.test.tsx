import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import * as connectionApi from '../src/api/client';
import { Login } from '../src/pages/Login';
import { useSession } from '../src/state/session';
import { player } from '../src/features/player/engine';
import * as sync from '../src/storage/userSync';
import { enterWorkspace } from '../src/features/session/enterWorkspace';

vi.mock('../src/features/session/enterWorkspace', () => ({ enterWorkspace: vi.fn(async (commit: () => void) => commit()) }));
beforeEach(() => {
  localStorage.clear();
  useSession.setState({ api: null, version: '', notice: '' });
  vi.spyOn(MusicApi.prototype, 'prepare').mockResolvedValue();
  vi.spyOn(MusicApi.prototype, 'connect').mockResolvedValue('fixture-version');
  vi.spyOn(sync, 'connectUserSync').mockResolvedValue();
  vi.spyOn(sync, 'disconnectUserSync').mockImplementation(() => {});
  vi.spyOn(player, 'attach').mockResolvedValue();
  vi.spyOn(connectionApi, 'testServerConnection').mockResolvedValue({ latencyMs: 42 });
});
afterEach(() => {
  cleanup(); useSession.getState().api?.dispose(); useSession.setState({ api: null, version: '', notice: '' }); vi.restoreAllMocks();
  localStorage.clear();
});
function form() {
  render(<Login />);
  fireEvent.change(screen.getByLabelText('服务器地址'), { target: { value: window.location.origin } });
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: ' fixture ' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } });
  return screen.getByRole('form', { name: '登录音乐库' });
}

function fillWithoutEvents(label: string, value: string) {
  const input = screen.getByLabelText(label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!(input instanceof HTMLInputElement) || !setter) throw new Error('Missing native input setter');
  setter.call(input, value);
}

it('separates server configuration from credentials and identifies the username/password fields', () => {
  const login = form(); const connection = screen.getByRole('form', { name: '服务器连接' });
  const server = screen.getByLabelText('服务器地址');
  expect(server.closest('form')).toBe(connection);
  expect(server).toHaveAttribute('id', 'navidrome-server');
  expect(server).toHaveAttribute('autocomplete', 'off'); expect(server).toHaveAttribute('data-bwignore', 'true');
  expect([...login.querySelectorAll('input')].map((input) => input.name)).toEqual(['username', 'password']);
  expect(screen.getByLabelText('用户名')).toHaveAttribute('id', 'username');
  expect(screen.getByLabelText('用户名')).toHaveAttribute('autocomplete', 'username');
  expect(screen.getByLabelText('密码')).toHaveAttribute('id', 'password');
  expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'current-password');
  expect(login).toHaveAttribute('method', 'post');
});

it('reads credentials autofilled without React events without changing the saved server address', async () => {
  const login = form();
  fillWithoutEvents('用户名', 'autofilled-fixture'); fillWithoutEvents('密码', 'synthetic-autofilled-password');
  fireEvent.submit(login);
  await waitFor(() => expect(useSession.getState().api?.username).toBe('autofilled-fixture'));
  expect(MusicApi.prototype.connect).toHaveBeenCalledWith('synthetic-autofilled-password');
  expect(useSession.getState().api?.base).toBe(`${window.location.origin}/nd`);
  expect(localStorage.getItem('tooku-login-server')).toBe(window.location.origin);
});

it('preserves autofilled credentials and focuses an invalid server address before connecting', async () => {
  const login = form();
  fireEvent.change(screen.getByLabelText('服务器地址'), { target: { value: 'invalid address' } });
  fillWithoutEvents('用户名', 'autofilled-fixture'); fillWithoutEvents('密码', 'synthetic-autofilled-password');
  fireEvent.submit(login);
  expect(await screen.findByRole('alert')).toHaveTextContent('服务地址');
  expect(screen.getByLabelText('服务器地址')).toHaveFocus();
  expect(screen.getByLabelText('服务器地址')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('用户名')).toHaveValue('autofilled-fixture');
  expect(screen.getByLabelText('密码')).toHaveValue('synthetic-autofilled-password');
  expect(MusicApi.prototype.connect).not.toHaveBeenCalled();
  // Change the credential fields without hiding the still-invalid server feedback.
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'edited-fixture' } });
  expect(screen.getByRole('alert')).toHaveTextContent('服务地址');
  fireEvent.change(screen.getByLabelText('服务器地址'), { target: { value: window.location.origin } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('服务器地址')).not.toHaveAttribute('aria-invalid');
});

it('does not submit while confirming Chinese input and allows submission after composition ends', async () => {
  const login = form(); const username = screen.getByLabelText('用户名');
  fireEvent.compositionStart(username);
  expect(fireEvent.keyDown(username, { key: 'Enter', isComposing: true })).toBe(false);
  fireEvent.submit(login); expect(MusicApi.prototype.connect).not.toHaveBeenCalled();
  fireEvent.compositionEnd(username);
  expect(fireEvent.keyDown(username, { key: 'Enter', keyCode: 229 })).toBe(false);
  fireEvent.submit(login); await waitFor(() => expect(MusicApi.prototype.connect).toHaveBeenCalledTimes(1));
});

it('submits only the server connection check from the connection form', async () => {
  form();
  fireEvent.submit(screen.getByRole('form', { name: '服务器连接' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('服务可达'));
  expect(MusicApi.prototype.connect).not.toHaveBeenCalled(); expect(enterWorkspace).not.toHaveBeenCalled();
});

it('keeps the legacy proxy address valid after separating the forms', async () => {
  const login = form(); const server = screen.getByLabelText('服务器地址');
  fireEvent.change(server, { target: { value: '/nd' } });
  if (!(server instanceof HTMLInputElement)) throw new Error('Missing server input');
  expect(server.checkValidity()).toBe(true);
  fireEvent.submit(login);
  await waitFor(() => expect(useSession.getState().api?.base).toBe(`${window.location.origin}/nd`));
});

it('rejects a whitespace-only username before login and clears credential errors on editing', async () => {
  const login = form(); fireEvent.change(screen.getByLabelText('用户名'), { target: { value: '   ' } });
  fireEvent.submit(login);
  expect(await screen.findByRole('alert')).toHaveTextContent('请输入用户名和密码');
  expect(screen.getByLabelText('用户名')).toHaveFocus(); expect(MusicApi.prototype.connect).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'fixture' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('waits for connection, recovery and player attachment before transitioning', async () => {
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

it('starts with a blank address and does not test or log in automatically', () => {
  render(<Login />);
  expect(screen.getByLabelText('服务器地址')).toHaveValue('');
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
  expect(connectionApi.testServerConnection).not.toHaveBeenCalled();
  expect(MusicApi.prototype.connect).not.toHaveBeenCalled();
});

it('restores only the server address when returning after a successful login', async () => {
  fireEvent.submit(form());
  await waitFor(() => expect(useSession.getState().api).not.toBeNull());
  cleanup(); useSession.getState().api?.dispose(); useSession.getState().setSession(null);
  render(<Login />);
  expect(screen.getByLabelText('服务器地址')).toHaveValue(window.location.origin);
  expect(screen.getByLabelText('用户名')).toHaveValue('');
  expect(screen.getByLabelText('密码')).toHaveValue('');
  expect(localStorage.getItem('tooku-login-server')).toBe(window.location.origin);
});

it('does not overwrite the saved address on a failed login or a connection check', async () => {
  localStorage.setItem('tooku-login-server', 'https://saved.example.test');
  vi.mocked(MusicApi.prototype.connect).mockRejectedValue(new Error('测试连接失败'));
  const login = form();
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('服务可达'));
  expect(localStorage.getItem('tooku-login-server')).toBe('https://saved.example.test');
  fireEvent.submit(login);
  expect(await screen.findByRole('alert')).toHaveTextContent('测试连接失败');
  expect(localStorage.getItem('tooku-login-server')).toBe('https://saved.example.test');
});

it('tests the server without requiring credentials or creating a session', async () => {
  render(<Login />);
  fireEvent.change(screen.getByLabelText('服务器地址'), { target: { value: 'https://fixture.example.test' } });
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('服务可达 · 42 ms'));
  expect(connectionApi.testServerConnection).toHaveBeenCalledWith('https://fixture.example.test', expect.any(AbortSignal));
  expect(MusicApi.prototype.connect).not.toHaveBeenCalled();
  expect(player.attach).not.toHaveBeenCalled(); expect(sync.connectUserSync).not.toHaveBeenCalled();
  expect(useSession.getState().api).toBeNull();
});

it('reports a connection failure and clears it when the address changes', async () => {
  vi.mocked(connectionApi.testServerConnection).mockRejectedValue(new Error('连接超时'));
  form(); fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('连接超时'));
  fireEvent.change(screen.getByLabelText('服务器地址'), { target: { value: 'https://other.example.test' } });
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled();
});

it('cancels an old check on address changes and ignores late results', async () => {
  let complete: (result: { latencyMs: number }) => void = () => {};
  vi.mocked(connectionApi.testServerConnection).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  const login = form();
  const check = screen.getByRole('button', { name: '测试连接' }); check.focus(); fireEvent.click(check);
  const signal = vi.mocked(connectionApi.testServerConnection).mock.calls[0][1];
  expect(check).toHaveFocus(); expect(check).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(check); expect(connectionApi.testServerConnection).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '进入音乐库' })).toBeDisabled();
  fireEvent.submit(login); expect(MusicApi.prototype.connect).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('服务器地址'), { target: { value: 'https://other.example.test' } });
  expect(signal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('42 ms'));
  complete({ latencyMs: 999 });
  await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('999'));
});

it('aborts the check on unmount', () => {
  vi.mocked(connectionApi.testServerConnection).mockReturnValue(new Promise(() => {}));
  form(); fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
  const signal = vi.mocked(connectionApi.testServerConnection).mock.calls[0][1];
  cleanup(); expect(signal?.aborted).toBe(true);
});

it('locks the form and ignores repeated submissions while connecting', async () => {
  let resolve: (version: string) => void = () => {};
  vi.mocked(MusicApi.prototype.connect).mockReturnValue(new Promise<string>((done) => { resolve = done; }));
  const login = form(); fireEvent.submit(login); fireEvent.submit(login);
  await waitFor(() => expect(MusicApi.prototype.connect).toHaveBeenCalledTimes(1));
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
