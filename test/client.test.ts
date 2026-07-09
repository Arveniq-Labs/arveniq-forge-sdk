import assert from 'node:assert/strict';
import test from 'node:test';
import { ForgeToolPackagesClient, createHandler, createManifest } from '../src/index.js';

test('client calls governed package endpoints with auth headers', async () => {
  const requests: Array<{ body?: string; headers: Headers; method?: string; url: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: new Headers(init?.headers),
      method: init?.method,
      url: String(url),
    });
    return Response.json({
      deployments: [],
      handlers: [],
      id: 'version-1',
      packageId: 'pkg-1',
      validationRuns: [],
    });
  };
  const client = new ForgeToolPackagesClient({
    apiKey: 'forge_test_key',
    baseUrl: 'http://localhost:4000/v1',
    fetcher,
    userId: 'user-1',
  });
  const manifest = createManifest({
    handlers: [
      createHandler({
        handlerRef: 'tool://treasury/get_market_rates',
        inputSchema: { properties: {}, type: 'object' },
        name: 'Get Market Rates',
        outputSchema: { properties: {}, type: 'object' },
        requiredScopes: ['market.read'],
        slug: 'get_market_rates',
      }),
    ],
    name: 'treasury-tools',
    namespace: 'treasury',
    runtime: { entrypoint: 'src/index.ts', type: 'node' },
    version: '1.0.0',
  });

  await client.createVersion('pkg-1', { environment: 'DEVELOPMENT', manifest, version: '1.0.0' });
  await client.deployVersion('version-1', 'DEVELOPMENT', 'test deploy');

  assert.equal(requests[0]?.url, 'http://localhost:4000/v1/tool-packages/pkg-1/versions');
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.headers.get('authorization'), 'Bearer forge_test_key');
  assert.equal(requests[0]?.headers.get('x-forge-user-id'), 'user-1');
  assert.match(requests[0]?.body ?? '', /tool:\/\/treasury\/get_market_rates/);
  assert.equal(requests[1]?.url, 'http://localhost:4000/v1/tool-package-versions/version-1/deploy');
});
