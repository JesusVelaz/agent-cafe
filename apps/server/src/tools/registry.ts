/**
 * Built-in tools available to every agent. All are safe by construction:
 * no network, no shell, no writes outside the Note table.
 *
 * Adding a tool: add its name to TOOL_NAMES (shared), define it here, then map it
 * to a café station in apps/web/src/sim/activity.ts.
 */
import type { ToolName } from '@agent-cafe/shared';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { evaluate } from './calculator.js';
import { listFiles, readTextFile } from './files.js';

export interface ToolSpec {
  name: ToolName;
  description: string;
  /** JSON Schema for the tool input, passed straight to the provider. */
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

export interface ToolContext {
  db: Db;
  workspaceDir: string;
}

export interface ToolRegistry {
  specs: ToolSpec[];
  execute(name: string, input: unknown): Promise<ToolResult>;
}

interface ToolDef<S extends z.ZodType> {
  spec: ToolSpec;
  schema: S;
  run(input: z.infer<S>): Promise<string>;
}

const def = <S extends z.ZodType>(d: ToolDef<S>) => d as unknown as ToolDef<z.ZodType>;

export function createToolRegistry(ctx: ToolContext): ToolRegistry {
  const defs: ToolDef<z.ZodType>[] = [
    def({
      spec: {
        name: 'calculator',
        description: 'Evaluate an arithmetic expression. Supports + - * / % ^ and parentheses.',
        inputSchema: {
          type: 'object',
          properties: { expression: { type: 'string', description: 'e.g. "(12 * 7) / 3"' } },
          required: ['expression'],
          additionalProperties: false,
        },
      },
      schema: z.object({ expression: z.string() }),
      run: async ({ expression }) => String(evaluate(expression)),
    }),
    def({
      spec: {
        name: 'current_time',
        description: "Get the current date and time in the café's local timezone.",
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      schema: z.object({}).loose(),
      run: async () => {
        const now = new Date();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return `${now.toISOString()} (local: ${now.toLocaleString()} ${tz})`;
      },
    }),
    def({
      spec: {
        name: 'notes_read',
        description: 'Read a shared note by key, or list all note keys when no key is given.',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string' } },
          additionalProperties: false,
        },
      },
      schema: z.object({ key: z.string().max(80).optional() }),
      run: async ({ key }) => {
        if (key) {
          const note = await ctx.db.note.findUnique({ where: { key } });
          return note ? note.content : `(no note named "${key}")`;
        }
        const notes = await ctx.db.note.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 });
        return notes.length ? notes.map((n) => n.key).join('\n') : '(no notes yet)';
      },
    }),
    def({
      spec: {
        name: 'notes_write',
        description: 'Save a shared note that any agent can read later. Overwrites an existing key.',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string' }, content: { type: 'string' } },
          required: ['key', 'content'],
          additionalProperties: false,
        },
      },
      schema: z.object({ key: z.string().min(1).max(80), content: z.string().max(4000) }),
      run: async ({ key, content }) => {
        await ctx.db.note.upsert({ where: { key }, create: { key, content }, update: { content } });
        return `Saved note "${key}".`;
      },
    }),
    def({
      spec: {
        name: 'list_files',
        description: 'List files in the read-only workspace folder (or a subfolder of it).',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Relative folder path. Defaults to the root.' } },
          additionalProperties: false,
        },
      },
      schema: z.object({ path: z.string().optional() }),
      run: ({ path }) => listFiles(ctx.workspaceDir, path),
    }),
    def({
      spec: {
        name: 'read_file',
        description: 'Read a text file from the read-only workspace folder (max 64 KB).',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Path relative to the workspace root.' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
      schema: z.object({ path: z.string().min(1) }),
      run: ({ path }) => readTextFile(ctx.workspaceDir, path),
    }),
  ];

  const byName = new Map(defs.map((d) => [d.spec.name as string, d]));

  return {
    specs: defs.map((d) => d.spec),
    async execute(name, input) {
      const d = byName.get(name);
      if (!d) return { ok: false, output: `Unknown tool: ${name}` };
      const parsed = d.schema.safeParse(input ?? {});
      if (!parsed.success) {
        return { ok: false, output: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
      }
      try {
        return { ok: true, output: await d.run(parsed.data) };
      } catch (err) {
        // Tool failures go back to the model as errors; they don't crash the task.
        return { ok: false, output: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
