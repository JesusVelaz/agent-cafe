/**
 * The demo site's stand-in for the café server's HTTP API: the same calls, answered
 * by the in-browser café. Anything that needs a real computer (sign-in, folders,
 * phones) says so instead.
 */
import { CATALOG_AS_OF, MODEL_CATALOG, modelsFor, type HarnessModelDTO } from '@agent-cafe/shared';
import type { Api } from '../api';
import { ApiError } from '../apiError';
import { DemoCafe } from './cafe';
import { seedDemo } from './seed';

let cafe: DemoCafe | null = null;

/** The one café for this page, seeded and busy on first use. */
export function demoCafe(): DemoCafe {
  if (!cafe) {
    cafe = new DemoCafe();
    seedDemo(cafe);
    cafe.startTraffic();
  }
  return cafe;
}

const TIER_NOTE = { flagship: 'Most capable', balanced: 'Balanced', fast: 'Fastest' } as const;

const unavailable = (): Promise<never> =>
  Promise.reject(new ApiError('Not in the online demo. Run Agents Café on your own computer for this.', 400));

/** Answers on a later tick, like a request would. */
const reply = <T,>(fn: () => T): Promise<T> =>
  new Promise((resolve, reject) => queueMicrotask(() => {
    try {
      resolve(fn());
    } catch (err) {
      reject(err);
    }
  }));

export const demoApi: Api = {
  phone: unavailable,
  sharePhone: unavailable,
  fixPhone: unavailable,
  stopPhone: unavailable,
  catalog: () => reply(() => ({ asOf: CATALOG_AS_OF, models: [...MODEL_CATALOG] })),
  createTask: (input) => reply(() => demoCafe().createTask(input)),
  cancelTask: (id) => reply(() => demoCafe().cancel(id)),
  retryTask: (id) => reply(() => demoCafe().retry(id)),
  task: (id) => reply(() => demoCafe().history(id)),
  updateThread: (taskId, change) => reply(() => demoCafe().updateThread(taskId, change)),
  deleteThread: (taskId) => reply(() => demoCafe().deleteThread(taskId)),
  tasks: (q = {}) =>
    reply(() =>
      [...demoCafe().tasks.values()]
        .filter((t) => !q.agentId || t.agentId === q.agentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, q.limit ?? 100),
    ),
  createAgent: (a) => reply(() => demoCafe().addAgent({ ...a, systemPrompt: a.systemPrompt ?? '', spriteSeed: Math.floor(Math.random() * 1000) })),
  updateAgent: (id, a) => reply(() => demoCafe().updateAgent(id, a)),
  answerApproval: (taskId, approvalId, decision) => reply(() => demoCafe().answerApproval(taskId, approvalId, decision)),
  updateProvider: unavailable,
  checkProvider: (id) => reply(() => demoCafe().provider(id)),
  connectProvider: unavailable,
  disconnectProvider: unavailable,
  models: (id) =>
    reply(() => ({
      source: 'catalog' as const,
      models: modelsFor(id).map((m): HarnessModelDTO => ({ value: m.id, label: m.label.replace(/^Claude /, ''), description: TIER_NOTE[m.tier] })),
    })),
  commands: () => reply(() => ({ source: 'unavailable' as const, commands: [], message: 'Slash commands are available in Live mode.' })),
  addProject: unavailable,
  renameProject: unavailable,
  forgetAllowed: unavailable,
  removeProject: unavailable,
  cloneProject: unavailable,
  folders: unavailable,
  revealFolder: unavailable,
};
