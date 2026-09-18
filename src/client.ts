import { assertValidManifest } from './manifest.js';
import { ForgeStreamError, readChatEvents, isChatTurnSettled } from './chat-stream.js';
import type { ForgeChatEvent, ForgeChatStreamOptions, ForgeConversation, ForgeConversationSnapshot } from './types.js';
import type {
  CreateToolPackageInput,
  CreateToolPackageVersionInput,
  DeploymentEnvironment,
  ForgeClientOptions,
  ForgeDeveloperAgent,
  ForgeDeveloperRun,
  ForgeDeveloperRunInput,
  ForgeDeveloperTrace,
  ForgeDeveloperWorkflow,
  ForgeRateLimitState,
  ForgeRequestOptions,
  ForgeRunWaitOptions,
  ToolPackageDeployment,
  ToolPackageDetail,
  ToolPackageHandler,
  ToolPackageSummary,
  ToolPackageValidationRun,
  ToolPackageVersion,
} from './types.js';

export class ForgeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ForgeApiError';
  }
}

type ForgeRequestInit = ForgeRequestOptions & {
  body?: string;
  method?: string;
  accept?: string;
  lastEventId?: string;
};

class ForgeServerClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly apiKey: string;
  private readonly userAgent?: string;

  constructor(options: ForgeClientOptions) {
    assertServerRuntime();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
    this.apiKey = normalizeApiKey(options.apiKey);
    this.userAgent = options.userAgent?.trim() || undefined;
  }

  protected async request<T>(path: string, init: ForgeRequestInit = {}): Promise<T> {
    const response = await this.requestResponse(path, init);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  protected async requestResponse(path: string, init: ForgeRequestInit = {}): Promise<Response> {
    const requestId = init.requestId ?? generatedRequestId();
    const headers = new Headers();
    if (init.body) headers.set('content-type', 'application/json');
    headers.set('accept', init.accept ?? 'application/json');
    if (init.lastEventId) headers.set('last-event-id', init.lastEventId);
    headers.set('authorization', `Bearer ${this.apiKey}`);
    if (requestId) headers.set('x-request-id', requestId);
    if (this.userAgent) headers.set('user-agent', this.userAgent);

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...(init.body ? { body: init.body } : {}),
      ...(init.method ? { method: init.method } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
      headers,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ForgeApiError(
        `Forge API request failed with ${response.status}.`,
        response.status,
        body,
        response.headers.get('x-request-id') ?? requestId,
      );
    }
    return response;
  }
}

/**
 * Client for the Forge Tool Package management API. Package deployment APIs
 * are a separate control-plane capability from the public Developer API.
 */
export class ForgeToolPackagesClient extends ForgeServerClient {

  listPackages() {
    return this.request<{ items: ToolPackageSummary[] }>('/tool-packages');
  }

  getPackage(packageId: string) {
    return this.request<ToolPackageDetail>(`/tool-packages/${encodeURIComponent(packageId)}`);
  }

  createPackage(input: CreateToolPackageInput) {
    return this.request<ToolPackageDetail>('/tool-packages', {
      body: JSON.stringify(input),
      method: 'POST',
    });
  }

  updatePackage(packageId: string, input: Partial<CreateToolPackageInput>) {
    return this.request<ToolPackageDetail>(`/tool-packages/${encodeURIComponent(packageId)}`, {
      body: JSON.stringify(input),
      method: 'PATCH',
    });
  }

  submitPackage(packageId: string) {
    return this.request<ToolPackageDetail>(`/tool-packages/${encodeURIComponent(packageId)}/submit`, {
      method: 'POST',
    });
  }

  deprecatePackage(packageId: string) {
    return this.request<ToolPackageDetail>(`/tool-packages/${encodeURIComponent(packageId)}/deprecate`, {
      method: 'POST',
    });
  }

  createVersion(packageId: string, input: CreateToolPackageVersionInput) {
    assertValidManifest(input.manifest);
    return this.request<ToolPackageVersion>(`/tool-packages/${encodeURIComponent(packageId)}/versions`, {
      body: JSON.stringify(input),
      method: 'POST',
    });
  }

  getVersion(versionId: string) {
    return this.request<ToolPackageVersion>(`/tool-package-versions/${encodeURIComponent(versionId)}`);
  }

  validateVersion(versionId: string) {
    return this.request<ToolPackageVersion>(`/tool-package-versions/${encodeURIComponent(versionId)}/validate`, {
      method: 'POST',
    });
  }

  listValidationRuns(versionId: string) {
    return this.request<{ items: ToolPackageValidationRun[] }>(
      `/tool-package-versions/${encodeURIComponent(versionId)}/validation-runs`,
    );
  }

  deployVersion(versionId: string, environment: DeploymentEnvironment, reason?: string) {
    return this.request<ToolPackageDeployment>(`/tool-package-versions/${encodeURIComponent(versionId)}/deploy`, {
      body: JSON.stringify({ environment, reason }),
      method: 'POST',
    });
  }

