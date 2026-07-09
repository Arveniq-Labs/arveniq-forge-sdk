# Arveniq Forge SDK

TypeScript SDK for building governed Arveniq Forge O/S tool package manifests and calling Tool Package Deployment APIs.

The SDK helps developers:

- Author `tool-package.json` manifests with strong TypeScript types.
- Validate handler metadata before submission.
- Submit package versions to Forge backend APIs.
- Request validation, deployment, approval, rollback, and Tool Registry linking.

The SDK does **not** execute tool package code. Package code must be built, tested, scanned, approved, and deployed by Forge backend/CI/worker infrastructure.

## Install

```bash
npm install @arveniq/forge-sdk
```

## Build A Manifest

```ts
import { createHandler, createManifest, validateManifest } from '@arveniq/forge-sdk';

const handler = createHandler({
  handlerRef: 'tool://treasury/calculate_cash_runway',
  slug: 'calculate_cash_runway',
  name: 'Calculate Cash Runway',
  description: 'Calculates treasury runway from scoped balances and burn rate.',
  requiredScopes: ['treasury.balance.read'],
  inputSchema: {
    type: 'object',
    required: ['monthly_burn'],
    properties: {
      monthly_burn: { type: 'number' },
      currency: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['months_remaining'],
    properties: {
      months_remaining: { type: 'number' },
      currency: { type: 'string' },
    },
  },
});

const manifest = createManifest({
  name: 'treasury-tools',
  namespace: 'treasury',
  version: '1.0.0',
  description: 'Treasury analytics tool handlers.',
  runtime: { type: 'node', entrypoint: 'src/index.ts' },
  handlers: [handler],
});

const validation = validateManifest(manifest);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors, null, 2));
```

## Use The API Client

```ts
import { ForgeToolPackagesClient } from '@arveniq/forge-sdk';
import manifest from './tool-package.json' assert { type: 'json' };

const forge = new ForgeToolPackagesClient({
  baseUrl: process.env.FORGE_API_URL ?? 'https://forge.example.com/v1',
  apiKey: process.env.FORGE_API_KEY,
});

const pkg = await forge.createPackage({
  namespace: 'treasury',
  name: 'Treasury Tools',
  sourceType: 'github_repo',
  sourceUrl: 'https://github.com/acme/treasury-tools',
  defaultBranch: 'main',
  riskLevel: 'medium',
});

const version = await forge.createVersion(pkg.id, {
  version: '1.0.0',
  commitSha: 'abc123',
  environment: 'DEVELOPMENT',
  manifest,
});

await forge.validateVersion(version.id);
await forge.deployVersion(version.id, 'DEVELOPMENT', 'Development smoke test');
```

## CLI

```bash
export FORGE_API_URL=http://localhost:4000/v1
export FORGE_API_KEY=...

forge-tool validate --manifest tool-package.json
forge-tool create-version --package-id pkg_123 --manifest tool-package.json --version 1.0.0 --commit-sha abc123
forge-tool validate-version --version-id version_123
forge-tool deploy-version --version-id version_123 --environment STAGING --reason "Release candidate"
```

For local development without API keys, Forge may support a user context header:

```bash
export FORGE_USER_ID=user_123
```

## Governance Notes

- `handler_ref` must use `tool://namespace/action_name`.
- Handler namespace must match the package namespace.
- Handler slugs and refs must be unique.
- Required scopes must be explicit.
- Production `external_action` handlers require approval policy.
- High/restricted risk handlers require approval policy.
- The SDK never runs tool package source code.
- Runtime execution remains server-side and must pass the Forge Tool Router.

## License

Apache-2.0
