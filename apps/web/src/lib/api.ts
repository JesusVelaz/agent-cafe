import type {
  AgentDTO,
  AgentPermission,
  HarnessCommandDTO,
  HarnessModelDTO,
  ProjectDTO,
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

/** One level of the folder browser (directories only). */
export interface FolderListing {
  path: string;
  display: string;
  parent: string | null;
  parentDisplay: string | null;
  entries: Array<{ name: string; path: string }>;
}

export interface CreateTaskInput {
  prompt: string;
  agentId?: string;
  providerId?: ProviderId;
  model?: string;
  maxCostUsd?: number;
  projectId?: string | null;
  permission?: AgentPermission;
  continueTaskId?: string;
}

export const api = {
  catalog: () => request<{ asOf: string; models: ModelInfo[] }>('/api/catalog'),
  createTask: (input: CreateTaskInput) => post<TaskDTO>('/api/tasks', input),
  cancelTask: (id: string) => post<TaskDTO>(`/api/tasks/${id}/cancel`),
  retryTask: (id: string) => post<TaskDTO>(`/api/tasks/${id}/retry`),
  task: (id: string) => request<{ task: TaskDTO; events: TaskEventDTO[] }>(`/api/tasks/${id}`),
  /** A thread is addressed by any of its tasks. An empty title resets its name. */
  updateThread: (taskId: string, t: { title?: string | null; pinned?: boolean; archived?: boolean }) =>
    patch<TaskDTO>(`/api/threads/${taskId}`, t),
  /** Stops anything still running in it, then removes it and the threads it delegated. */
  deleteThread: (taskId: string) => request<{ removed: string[] }>(`/api/threads/${taskId}`, { method: 'DELETE' }),
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
    a: { name?: string; model?: string; systemPrompt?: string; projectId?: string | null; permission?: AgentPermission; spriteSeed?: number },
  ) => patch<AgentDTO>(`/api/agents/${id}`, a),
  answerApproval: (taskId: string, approvalId: string, decision: 'allow' | 'deny') =>
    post<TaskDTO>(`/api/tasks/${taskId}/approvals/${approvalId}`, { decision }),
  updateProvider: (id: ProviderId, p: { mode?: ProviderMode }) => patch<ProviderStatusDTO>(`/api/providers/${id}`, p),
  checkProvider: (id: ProviderId) => post<ProviderStatusDTO>(`/api/providers/${id}/check`),
  /** Opens the provider's own sign-in in a terminal window (unless already signed in); the result arrives on the stream. */
  connectProvider: (id: ProviderId) => post<{ ok: true; connected: boolean }>(`/api/providers/${id}/connect`),
  disconnectProvider: (id: ProviderId) => post<ProviderStatusDTO>(`/api/providers/${id}/disconnect`),
  models: (id: ProviderId, refresh = false) => request<{ source: 'harness' | 'catalog' | 'unavailable'; models: HarnessModelDTO[]; message?: string }>(`/api/providers/${id}/models${refresh ? '?refresh=true' : ''}`),
  commands: (id: ProviderId, projectId: string, refresh = false) => {
    const params = new URLSearchParams({ projectId });
    if (refresh) params.set('refresh', 'true');
    return request<{ source: 'harness' | 'unavailable'; commands: HarnessCommandDTO[]; message?: string }>(`/api/providers/${id}/commands?${params}`);
  },
  updateSettings: (s: Partial<SettingsDTO>) => patch<SettingsDTO>('/api/settings', s),
  addProject: (p: { path: string; name?: string }) => post<ProjectDTO>('/api/projects', p),
  renameProject: (id: string, name: string) => patch<ProjectDTO>(`/api/projects/${id}`, { name }),
  removeProject: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  cloneProject: (b: { url: string; parent: string; name?: string }) => post<ProjectDTO>('/api/projects/clone', b),
  folders: (path: string) => request<FolderListing>(`/api/folders?path=${encodeURIComponent(path)}`),
  revealFolder: (path: string) => post<{ ok: true }>('/api/folders/reveal', { path }),
};
