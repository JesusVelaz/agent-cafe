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
  TaskDTO,
  TaskEventDTO,
} from '@agent-cafe/shared';
import { ApiError } from './apiError';
import { demoApi } from './demo/api';
import { DEMO_SITE } from './demo/flag';

export { ApiError };

// Under `pnpm dev`, Next serves the UI on :3000 and the API has its own port. A built UI is
// served by the café server itself, so it calls the API on its own origin.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:4318' : '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError('Can’t reach the café server. Is it still running?', 0);
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

/** Network access (Settings → Connections): whether the café can open to phones, and how it is open now. */
export interface PhoneStatus {
  available: boolean;
  sharing: {
    via: 'tailscale' | 'lan' | 'address';
    link: string;
    /** A device got through to the café (so the network and firewall are fine). */
    reached: boolean;
    /** Windows Firewall in the way, as far as the café can tell. */
    firewall: { kind: 'blocked' | 'not-allowed'; network: 'Public' | 'Private' | 'DomainAuthenticated' | null; fixable: boolean } | null;
  } | null;
}

const serverApi = {
  phone: () => request<PhoneStatus>('/api/phone'),
  /** `via`: tailscale or lan. */
  sharePhone: (via: string) => post<PhoneStatus>('/api/phone', { via }),
  /** Lets phones through Windows Firewall; Windows asks for permission first. */
  fixPhone: () => post<PhoneStatus>('/api/phone/fix'),
  stopPhone: () => request<PhoneStatus>('/api/phone', { method: 'DELETE' }),
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
  addProject: (p: { path: string; name?: string }) => post<ProjectDTO>('/api/projects', p),
  renameProject: (id: string, name: string) => patch<ProjectDTO>(`/api/projects/${id}`, { name }),
  removeProject: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  cloneProject: (b: { url: string; parent: string; name?: string }) => post<ProjectDTO>('/api/projects/clone', b),
  folders: (path: string) => request<FolderListing>(`/api/folders?path=${encodeURIComponent(path)}`),
  revealFolder: (path: string) => post<{ ok: true }>('/api/folders/reveal', { path }),
};

export type Api = typeof serverApi;

/** The demo site has no server: its café runs in the browser. */
export const api: Api = DEMO_SITE ? demoApi : serverApi;
