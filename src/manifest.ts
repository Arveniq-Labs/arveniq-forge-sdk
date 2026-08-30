import type {
  ApprovalRequirement,
  AuditPolicy,
  CreateHandlerInput,
  CreateReadOnlyHandlerInput,
  DeploymentEnvironment,
  JsonSchema,
  RiskLevel,
  ToolExecutionMode,
  ToolPackageHandlerManifest,
  ToolPackageManifest,
  ToolPackageRuntimeType,
  ValidationIssue,
  ValidationResult,
} from './types.js';

const handlerRefPattern = /^tool:\/\/([a-z0-9][a-z0-9-]*)\/([a-zA-Z0-9_.:-]+)$/;
const namespacePattern = /^[a-z0-9][a-z0-9-]*$/;
const executionModes: ToolExecutionMode[] = ['read_only', 'write', 'external_action'];
const riskLevels: RiskLevel[] = ['low', 'medium', 'high', 'restricted'];
const approvalRequirements: ApprovalRequirement[] = [
  'none',
  'always',
  'policy_based',
  'high_risk_only',
];
const deploymentEnvironments: DeploymentEnvironment[] = ['DEVELOPMENT', 'STAGING', 'PRODUCTION'];
const runtimeTypes: ToolPackageRuntimeType[] = ['node', 'container', 'serverless', 'mcp', 'internal'];
const traceVisibilities: AuditPolicy['trace_visibility'][] = ['summary', 'metadata', 'full_safe'];

export function createAuditPolicy(overrides: Partial<AuditPolicy> = {}): AuditPolicy {
  return {
    audit_input_metadata: true,
    audit_on_call: true,
    audit_output_metadata: true,
    redact_input_fields: [],
    redact_output_fields: [],
    retention_policy_id: 'standard',
    trace_visibility: 'metadata',
    ...overrides,
  };
}

export function createHandler(input: CreateHandlerInput): ToolPackageHandlerManifest {
  return {
    approval_requirement: input.approvalRequirement ?? 'none',
    audit_policy: createAuditPolicy(input.auditPolicy),
    description: input.description ?? '',
    execution_mode: input.executionMode ?? 'read_only',
    handler_ref: input.handlerRef,
    input_schema: input.inputSchema,
    name: input.name,
    output_schema: input.outputSchema,
    required_scopes: input.requiredScopes,
    risk_level: input.riskLevel ?? 'medium',
    slug: input.slug,
    supported_environments: input.supportedEnvironments ?? ['DEVELOPMENT'],
  };
}

/**
 * Creates a handler that cannot be configured to write or perform an external
 * action. Use this for end-user data lookups and explanations.
 */
export function createReadOnlyHandler(
  input: CreateReadOnlyHandlerInput,
): ToolPackageHandlerManifest {
  const { auditPolicy, ...handler } = input;
  return createHandler({
    ...handler,
    auditPolicy: createAuditedReadOnlyPolicy(auditPolicy),
    executionMode: 'read_only',
  });
}

/**
 * Read-only end-user data tools must retain a minimal audit trail. Redaction,
 * retention, and trace visibility remain configurable, but audit collection is
 * intentionally not optional.
 */
export function createAuditedReadOnlyPolicy(
  overrides: CreateReadOnlyHandlerInput['auditPolicy'] = {},
): AuditPolicy {
  return {
    ...createAuditPolicy(overrides),
    audit_input_metadata: true,
    audit_on_call: true,
    audit_output_metadata: true,
  };
}

export function createManifest(input: {
  name: string;
  namespace: string;
  version: string;
  description?: string;
  runtime?: { type?: ToolPackageRuntimeType; entrypoint: string };
  handlers: ToolPackageHandlerManifest[];
}): ToolPackageManifest {
  return {
    description: input.description ?? '',
    handlers: input.handlers,
    name: input.name,
    namespace: input.namespace,
    runtime: {
      entrypoint: input.runtime?.entrypoint ?? 'src/index.ts',
      type: input.runtime?.type ?? 'node',
    },
    version: input.version,
  };
}

