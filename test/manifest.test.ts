import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, createManifest, validateManifest } from '../src/index.js';

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
