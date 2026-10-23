import assert from 'node:assert/strict';
import test from 'node:test';
import { minimumNodeVersion, parseNodeVersion, supportsNodeVersion } from './check-node-version.mjs';

test('parses stable and prerelease Node versions', () => {
  assert.deepEqual(parseNodeVersion('24.22.1'), [24, 22, 1]);
  assert.deepEqual(parseNodeVersion('26.0.0-rc.1'), [26, 0, 0]);
  assert.equal(parseNodeVersion('v24.22.1'), undefined);
});

test(`requires Node.js ${minimumNodeVersion} or newer`, () => {
  assert.equal(supportsNodeVersion('24.15.0'), false);
  assert.equal(supportsNodeVersion('24.22.0'), false);
  assert.equal(supportsNodeVersion('24.22.1'), true);
  assert.equal(supportsNodeVersion('24.23.0'), true);
  assert.equal(supportsNodeVersion('26.0.0'), true);
  assert.equal(supportsNodeVersion('26.0.0-rc.1'), false);
});