export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (!isRecord(manifest)) {
    errors.push(issue('$', 'Manifest must be a JSON object.'));
    return result(errors, warnings);
  }

  const namespace = stringField(manifest, 'namespace', errors, '$.namespace');
  stringField(manifest, 'name', errors, '$.name');
  stringField(manifest, 'version', errors, '$.version');
  optionalStringField(manifest, 'description', errors, '$.description');
  if (namespace && !namespacePattern.test(namespace)) {
    errors.push(issue('$.namespace', 'Namespace must use lowercase letters, numbers, and hyphens.'));
  }

  if (!isRecord(manifest.runtime)) {
    errors.push(issue('$.runtime', 'Runtime metadata is required.'));
  } else {
    stringField(manifest.runtime, 'entrypoint', errors, '$.runtime.entrypoint');
    if (!runtimeTypes.includes(manifest.runtime.type as ToolPackageRuntimeType)) {
      errors.push(issue('$.runtime.type', 'Runtime type is invalid.'));
    }
  }

  if (!Array.isArray(manifest.handlers) || manifest.handlers.length === 0) {
    errors.push(issue('$.handlers', 'At least one handler is required.'));
    return result(errors, warnings);
  }

  const slugs = new Set<string>();
  const refs = new Set<string>();
  manifest.handlers.forEach((handler, index) => {
    const path = `$.handlers[${index}]`;
    if (!isRecord(handler)) {
      errors.push(issue(path, 'Handler must be an object.'));
      return;
    }
    const ref = stringField(handler, 'handler_ref', errors, `${path}.handler_ref`);
    const slug = stringField(handler, 'slug', errors, `${path}.slug`);
    stringField(handler, 'name', errors, `${path}.name`);
    optionalStringField(handler, 'description', errors, `${path}.description`);

    if (ref) {
      const match = handlerRefPattern.exec(ref);
      if (!match) errors.push(issue(`${path}.handler_ref`, 'Handler ref must match tool://namespace/action_name.'));
      if (match?.[1] && namespace && match[1] !== namespace) {
        errors.push(issue(`${path}.handler_ref`, 'Handler ref namespace must match package namespace.'));
      }
      if (refs.has(ref)) errors.push(issue(`${path}.handler_ref`, 'Handler ref must be unique.'));
      refs.add(ref);
    }
    if (slug) {
      if (slugs.has(slug)) errors.push(issue(`${path}.slug`, 'Handler slug must be unique.'));
      slugs.add(slug);
    }

    if (!Array.isArray(handler.required_scopes) || handler.required_scopes.length === 0) {
      errors.push(issue(`${path}.required_scopes`, 'Required scopes must be explicit.'));
    }
    if (!Array.isArray(handler.supported_environments) || handler.supported_environments.length === 0) {
      errors.push(issue(`${path}.supported_environments`, 'At least one supported environment is required.'));
    } else if (
      handler.supported_environments.some(
        (environment) => !deploymentEnvironments.includes(environment as DeploymentEnvironment),
      )
    ) {
      errors.push(issue(`${path}.supported_environments`, 'Supported environments must be valid Forge environments.'));
    }
    if (!executionModes.includes(handler.execution_mode as ToolExecutionMode)) {
      errors.push(issue(`${path}.execution_mode`, 'Execution mode is invalid.'));
    }
    if (!riskLevels.includes(handler.risk_level as RiskLevel)) {
      errors.push(issue(`${path}.risk_level`, 'Risk level is invalid.'));
    }
    if (!approvalRequirements.includes(handler.approval_requirement as ApprovalRequirement)) {
      errors.push(issue(`${path}.approval_requirement`, 'Approval requirement is invalid.'));
    }
    if (!isJsonSchema(handler.input_schema)) errors.push(issue(`${path}.input_schema`, 'Input schema must be a JSON schema object.'));
    if (!isJsonSchema(handler.output_schema)) errors.push(issue(`${path}.output_schema`, 'Output schema must be a JSON schema object.'));

    const risk = handler.risk_level;
    const approval = handler.approval_requirement;
    const productionExternal =
      handler.execution_mode === 'external_action' &&
      Array.isArray(handler.supported_environments) &&
      handler.supported_environments.includes('PRODUCTION');
    if (productionExternal && approval === 'none') {
      errors.push(issue(`${path}.approval_requirement`, 'Production external_action handlers require approval policy.'));
    }
    if ((risk === 'high' || risk === 'restricted') && approval === 'none') {
      errors.push(issue(`${path}.approval_requirement`, 'High/restricted risk handlers require approval policy.'));
    }
    validateAuditPolicy(handler.audit_policy, errors, `${path}.audit_policy`);
  });

  return result(errors, warnings);
}

export function assertValidManifest(manifest: unknown): asserts manifest is ToolPackageManifest {
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    const message = validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n');
    throw new Error(`Invalid tool package manifest:\n${message}`);
  }
}

function stringField(record: Record<string, unknown>, key: string, errors: ValidationIssue[], path: string) {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(issue(path, `${key} is required.`));
    return null;
  }
  return value;
}

function optionalStringField(
  record: Record<string, unknown>,
  key: string,
  errors: ValidationIssue[],
  path: string,
) {
  const value = record[key];
  if (value !== undefined && typeof value !== 'string') {
    errors.push(issue(path, `${key} must be a string.`));
  }
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return isRecord(value) && (typeof value.type === 'string' || Array.isArray(value.type));
}

function validateAuditPolicy(value: unknown, errors: ValidationIssue[], path: string) {
  if (!isRecord(value)) {
    errors.push(issue(path, 'Audit policy is required.'));
    return;
  }
  for (const key of ['audit_on_call', 'audit_input_metadata', 'audit_output_metadata']) {
    if (value[key] !== true) {
      errors.push(issue(`${path}.${key}`, `${key} must be true for governed tool packages.`));
    }
  }
  for (const key of ['redact_input_fields', 'redact_output_fields']) {
    if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== 'string')) {
      errors.push(issue(`${path}.${key}`, `${key} must be an array of field names.`));
    }
  }
  if (!traceVisibilities.includes(value.trace_visibility as AuditPolicy['trace_visibility'])) {
    errors.push(issue(`${path}.trace_visibility`, 'trace_visibility is invalid.'));
  }
  if (value.retention_policy_id !== null && typeof value.retention_policy_id !== 'string') {
    errors.push(issue(`${path}.retention_policy_id`, 'retention_policy_id must be a string or null.'));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function issue(path: string, message: string, severity: ValidationIssue['severity'] = 'error'): ValidationIssue {
  return { message, path, severity };
}

function result(errors: ValidationIssue[], warnings: ValidationIssue[]): ValidationResult {
  return { errors, valid: errors.length === 0, warnings };
}