  listDeployments(filters: { environment?: DeploymentEnvironment; status?: string } = {}) {
    const params = new URLSearchParams();
    if (filters.environment) params.set('environment', filters.environment);
    if (filters.status) params.set('status', filters.status);
    const suffix = params.size ? `?${params.toString()}` : '';
    return this.request<{ items: ToolPackageDeployment[] }>(`/tool-package-deployments${suffix}`);
  }

  approveDeployment(deploymentId: string, reason?: string) {
    return this.deploymentDecision(deploymentId, 'approve', reason);
  }

  rejectDeployment(deploymentId: string, reason?: string) {
    return this.deploymentDecision(deploymentId, 'reject', reason);
  }

  rollbackDeployment(deploymentId: string, reason?: string) {
    return this.deploymentDecision(deploymentId, 'rollback', reason);
  }

  listAvailableHandlers() {
    return this.request<{ items: ToolPackageHandler[] }>('/tool-package-handlers/available');
  }

  linkHandlerToTool(handlerId: string, toolId: string) {
    return this.request<ToolPackageHandler>(`/tool-package-handlers/${encodeURIComponent(handlerId)}/link-tool`, {
      body: JSON.stringify({ toolId }),
      method: 'POST',
    });
  }

  createToolDefinitionFromHandler(handlerId: string) {
    return this.request<unknown>(`/tool-package-handlers/${encodeURIComponent(handlerId)}/create-tool-definition`, {
      method: 'POST',
    });
  }

  private deploymentDecision(deploymentId: string, action: 'approve' | 'reject' | 'rollback', reason?: string) {
    return this.request<ToolPackageDeployment>(
      `/tool-package-deployments/${encodeURIComponent(deploymentId)}/${action}`,
      {
        body: JSON.stringify({ reason }),
        method: 'POST',
      },
    );
  }

}

/**
 * Server-only client for the scoped Forge Developer API. It authenticates the
 * calling workload, not a browser user. Applications must resolve and authorize
 * their own signed-in user and resources before invoking Forge.
 */
export class ForgeDeveloperClient extends ForgeServerClient {
  createConversation(input: { agentId: string }, options: ForgeRequestOptions = {}) {
    return this.request<ForgeConversation>('/developer/v1/conversations', { ...options, method: 'POST', body: JSON.stringify(input) });
  }

  getConversation(conversationId: string, options: ForgeRequestOptions = {}) {
    return this.request<ForgeConversationSnapshot>(`/developer/v1/conversations/${requiredId(conversationId, 'conversationId')}`, options);
  }

  streamMessage(conversationId: string, input: { clientMessageId: string; message: string }, options: ForgeChatStreamOptions = {}) {
    if (!input.clientMessageId.trim()) throw new Error('clientMessageId is required for safe retries.');
    return this.chatStream(conversationId, undefined, input, options);
  }

  streamConversationTurn(conversationId: string, turnId: string, options: ForgeChatStreamOptions = {}) {
    requiredId(turnId, 'turnId');
    return this.chatStream(conversationId, turnId, undefined, options);
  }

  cancelConversationTurn(conversationId: string, turnId: string, options: ForgeRequestOptions = {}) {
    return this.request<{ conversationId: string; turnId: string }>(`/developer/v1/conversations/${requiredId(conversationId, 'conversationId')}/turns/${requiredId(turnId, 'turnId')}/cancel`, { ...options, method: 'POST' });
  }

