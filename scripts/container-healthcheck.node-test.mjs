import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { checkContainerHealth } from './container-healthcheck.mjs';

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/__tooku/health') response.end(JSON.stringify({ app: 'tooku', persistence: 1 }));
  else { response.statusCode = 404; response.end('{}'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Expected an assigned TCP port');

after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test('container healthcheck accepts the Tooku persistence endpoint', async () => {
  assert.equal(await checkContainerHealth(address.port), true);
});

test('container healthcheck rejects invalid ports and non-Tooku endpoints', async () => {
  assert.equal(await checkContainerHealth(0), false);
  const invalid = createServer((_request, response) => response.end(JSON.stringify({ app: 'other', persistence: 1 })));
  await new Promise((resolve) => invalid.listen(0, '127.0.0.1', resolve));
  const invalidAddress = invalid.address();
  if (!invalidAddress || typeof invalidAddress === 'string') throw new Error('Expected an assigned TCP port');
  try { assert.equal(await checkContainerHealth(invalidAddress.port), false); }
  finally { await new Promise((resolve, reject) => invalid.close((error) => error ? reject(error) : resolve())); }
});
