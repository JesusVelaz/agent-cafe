/**
 * The first-load cup's fill. It moves on real steps (the panel settled, the café's
 * state arrived, the scene drew its first frame), not a timer: each landed step has
 * a mark it rests on, and while waiting it creeps toward the next mark without ever
 * reaching it early.
 */
export const MARKS = [0.12, 0.35, 0.7, 1] as const;

/** Where the fill is heading with `done` steps landed, `sinceMs` after the last one. */
export function fillGoal(done: number, sinceMs: number): number {
  const at = MARKS[Math.min(done, 3)]!;
  if (done >= 3) return 1;
  const next = MARKS[done + 1]!;
  return at + (next - at) * 0.6 * (1 - Math.exp(-sinceMs / 700));
}

/** One frame's step from `p` toward `goal` (`dtMs` long): quick at first, settling in. */
export function approach(p: number, goal: number, dtMs: number): number {
  if (p >= goal) return p;
  const next = p + (goal - p) * (1 - Math.exp(-dtMs / 140)) + 0.0004 * dtMs;
  return Math.min(goal, next);
}