  private async *chatStream(conversationId: string, turnId: string | undefined, input: { clientMessageId: string; message: string } | undefined, options: ForgeChatStreamOptions): AsyncIterable<ForgeChatEvent> {
    const base = `/developer/v1/conversations/${requiredId(conversationId, 'conversationId')}`;
    const maxReconnects = options.maxReconnects ?? 5;
    if (!Number.isInteger(maxReconnects) || maxReconnects < 0) throw new Error('maxReconnects must be a nonnegative integer.');
    const delay = positiveInteger(options.reconnectDelayMs, 500, 'reconnectDelayMs');
    let cursor = options.afterEventId;
    let sequence: bigint | undefined;
    for (let attempt = 0; ; attempt += 1) {
      options.signal?.throwIfAborted();
      try {
        const response = await this.requestResponse(turnId ? `${base}/turns/${requiredId(turnId, 'turnId')}/events/stream` : `${base}/messages/stream`, {
          requestId: options.requestId, signal: options.signal, accept: 'text/event-stream', lastEventId: cursor,
          ...(turnId ? {} : { method: 'POST', body: JSON.stringify(input) }),
        });
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
          await response.body?.cancel();
          throw new ForgeStreamError('Expected an SSE response from Forge.', 'stream_content_type_invalid');
        }
        for await (const event of readChatEvents(response.body)) {
          if (event.conversationId !== conversationId || (turnId && event.turnId !== turnId)) throw new ForgeStreamError('Unexpected stream identity.', 'stream_event_invalid');
          turnId = event.turnId;
          if (event.sequence) {
            const next = BigInt(event.sequence);
            if (sequence !== undefined && next <= sequence) continue;
            sequence = next;
          }
          if (event.eventId) cursor = event.eventId;
          yield event;
          if (isChatTurnSettled(event)) return;
        }
        throw new ForgeStreamError('Stream ended before the turn settled.');
      } catch (error) {
        options.signal?.throwIfAborted();
        const retryable = error instanceof ForgeApiError ? error.status === 429 || error.status >= 500
          : error instanceof ForgeStreamError ? ['stream_interrupted', 'developer_stream_interrupted'].includes(error.code)
          : error instanceof TypeError;
        if (!retryable || attempt >= maxReconnects) throw error;
        await wait(Math.min(10_000, delay * 2 ** attempt), options.signal);
      }
    }
  }

  listAgents(options: ForgeRequestOptions = {}) {
    return this.request<{ items: ForgeDeveloperAgent[] }>('/developer/v1/agents', options);
  }

  getAgent(agentId: string, options: ForgeRequestOptions = {}) {
    return this.request<ForgeDeveloperAgent>(
      `/developer/v1/agents/${requiredId(agentId, 'agentId')}`,
      options,
    );
  }

  listWorkflows(options: ForgeRequestOptions = {}) {
    return this.request<{ items: ForgeDeveloperWorkflow[] }>('/developer/v1/workflows', options);
  }

  triggerAgentRun(
    agentId: string,
    input: ForgeDeveloperRunInput = {},
    options: ForgeRequestOptions = {},
  ) {
    return this.request<ForgeDeveloperRun>(
      `/developer/v1/agents/${requiredId(agentId, 'agentId')}/runs`,
      {
        ...options,
        body: JSON.stringify(input),
        method: 'POST',
      },
    );
  }

  triggerWorkflowRun(
    workflowId: string,
    input: ForgeDeveloperRunInput = {},
    options: ForgeRequestOptions = {},
  ) {
    return this.request<ForgeDeveloperRun>(
      `/developer/v1/workflows/${requiredId(workflowId, 'workflowId')}/runs`,
      {
        ...options,
        body: JSON.stringify(input),
        method: 'POST',
      },
    );
  }

  listRuns(options: ForgeRequestOptions = {}) {
    return this.request<{ items: ForgeDeveloperRun[] }>('/developer/v1/runs', options);
  }

  getRun(runId: string, options: ForgeRequestOptions = {}) {
    return this.request<ForgeDeveloperRun>(
      `/developer/v1/runs/${requiredId(runId, 'runId')}`,
      options,
    );
  }

  getRunTrace(runId: string, options: ForgeRequestOptions = {}) {
    return this.request<ForgeDeveloperTrace>(
      `/developer/v1/runs/${requiredId(runId, 'runId')}/trace`,
      options,
    );
  }

  getRateLimits(options: ForgeRequestOptions = {}) {
    return this.request<{ limits: ForgeRateLimitState[] }>('/developer/v1/rate-limit', options);
  }

  async waitForRun(runId: string, options: ForgeRunWaitOptions = {}): Promise<ForgeDeveloperRun> {
    const pollIntervalMs = positiveInteger(options.pollIntervalMs, 1_000, 'pollIntervalMs');
    const timeoutMs = positiveInteger(options.timeoutMs, 60_000, 'timeoutMs');
    const deadline = Date.now() + timeoutMs;
    const requestId = options.requestId;

    while (true) {
      const run = await this.getRun(runId, { requestId, signal: options.signal });
      await options.onPoll?.(run);
      if (isTerminalRunStatus(run.status)) return run;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Forge run ${runId} after ${timeoutMs} ms.`);
      }
      await wait(pollIntervalMs, options.signal);
    }
  }
}

function normalizeBaseUrl(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error('baseUrl is required.');
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('baseUrl must be an absolute HTTP(S) URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('baseUrl must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('baseUrl must not contain credentials, a query string, or a fragment.');
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('baseUrl must use HTTPS unless it targets a loopback host.');
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeApiKey(value: string) {
  const normalized = value.trim().replace(/^Bearer\s+/i, '');
  if (!normalized) throw new Error('apiKey is required.');
  return normalized;
}

function assertServerRuntime() {
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
    throw new Error('Forge SDK clients are server-only. Do not expose Forge API keys in a browser.');
  }
}

function generatedRequestId() {
  return globalThis.crypto?.randomUUID?.();
}

function requiredId(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return encodeURIComponent(normalized);
}

function positiveInteger(value: number | undefined, defaultValue: number, name: string) {
  const resolved = value ?? defaultValue;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return resolved;
}

function isTerminalRunStatus(status: string) {
  return [
    'approval_required',
    'canceled',
    'cancelled',
    'completed',
    'failed',
    'succeeded',
    'timed_out',
    'waiting_approval',
  ].includes(status.trim().toLowerCase());
}

function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'localhost' || normalized === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Forge request was aborted.'));
      return;
    }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new Error('Forge request was aborted.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
