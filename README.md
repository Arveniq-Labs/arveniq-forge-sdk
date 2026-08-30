# Arveniq Forge SDK

TypeScript SDK for server-side applications that integrate with Arveniq Forge O/S.

It provides two deliberately separate capabilities:

- `ForgeDeveloperClient` calls the scoped Forge Developer API for agent/workflow discovery, asynchronous runs, traces, and rate-limit status.
- Manifest helpers build and validate governed tool-package definitions before they are submitted to a Forge Tool Package management API.

The SDK is server-only. It rejects browser runtimes, never accepts a caller-supplied Forge user header, and must be given a scoped Forge API key from a server-side secret store.

## Install

```bash
npm install @arveniq/forge-sdk
```

## Call Forge from an application backend

Create the client once in server-side application code. Use a least-privilege, workspace-scoped key with the `agents:read`, `runs:trigger`, `runs:read`, and—only if required—`traces:read` scopes.

```ts
import { ForgeDeveloperClient } from '@arveniq/forge-sdk';

const forge = new ForgeDeveloperClient({
  baseUrl: process.env.FORGE_API_URL ?? 'https://forge.example.com/v1',
  apiKey: process.env.FORGE_API_KEY!,
  userAgent: 'capitalfi-api/1.0',
});

const run = await forge.triggerAgentRun(
  process.env.FORGE_CAPITALFI_AGENT_ID!,
  {
    idempotencyKey: `capitalfi-turn:${turnId}`,
    input: { prompt: userMessage },
  },
  { requestId },
);

const completedRun = await forge.waitForRun(run.id, {
  requestId,
  timeoutMs: 60_000,
});
```

The live Developer API is rooted at:

```text
https://<forge-host>/v1/developer/v1
```

The SDK expects `baseUrl` to include `/v1`; it appends the Developer API path itself. The API is asynchronous: trigger a run, then poll it with `waitForRun` or `getRun`. `waitForRun` returns when a run succeeds, fails, is cancelled/times out, or pauses for approval; callers must handle an `approval_required` or `waiting_approval` status explicitly.

## Application identity and resource context

Forge Developer API keys authenticate the calling workload. They do not authenticate an end user or authorize a portfolio, account, tenant, or other application-owned resource.

Your application backend must:

1. Verify its own SSO session.
2. Resolve the signed-in user and authorized resource server-side.
3. Call Forge from that backend using this SDK.
4. Supply only trusted context through a dedicated Forge integration endpoint or a server-bound tool adapter.

Never put browser-supplied user, account, wallet, or portfolio IDs into a generic agent-run input. Never instantiate this SDK in browser, mobile, or public client code.

For a CapitalFi-style integration, the browser calls CapitalFi’s API with the message only. CapitalFi derives the signed-in user and portfolio, then uses a short-lived, signed context assertion at the dedicated Forge integration boundary. That context endpoint is separate from the generic Developer API run endpoint and must be deployed before a production financial-assistant integration goes live.

## Build a governed tool manifest

The manifest helpers validate namespaces, handler references, required scopes, execution modes, environments, risk levels, approval requirements, audit policy, and schema shape. `createReadOnlyHandler` is useful for lookup and explanation tools because it cannot be configured to write or perform an external action, and it always preserves call/input/output audit metadata.

```ts
import {
  createManifest,
  createReadOnlyHandler,
  validateManifest,
} from '@arveniq/forge-sdk';

const manifest = createManifest({
  name: 'capitalfi-read-tools',
  namespace: 'capitalfi',
  version: '1.0.0',
  description: 'Governed CapitalFi portfolio information tools.',
  runtime: { type: 'node', entrypoint: 'src/index.ts' },
  handlers: [
    createReadOnlyHandler({
      handlerRef: 'tool://capitalfi/get_portfolio_summary',
      slug: 'get_portfolio_summary',
      name: 'Get Portfolio Summary',
      description: 'Returns an authorized user’s portfolio summary.',
      requiredScopes: ['capitalfi.portfolio.read'],
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' } },
      },
      outputSchema: {
        type: 'object',
        properties: {
          asOf: { type: 'string' },
          totalValue: { type: 'number' },
        },
      },
    }),
  ],
});

const validation = validateManifest(manifest);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors, null, 2));
```

The manifest describes a package; the SDK does not execute package code. Forge must validate, approve, deploy, bind, and route the handler through its Tool Registry and Tool Router.

## Tool Package API client

`ForgeToolPackagesClient` remains available for deployments that expose the Tool Package management API. It is distinct from the current public Developer API and should not be used as the integration runtime client.

```ts
import { ForgeToolPackagesClient } from '@arveniq/forge-sdk';

const packages = new ForgeToolPackagesClient({
  baseUrl: process.env.FORGE_API_URL!,
  apiKey: process.env.FORGE_API_KEY!,
});

const version = await packages.createVersion(packageId, {
  version: '1.0.0',
  commitSha,
  environment: 'DEVELOPMENT',
  manifest,
});
```

## CLI

```bash
export FORGE_API_URL=http://localhost:4000/v1
export FORGE_API_KEY=forge_sk_...

forge-tool validate --manifest tool-package.json
forge-tool create-version --package-id pkg_123 --manifest tool-package.json --version 1.0.0 --commit-sha abc123
forge-tool validate-version --version-id version_123
forge-tool deploy-version --version-id version_123 --environment STAGING --reason "Release candidate"
```

The CLI uses Tool Package management endpoints. Keep `FORGE_API_KEY` in a secret manager or local shell environment; do not commit it or expose it to a browser.

## Security model

- The SDK accepts a scoped API key and sends it only as `Authorization: Bearer …`.
- A generated or caller-provided `x-request-id` is sent with each request for auditing and tracing.
- It never sends `x-forge-user-id`, `x-forge-control-plane-token`, or runtime service credentials.
- It permits only absolute HTTPS base URLs without embedded credentials, query strings, or fragments; HTTP is restricted to loopback development hosts.
- It does not execute tool-package source code or bypass Forge Tool Router policy.

## License

Apache-2.0
