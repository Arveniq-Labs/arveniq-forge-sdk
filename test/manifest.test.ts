import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHandler,
  createManifest,
  createReadOnlyHandler,
  validateManifest,
} from '../src/index.js';

test('creates and validates a governed tool package manifest', () => {
  const manifest = createManifest({
    handlers: [
      createHandler({
        handlerRef: 'tool://treasury/calculate_cash_runway',
        inputSchema: { properties: { monthly_burn: { type: 'number' } }, type: 'object' },
        name: 'Calculate Cash Runway',
        outputSchema: { properties: { months_remaining: { type: 'number' } }, type: 'object' },
        requiredScopes: ['treasury.balance.read'],
        slug: 'calculate_cash_runway',
      }),
    ],
    name: 'treasury-tools',
    namespace: 'treasury',
    runtime: { entrypoint: 'src/index.ts', type: 'node' },
    version: '1.0.0',
  });

  const validation = validateManifest(manifest);

  assert.equal(validation.valid, true);
  assert.equal(manifest.handlers[0]?.handler_ref, 'tool://treasury/calculate_cash_runway');
});

test('rejects namespace mismatch and high risk without approval', () => {
  const manifest = createManifest({
    handlers: [
      createHandler({
        approvalRequirement: 'none',
        handlerRef: 'tool://payments/create_wire',
        inputSchema: { properties: {}, type: 'object' },
        name: 'Create Wire',
        outputSchema: { properties: {}, type: 'object' },
        requiredScopes: ['risk.execute'],
        riskLevel: 'restricted',
        slug: 'create_wire',
      }),
    ],
    name: 'treasury-tools',
    namespace: 'treasury',
    runtime: { entrypoint: 'src/index.ts', type: 'node' },
    version: '1.0.0',
  });

  const validation = validateManifest(manifest);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((error) => error.message.includes('namespace')), true);
  assert.equal(validation.errors.some((error) => error.message.includes('High/restricted')), true);
});

test('read-only helper cannot be configured as a mutating handler', () => {
  const handler = createReadOnlyHandler({
    handlerRef: 'tool://capitalfi/get_portfolio_summary',
    inputSchema: { properties: { question: { type: 'string' } }, type: 'object' },
    name: 'Get Portfolio Summary',
    outputSchema: { properties: { asOf: { type: 'string' } }, type: 'object' },
    requiredScopes: ['portfolio.read'],
    slug: 'get_portfolio_summary',
  });

  assert.equal(handler.execution_mode, 'read_only');
  assert.equal(handler.audit_policy.audit_on_call, true);
  assert.equal(handler.audit_policy.audit_input_metadata, true);
  assert.equal(handler.audit_policy.audit_output_metadata, true);
});

test('rejects invalid runtime and handler policy values', () => {
  const manifest = createManifest({
    handlers: [
      createHandler({
        handlerRef: 'tool://capitalfi/get_portfolio_summary',
        inputSchema: { properties: {}, type: 'object' },
        name: 'Get Portfolio Summary',
        outputSchema: { properties: {}, type: 'object' },
        requiredScopes: ['portfolio.read'],
        slug: 'get_portfolio_summary',
      }),
    ],
    name: 'capitalfi-tools',
    namespace: 'capitalfi',
    runtime: { entrypoint: 'src/index.ts', type: 'node' },
    version: '1.0.0',
  });
  (manifest.runtime as { type: string }).type = 'browser';
  (manifest.handlers[0] as { execution_mode: string }).execution_mode = 'mutate';

  const validation = validateManifest(manifest);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((error) => error.path === '$.runtime.type'), true);
  assert.equal(validation.errors.some((error) => error.path.endsWith('.execution_mode')), true);
});

test('rejects tool manifests that disable or malformed their audit trail', () => {
  const manifest = createManifest({
    handlers: [
      createHandler({
        auditPolicy: {
          audit_on_call: false,
          redact_input_fields: ['portfolioId', 1 as never],
        },
        handlerRef: 'tool://capitalfi/get_portfolio_summary',
        inputSchema: { properties: {}, type: 'object' },
        name: 'Get Portfolio Summary',
        outputSchema: { properties: {}, type: 'object' },
        requiredScopes: ['portfolio.read'],
        slug: 'get_portfolio_summary',
      }),
    ],
    name: 'capitalfi-tools',
    namespace: 'capitalfi',
    runtime: { entrypoint: 'src/index.ts', type: 'node' },
    version: '1.0.0',
  });

  const validation = validateManifest(manifest);

  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some((error) => error.path.endsWith('.audit_policy.audit_on_call')),
    true,
  );
  assert.equal(
    validation.errors.some((error) => error.path.endsWith('.audit_policy.redact_input_fields')),
    true,
  );
});
