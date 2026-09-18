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

export type CreateHandlerInput = {
  handlerRef: string;
  slug: string;
  name: string;
  description?: string;
  executionMode?: ToolExecutionMode;
  riskLevel?: RiskLevel;
  requiredScopes: string[];
  supportedEnvironments?: DeploymentEnvironment[];
  approvalRequirement?: ApprovalRequirement;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  auditPolicy?: Partial<AuditPolicy>;
};

export type ReadOnlyAuditPolicyOverrides = Omit<
  Partial<AuditPolicy>,
  'audit_on_call' | 'audit_input_metadata' | 'audit_output_metadata'
>;

export type CreateReadOnlyHandlerInput = Omit<
  CreateHandlerInput,
  'executionMode' | 'auditPolicy'
> & {
  auditPolicy?: ReadOnlyAuditPolicyOverrides;
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
  /** A scoped Forge Developer API key. Keep this server-side. */
  apiKey: string;
  fetcher?: typeof fetch;
  /** Added to requests when the runtime permits the User-Agent header. */
  userAgent?: string;
};

export type ForgeRequestOptions = {
  /** Correlates an application request with Forge audit and trace records. */
  requestId?: string;
  signal?: AbortSignal;
};

export type ForgeDeveloperAgent = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  status: string;
  riskLevel: RiskLevel | string;
  project: {
    id: string;
    name: string;
    organizationId: string;
    workspaceId: string | null;
  };
  latestVersion: {
    id: string;
    status: string;
    version: number;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type ForgeDeveloperRunInput = {
  /**
   * An application-owned idempotency key. Reuse it only for retries of the
   * same logical operation.
   */
  idempotencyKey?: string;
  /**
   * Agent input. Do not place browser-supplied user, account, or portfolio IDs
   * here; those must be derived by a trusted server-side integration boundary.
   */
  input?: unknown;
};

/** The union of canonical AgentRun and legacy Execution statuses exposed by the Developer API. */
export type ForgeDeveloperRunStatus =
  | 'approval_required'
  | 'canceled'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'timed_out'
  | 'waiting_approval';

export type ForgeDeveloperRun = {
  id: string;
  agentRunId: string | null;
  legacyExecutionId: string | null;
  agent: { id: string; name: string };
  workflowName: string | null;
  status: ForgeDeveloperRunStatus;
  error: string | null;
  /** Sanitized answer on run detail/trace after success; null otherwise. Omitted by list/trigger summaries and older servers. */
  finalAnswer?: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type ForgeDeveloperWorkflow = {
  id: string;
  agentId: string;
  agentName: string;
  name: string;
  slug: string;
  status: string;
  latestVersion: number | null;
  updatedAt: string;
};

export type ForgeDeveloperTrace = {
  run: ForgeDeveloperRun;
  [key: string]: unknown;
};

export type ForgeRateLimitState = {
  organizationId: string;
  workspaceId: string | null;
  apiKeyId: string | null;
  windowSeconds: number;
  requestLimit: number;
  burstLimit: number | null;
  currentUsage: number;
  remaining: number;
  resetAt: string;
  exceeded: boolean;
};

export type ForgeRunWaitOptions = ForgeRequestOptions & {
  /** Defaults to 1,000 ms. */
  pollIntervalMs?: number;
  /** Defaults to 60,000 ms. */
  timeoutMs?: number;
  onPoll?: (run: ForgeDeveloperRun) => void | Promise<void>;
};

export type ForgeConversation = { id: string; agentId: string; createdAt: string };
export type ForgeConversationSnapshot = ForgeConversation & {
  turns: Array<{ id: string; clientMessageId: string; status: string; message: string; text: string; createdAt: string }>;
};
export type ForgeChatEvent = {
  type: 'turn.accepted' | 'activity.updated' | 'response.started' | 'response.delta' |
    'response.completed' | 'turn.requires_action' | 'turn.completed' | 'turn.failed' | 'turn.canceled';
  version: 1;
  conversationId: string;
  turnId: string;
  messageId: string;
  eventId?: string;
  sequence?: string;
  createdAt: string;
  data: { status?: string; message?: string; delta?: string; text?: string; replace?: boolean; phase?: string; code?: string };
};
export type ForgeChatStreamOptions = ForgeRequestOptions & {
  afterEventId?: string;
  /** Total reconnect attempts; defaults to 5. Zero disables reconnection. */
  maxReconnects?: number;
  /** Initial backoff; defaults to 500 ms and increases up to 10 seconds. */
  reconnectDelayMs?: number;
};
export type ForgeChatState = {
  text: string;
  turnId?: string;
  status?: string;
  activity?: string;
  lastEventId?: string;
  lastSequence?: string;
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
