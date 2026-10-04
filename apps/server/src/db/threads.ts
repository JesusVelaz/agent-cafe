/**
 * Threads on the server. A task joins the thread of the task it continues
 * (`continueOf`) or retries (`retryOf`); the thread's first task is its id and
 * holds its settings. Delegated work starts its own thread, filed under the one
 * that asked. The web store groups threads by the same rule.
 */
import type { Db } from './client.js';

type Link = { id: string; continueOf: string | null; retryOf: string | null };

const parentOf = (t: Link) => t.continueOf ?? t.retryOf;

/** The first task of the thread `taskId` belongs to, or null if there's no such task. */
export async function threadRootId(db: Db, taskId: string): Promise<string | null> {
  const select = { id: true, continueOf: true, retryOf: true } as const;
  let cur = await db.task.findUnique({ where: { id: taskId }, select });
  if (!cur) return null;
  const seen = new Set([cur.id]);
  for (let id = parentOf(cur); id && !seen.has(id); id = parentOf(cur)) {
    const next = await db.task.findUnique({ where: { id }, select });
    if (!next) break;
    seen.add(next.id);
    cur = next;
  }
  return cur.id;
}

/** Every task in the thread that starts at `rootId`, its first task included. */
export async function threadTaskIds(db: Db, rootId: string): Promise<string[]> {
  const members = new Set([rootId]);
  for (let frontier = [rootId]; frontier.length; ) {
    const next = await db.task.findMany({
      where: { OR: [{ continueOf: { in: frontier } }, { retryOf: { in: frontier } }] },
      select: { id: true, continueOf: true, retryOf: true },
    });
    frontier = next.filter((t) => members.has(parentOf(t)!) && !members.has(t.id)).map((t) => t.id);
    for (const id of frontier) members.add(id);
  }
  return [...members];
}

/**
 * A thread plus the threads it delegated, and theirs in turn. A message into an
 * agent's existing conversation continues that conversation, so it isn't included.
 */
export async function threadWithDelegations(db: Db, rootId: string): Promise<string[]> {
  const all = new Set<string>();
  for (let roots = [rootId]; roots.length; ) {
    const members: string[] = [];
    for (const root of roots) {
      for (const id of await threadTaskIds(db, root)) {
        if (!all.has(id)) members.push(id);
        all.add(id);
      }
    }
    const started = await db.task.findMany({
      where: { sourceTaskId: { in: members }, exchangeKind: { in: ['delegation', 'message'] }, continueOf: null, retryOf: null },
      select: { id: true },
    });
    roots = started.map((t) => t.id).filter((id) => !all.has(id));
  }
  return [...all];
}
