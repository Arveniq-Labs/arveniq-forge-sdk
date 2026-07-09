import { assertValidManifest } from './manifest.js';
import type {
  CreateToolPackageInput,
  CreateToolPackageVersionInput,
  DeploymentEnvironment,
  ForgeClientOptions,
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
  ) {
    super(message);
  }
}

export class ForgeToolPackagesClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly apiKey?: string;
  private readonly userId?: string;

  constructor(options: ForgeClientOptions) {
    if (!options.baseUrl.trim()) throw new Error('baseUrl is required.');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch;
    this.apiKey = options.apiKey;
    this.userId = options.userId;
  }

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

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...(this.userId ? { 'x-forge-user-id': this.userId } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ForgeApiError(`Forge API request failed with ${response.status}.`, response.status, body);
    }
    return (await response.json()) as T;
  }
}
