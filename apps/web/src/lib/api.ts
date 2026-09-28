import type {
  AgentDTO,
  AgentPermission,
  HarnessModelDTO,
  ModelInfo,
  ProviderId,
  ProviderMode,
  ProviderStatusDTO,
  SettingsDTO,
  TaskDTO,
  TaskEventDTO,
} from '@agent-cafe/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4318';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError('Can’t reach the café server. Is `pnpm dev` running?', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export interface CreateTaskInput {
  prompt: string;
  agentId?: string;
  providerId?: ProviderId;
  model?: string;
  maxCostUsd?: number;
}

export const api = {
  catalog: () => request<{ asOf: string; models: ModelInfo[] }>('/api/catalog'),
  createTask: (input: CreateTaskInput) => post<TaskDTO>('/api/tasks', input),
  cancelTask: (id: string) => post<TaskDTO>(`/api/tasks/${id}/cancel`),
  retryTask: (id: string) => post<TaskDTO>(`/api/tasks/${id}/retry`),
  task: (id: string) => request<{ task: TaskDTO; events: TaskEventDTO[] }>(`/api/tasks/${id}`),
  tasks: (q: { limit?: number; agentId?: string } = {}) => {
    const params = new URLSearchParams();
    if (q.limit) params.set('limit', String(q.limit));
    if (q.agentId) params.set('agentId', q.agentId);
    return request<TaskDTO[]>(`/api/tasks?${params}`);
  },
  createAgent: (a: { name: string; providerId: ProviderId; model: string; systemPrompt?: string }) =>
    post<AgentDTO>('/api/agents', a),
  updateAgent: (
    id: string,
    a: { name?: string; model?: string; systemPrompt?: string; workDir?: string | null; permission?: AgentPermission },
  ) => patch<AgentDTO>(`/api/agents/${id}`, a),
  answerApproval: (taskId: string, approvalId: string, decision: 'allow' | 'deny') =>
    post<TaskDTO>(`/api/tasks/${taskId}/approvals/${approvalId}`, { decision }),
  updateProvider: (id: ProviderId, p: { mode?: ProviderMode }) => patch<ProviderStatusDTO>(`/api/providers/${id}`, p),
  checkProvider: (id: ProviderId) => post<ProviderStatusDTO>(`/api/providers/${id}/check`),
  models: (id: ProviderId) => request<{ source: 'harness' | 'catalog'; models: HarnessModelDTO[] }>(`/api/providers/${id}/models`),
  updateSettings: (s: Partial<SettingsDTO>) => patch<SettingsDTO>('/api/settings', s),
};
