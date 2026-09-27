import type {
  AgentDTO,
  FailureKind,
  ProviderId,
  TaskDTO,
  TaskEventDTO,
  TaskStatus,
} from '@agent-cafe/shared';
import type { Agent, Task, TaskEvent } from '../generated/prisma/client.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toAgentDTO(a: Agent): AgentDTO {
  return {
    id: a.id,
    name: a.name,
    providerId: a.providerId as ProviderId,
    model: a.model,
    systemPrompt: a.systemPrompt,
    spriteSeed: a.spriteSeed,
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
    createdAt: t.createdAt.toISOString(),
    startedAt: iso(t.startedAt),
    finishedAt: iso(t.finishedAt),
  };
}

export function toTaskEventDTO(e: TaskEvent): TaskEventDTO {
  return { ...(JSON.parse(e.payload) as object), seq: e.seq, at: e.at.toISOString() } as TaskEventDTO;
}
