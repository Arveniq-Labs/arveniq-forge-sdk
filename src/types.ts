export type DeploymentEnvironment = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
export type ToolExecutionMode = 'read_only' | 'write' | 'external_action';
export type RiskLevel = 'low' | 'medium' | 'high' | 'restricted';
export type ApprovalRequirement = 'none' | 'always' | 'policy_based' | 'high_risk_only';
export type TraceVisibility = 'summary' | 'metadata' | 'full_safe';
export type ToolPackageRuntimeType = 'node' | 'container' | 'serverless' | 'mcp' | 'internal';
export type ToolPackageSourceType = 'github_repo' | 'git_repo' | 'artifact' | 'internal';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonPrimitive[];
  nullable?: boolean;
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  default?: JsonValue;
  [key: string]: JsonValue | JsonSchema | JsonSchema[] | Record<string, JsonSchema> | undefined;
};

export type AuditPolicy = {
  audit_on_call: boolean;
  audit_input_metadata: boolean;
  audit_output_metadata: boolean;
  redact_input_fields: string[];
  redact_output_fields: string[];
  trace_visibility: TraceVisibility;
  retention_policy_id: string | null;
};

export type ToolPackageHandlerManifest = {
  handler_ref: string;
  slug: string;
  name: string;
  description: string;
  execution_mode: ToolExecutionMode;
  risk_level: RiskLevel;
  required_scopes: string[];
  supported_environments: DeploymentEnvironment[];
  approval_requirement: ApprovalRequirement;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  audit_policy: AuditPolicy;
};

export type ToolPackageManifest = {
  name: string;
  namespace: string;
  version: string;
  description: string;
  runtime: {
    type: ToolPackageRuntimeType;
    entrypoint: string;
    [key: string]: JsonValue;
  };
  handlers: ToolPackageHandlerManifest[];
};

export type ValidationIssue = {
  path: string;
  message: string;
  severity: 'error' | 'warning';
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type ForgeClientOptions = {
  baseUrl: string;
  apiKey?: string;
  userId?: string;
  fetcher?: typeof fetch;
};

export type CreateToolPackageInput = {
  namespace: string;
  name: string;
  description?: string;
  ownerId?: string | null;
  sourceType?: ToolPackageSourceType;
  sourceUrl?: string | null;
  defaultBranch?: string | null;
  riskLevel?: RiskLevel;
  workspaceId?: string | null;
};

export type ToolPackageSummary = CreateToolPackageInput & {
  id: string;
  organizationId: string;
  status: string;
  latestVersion?: ToolPackageVersion | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolPackageDetail = ToolPackageSummary & {
  versions: ToolPackageVersion[];
};

export type CreateToolPackageVersionInput = {
  version: string;
  commitSha?: string | null;
  artifactRef?: string | null;
  environment?: DeploymentEnvironment;
  manifest: ToolPackageManifest;
};

export type ToolPackageVersion = {
  id: string;
  packageId: string;
  version: string;
  validationStatus: string;
  deploymentStatus: string;
  environment: DeploymentEnvironment;
  runtimeRef: string | null;
  manifest: unknown;
  manifestHash: string;
  handlers: ToolPackageHandler[];
  deployments: ToolPackageDeployment[];
  validationRuns: ToolPackageValidationRun[];
  createdAt: string;
  updatedAt: string;
};

export type ToolPackageHandler = {
  id: string;
  packageVersionId: string;
  handlerRef: string;
  slug: string;
  name: string;
  status: string;
  linkedToolId: string | null;
};

export type ToolPackageDeployment = {
  id: string;
  packageVersionId: string;
  environment: DeploymentEnvironment;
  status: string;
  reason: string | null;
  logsRef: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolPackageValidationRun = {
  id: string;
  packageVersionId: string;
  status: string;
  checks: Array<{ name: string; passed: boolean; message: string }>;
  summary: Record<string, unknown>;
  logsRef: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};
