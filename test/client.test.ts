import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ForgeDeveloperClient,
  ForgeToolPackagesClient,
  createHandler,
  createManifest,
} from '../src/index.js';

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
  assert.equal(requests[0]?.headers.get('x-forge-user-id'), null);
  assert.ok(requests[0]?.headers.get('x-request-id'));
  assert.match(requests[0]?.body ?? '', /tool:\/\/treasury\/get_market_rates/);
  assert.equal(requests[1]?.url, 'http://localhost:4000/v1/tool-package-versions/version-1/deploy');
});

test('developer client authenticates a workload and never forwards a caller identity header', async () => {
  const requests: Array<{ body?: string; headers: Headers; method?: string; url: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: new Headers(init?.headers),
      method: init?.method,
      url: String(url),
    });
    if (String(url).endsWith('/runs/run-1')) {
      return Response.json({
        agent: { id: 'agent-1', name: 'CapitalFi assistant' },
        agentRunId: 'run-1',
        completedAt: '2026-08-30T00:00:01.000Z',
        createdAt: '2026-08-30T00:00:00.000Z',
        error: null,
        id: 'run-1',
        legacyExecutionId: 'execution-1',
        startedAt: '2026-08-30T00:00:00.000Z',
        status: 'completed',
        updatedAt: '2026-08-30T00:00:01.000Z',
        workflowName: null,
      });
    }
    return Response.json({
      agent: { id: 'agent-1', name: 'CapitalFi assistant' },
      agentRunId: 'run-1',
      completedAt: null,
      createdAt: '2026-08-30T00:00:00.000Z',
      error: null,
      id: 'run-1',
      legacyExecutionId: 'execution-1',
      startedAt: null,
      status: 'queued',
      updatedAt: '2026-08-30T00:00:00.000Z',
      workflowName: null,
    });
  };
  const client = new ForgeDeveloperClient({
    apiKey: 'Bearer forge_test_key',
    baseUrl: 'http://localhost:4000/v1/',
    fetcher,
  });

  const run = await client.triggerAgentRun(
    'agent/1',
    { idempotencyKey: 'capitalfi-turn-1', input: { prompt: 'Summarize my portfolio.' } },
    { requestId: 'capitalfi-request-1' },
  );
  const completed = await client.waitForRun(run.id, {
    pollIntervalMs: 1,
    requestId: 'capitalfi-request-1',
    timeoutMs: 100,
  });

  assert.equal(completed.status, 'completed');
  assert.equal(requests[0]?.url, 'http://localhost:4000/v1/developer/v1/agents/agent%2F1/runs');
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.headers.get('authorization'), 'Bearer forge_test_key');
  assert.equal(requests[0]?.headers.get('x-request-id'), 'capitalfi-request-1');
  assert.equal(requests[0]?.headers.get('x-forge-user-id'), null);
  assert.deepEqual(JSON.parse(requests[0]?.body ?? '{}'), {
    idempotencyKey: 'capitalfi-turn-1',
    input: { prompt: 'Summarize my portfolio.' },
  });

  await client.listWorkflows({ requestId: 'capitalfi-request-1' });
  await client.triggerWorkflowRun(
    'workflow/1',
    { idempotencyKey: 'capitalfi-workflow-turn-1', input: { prompt: 'Refresh summary.' } },
    { requestId: 'capitalfi-request-1' },
  );
  assert.equal(requests[2]?.url, 'http://localhost:4000/v1/developer/v1/workflows');
  assert.equal(
    requests[3]?.url,
    'http://localhost:4000/v1/developer/v1/workflows/workflow%2F1/runs',
  );
});

test('clients reject missing workload credentials and malformed base URLs', () => {
  assert.throws(
    () => new ForgeDeveloperClient({ apiKey: ' ', baseUrl: 'http://localhost:4000/v1' }),
    /apiKey is required/,
  );
  assert.throws(
    () => new ForgeDeveloperClient({ apiKey: 'forge_test_key', baseUrl: 'file:///tmp/forge' }),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () => new ForgeDeveloperClient({ apiKey: 'forge_test_key', baseUrl: 'http://forge.example/v1' }),
    /must use HTTPS/,
  );
  assert.doesNotThrow(
    () => new ForgeDeveloperClient({ apiKey: 'forge_test_key', baseUrl: 'http://127.0.0.1:4000/v1' }),
  );
});

test('waitForRun returns every terminal status emitted by the Developer API', async () => {
  for (const status of ['approval_required', 'succeeded', 'timed_out', 'waiting_approval']) {
    const client = new ForgeDeveloperClient({
      apiKey: 'forge_test_key',
      baseUrl: 'http://localhost:4000/v1',
      fetcher: async () =>
        Response.json({
          agent: { id: 'agent-1', name: 'CapitalFi assistant' },
          agentRunId: 'run-1',
          completedAt: null,
          createdAt: '2026-08-30T00:00:00.000Z',
          error: null,
          id: 'run-1',
          legacyExecutionId: 'execution-1',
          startedAt: '2026-08-30T00:00:00.000Z',
          status,
          updatedAt: '2026-08-30T00:00:00.000Z',
          workflowName: null,
        }),
    });

    const run = await client.waitForRun('run-1', { timeoutMs: 10 });
    assert.equal(run.status, status);
  }
});
