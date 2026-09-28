import type {
  ProjectDTO,
  AgentDTO,
  AgentPermission,
  ApprovalDTO,
  FailureKind,
  ProviderId,
  TaskDTO,
  TaskEventDTO,
  TaskStatus,
} from '@agent-cafe/shared';
import type { Agent, Project, Task, TaskEvent } from '../generated/prisma/client.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toAgentDTO(a: Agent): AgentDTO {
  return {
    id: a.id,
    name: a.name,
    providerId: a.providerId as ProviderId,
    model: a.model,
    systemPrompt: a.systemPrompt,
    spriteSeed: a.spriteSeed,
    projectId: a.projectId,
    permission: a.permission as AgentPermission,
    createdAt: a.createdAt.toISOString(),
    archivedAt: iso(a.archivedAt),
  };
}

export function toTaskDTO(t: Task): TaskDTO {
  return {
    id: t.id,
    agentId: t.agentId,
    providerId: t.providerId as ProviderId,
    model: t.model,
    prompt: t.prompt,
    status: t.status as TaskStatus,
    isMock: t.isMock,
    maxCostUsd: t.maxCostUsd,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    costUsd: t.costUsd,
    steps: t.steps,
    output: t.output,
    error: t.error,
    failureKind: (t.failureKind as FailureKind | null) ?? null,
    retryOf: t.retryOf,
    projectId: t.projectId,
    permission: t.permission as AgentPermission,
    continueOf: t.continueOf,
    sessionId: t.sessionId,
    pendingApproval: t.pendingApproval ? (JSON.parse(t.pendingApproval) as ApprovalDTO) : null,
    createdAt: t.createdAt.toISOString(),
    startedAt: iso(t.startedAt),
    finishedAt: iso(t.finishedAt),
  };
}

export function toProjectDTO(p: Project): ProjectDTO {
  return { id: p.id, name: p.name, path: p.path, createdAt: p.createdAt.toISOString() };
}

export function toTaskEventDTO(e: TaskEvent): TaskEventDTO {
  return { ...(JSON.parse(e.payload) as object), seq: e.seq, at: e.at.toISOString() } as TaskEventDTO;
}
