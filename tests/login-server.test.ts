import { afterEach, expect, it, vi } from 'vitest';
import { readLoginServer, rememberLoginServer } from '../src/storage/loginServer';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it.each(['https://fixture.example.test/music', 'http://127.0.0.1:44533', '/nd'])('remembers a validated server address: %s', (address) => {
  rememberLoginServer(` ${address} `);
  expect(readLoginServer()).toBe(address);
});

it.each([
  '', 'not-a-url', 'ftp://fixture.example.test', 'https://fixture.example.test?token=synthetic',
  'https://user:synthetic@fixture.example.test', 'https://fixture.example.test#synthetic', 'x'.repeat(2049),
])('ignores invalid or credential-bearing saved addresses: case %#', (address) => {
  localStorage.setItem('tooku-login-server', address);
  expect(readLoginServer()).toBe('');
  localStorage.setItem('tooku-login-server', 'https://saved.example.test');
  rememberLoginServer(address);
  expect(readLoginServer()).toBe('https://saved.example.test');
});

it('starts blank without a saved address', () => { expect(readLoginServer()).toBe(''); });

it('does not block login when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
  expect(readLoginServer()).toBe('');
  expect(() => rememberLoginServer('https://fixture.example.test')).not.toThrow();
});
