# Agent Café — Design Spec

**Date:** 2026-09-27
**Status:** Agreed via design interview. Revised 2026-09-27 after the Phase 1 checkpoint (see §8).

## 1. Summary

Agent Café is a local-first web app that shows AI agents as pixel-art workers in a
two-story isometric café. It is a real control panel: you define agents, send them
tasks through the OpenAI and Anthropic APIs, and watch what they do. The café
stays useful because position and props carry live information: where an agent
stands tells you what it is doing, the ticket rail shows the queue, and cups on
the counter are finished results.

The UI must answer at a glance:
- Which agents are running right now?
- What provider and model is each one using?
- What task is each one doing?
- Is anything stuck or failing?
- What finished recently?
- What did each task cost, and how long did it take?

## 2. Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Agent source | The app orchestrates its own agents. A generic `POST /api/events` ingest for outside tools (Claude Code hooks, Codex) is **deferred to Phase 4**. The event schema is designed so it can be added later. |
| 2 | Task depth | Multi-turn tool loop, capped at **8 steps**. Safe built-in tools only: `notes_read`/`notes_write` (SQLite memory), `calculator`, `current_time`, `read_file`/`list_files` (read-only, inside one configured workspace folder). No shell, web or write tools in the MVP. |
| 3 | Routing | **The agent owns** its provider, model and system prompt. A task targets a specific agent or "any idle" for a provider and model. Each agent runs one task at a time from its own FIFO queue. |
| 4 | Runtime | pnpm monorepo: `apps/web` (Next.js + Tailwind + canvas renderer), `apps/server` (Fastify orchestrator + Prisma/SQLite + SSE), `packages/shared` (domain types, event schema, model catalog). `pnpm dev` starts both. REST handles commands and SSE handles live updates. |
| 5 | Secrets | A key in `.env` takes precedence. Keys entered in the UI are encrypted with **AES-256-GCM** before they go into SQLite. The master key is auto-generated at `~/.agent-cafe/master.key`. Keys are never sent back to the browser; the browser only sees a masked hint (`sk-…a1b2`). The server binds to `127.0.0.1`. The UI has a "Test connection" button. |
| 6 | Perspective | **Stacked, set back** (revised): one isometric diorama building. The upper floor sits directly on top of the ground floor, one step smaller (9×6 tiles over 14×11), so the café shows around it. Stairs run hidden under the upper floor; upstairs shows only a railed stairwell opening in the **back-left** corner. Ground floor = OpenAI, upstairs = Anthropic. A new provider = another set-back story. |
| 7 | Renderer | **Canvas 2D software rasteriser** (revised; replaces PixiJS). The approved look needs a per-pixel lighting pass (dithered lamp pools, emissive windows and string lights) and weather composited behind the building. At 400×360 that is a few ms per frame on the CPU and trivial to write; in Pixi it would need custom shaders. Hit-testing is done against agent bounding boxes. |
| 8 | Art | The scene renders to a **low-res internal canvas** (400×360 logical px) that is scaled up by a whole-number factor with nearest-neighbor filtering. Furniture and rooms are code-drawn isometric shapes with three-tone lighting (light top, mid left face, dark right face). Small details and agents are **palette-indexed pixel grids drawn in code**; agents are about 12×20 px with a 4-frame walk. Sprites are palette-indexed grids in one module, so a real sprite sheet can replace them later. Cosy detail per the approved mockup (sconces, string lights, pendant lamps, plants, task board, cat…). Agents get small accessories (glasses, headphones, beanie) so they are easy to tell apart. |
| 9 | Scene logic | Position follows **real activity** (§5). Failure = red `!`, no events for more than 60 s = `zzz`, done = ✓ bubble. The queue and finished work live on the **work board** (decision 13), not as café props: the café is for seeing agents, not simulating a café. |
| 10 | Demo mode | Each provider is set to **Live / Mock / Off**. It defaults to Mock when there's no key and never switches silently. Mock agents wear a "DEMO" apron. The mock provider replays scripted runs with realistic delays, tool calls, token counts and occasional failures. An optional **ambient** toggle has idle mock agents pick up canned tasks on their own; ambient mode never uses Live providers. |
| 11 | Budget | **Per-task cap** (default $0.50, can be changed per task). The loop stops before a call that would exceed the cap, and the task ends with `failed: budget`. **Daily cap per provider** (default $5) blocks new Live tasks once reached, and that floor shows a "Closed for today" sign. |
| 12 | Controls and restart | Cancel aborts the in-flight call. Retry clones the task. Model text **streams** into the inspector. On boot, tasks that were `running` become **`interrupted`** with their partial log kept; `queued` tasks resume on their own. Nothing is re-sent to a paid API automatically. |
| 13 | Layout | **Café + work board, with Focus mode** (revised). Default: café on the left; on the right a work board with the task composer, **Needs you** (stuck/failed, with actions), **Working now** (task, live step, step bar, time, cost), **Finished recently** and the queue. Selecting an agent swaps the board for that agent's detail. **Focus mode** collapses the board: the café fills the screen, only agents that need you get a callout (others on hover), a command bar sits at the bottom and the selected agent opens in a drawer. Type: Jersey 10 (display), Silkscreen (labels), IBM Plex Mono (body). |
| 14 | Delivery | Spec → plan → **Phase 1 checkpoint** (user reviews the visuals) → Phase 2 → Phase 3. Vitest covers the orchestrator, queue, pricing and encryption. The UI is checked by eye in the browser. |
| 16 | Themes | Five looks: day, summer (golden hour), rain, snow, night. **Auto** by default: local time picks day / golden hour / night, and winter months show snow. Manual override in the top bar, remembered per browser. **Live weather** (Open-Meteo, city set in Settings) is a later phase. |
| 15 | Name and location | **Agent Café**, at `C:\Users\iShad\agent-cafe`, with git and one commit per phase. |

## 3. Architecture

```
┌──────────────────────── apps/web (Next.js) ────────────────────────┐
│  React UI (roster, inspector, order pad, history, settings)         │
│        │ Zustand store ◄── SSE client (/api/stream)                 │
│        ▼                                                             │
│  Simulation layer (pure TS, no React)                               │
│    agentState → behaviour → walk paths → animation state            │
│        ▼                                                             │
│  Pixi renderer (scene graph, SpriteRegistry, low-res → upscale)     │
└──────────────────────────────▲──────────────────────────────────────┘
                   REST (commands) │ SSE (events)
┌──────────────────────────────┴──── apps/server (Fastify) ───────────┐
│  routes/  agents · tasks · providers · stream                        │
│  orchestrator/  TaskQueue (per-agent FIFO) · AgentRunner (tool loop) │
│                 BudgetGuard · StuckDetector                          │
│  providers/  ProviderAdapter ◄─ OpenAIAdapter · AnthropicAdapter ·   │
│              MockAdapter                                             │
│  tools/  registry · notes · calculator · time · files (sandboxed)    │
│  events/  EventBus (in-process) → persisted TaskEvent + SSE fan-out  │
│  secrets/  AES-GCM vault · env resolution                            │
│  db/  Prisma (SQLite)                                                │
└──────────────────────────────────────────────────────────────────────┘
packages/shared: domain types · CafeEvent union · model catalog + pricing
```

**Layer boundary:** the orchestration layer only emits `CafeEvent`s. The
simulation layer only consumes them. Neither imports the other. Replaying
persisted events rebuilds the scene, which is also how the Phase 4 external
ingest will plug in.

### ProviderAdapter (sketch)

```ts
interface ProviderAdapter {
  id: ProviderId;                       // 'openai' | 'anthropic' | 'mock'
  listModels(): ModelInfo[];
  testConnection(): Promise<Result>;
  // One model turn. Streams text deltas; returns tool calls and usage.
  runTurn(req: TurnRequest, signal: AbortSignal,
          onDelta: (text: string) => void): Promise<TurnResult>;
}
```

The adapters convert between the shared message and tool format and each SDK's own
format. The runner loop, budget checks and tool execution are the same for every provider.

## 4. Domain model (Prisma)

- **ProviderConfig**: `id`, `mode` (live|mock|off), `encryptedKey?`, `keyHint?`,
  `dailyCapUsd`, `updatedAt`
- **Agent**: `id`, `name`, `providerId`, `model`, `systemPrompt`, `spriteSeed`,
  `homeStation`, `createdAt`, `archivedAt?`
- **Task**: `id`, `agentId`, `prompt`, `status`, `maxCostUsd`,
  `inputTokens`, `outputTokens`, `costUsd`, `output?`, `error?`,
  `createdAt`, `startedAt?`, `finishedAt?`, `retryOf?`
- **TaskEvent**: `id`, `taskId`, `seq`, `type`, `payload` (JSON), `at`
- **Note**: `id`, `key`, `content`, `updatedAt` (backs the notes tools)

Task status: `queued → running ⇄ tool_wait → completed | failed | cancelled | interrupted`

## 5. State → scene mapping

| Orchestrator state | Scene |
|---|---|
| Agent idle, empty queue | Sits at home seat, idle bob; occasional coffee sip |
| Task queued | Ticket appears on the rail |
| Model call in progress | At home desk, typing, pulsing thought bubble |
| Tool call `notes_*` | Walks to archive shelf (upstairs) or filing cabinet (ground) |
| Tool call `read_file`/`list_files` | Walks to bookcase |
| Tool call `calculator` | Walks to register |
| Tool call `current_time` | Walks to wall clock |
| Waiting on tool result | Paused at station, hourglass icon |
| Completed | Walks to pickup counter, sets down a cup, ✓ pop |
| Failed / budget | Red `!` over head, slumped pose |
| No events for more than 60 s | `zzz` |
| Provider over daily cap | "Closed for today" sign on that floor |
| Mock agent | DEMO apron |

Hovering an agent shows a tooltip with name, provider, model and status. Clicking
opens the inspector.

## 6. Out of scope for the MVP

External event ingest (Phase 4), shell, web or write tools, multi-user
access or authentication, deployment, OS keychain storage, agent-to-agent delegation, and sound.

## 7. Open items to verify during implementation

- Current model IDs and per-token prices for both providers. These must be
  checked against current docs, not memory, and the catalog records an "as of" date.
- Current PixiJS v8 and Next.js versions and APIs.

## 8. Revision after the Phase 1 checkpoint (2026-09-27)

The user reviewed Phase 1 and a mockup page (Design artifact "Agent Café design directions"). Chosen: stacked, set-back building (option B) with more cosy detail; stairs hidden with the stairwell opening at the back-left of the upper floor; café + work board layout with Focus mode; automatic time-of-day and season themes now, live weather later. Decisions 6, 7, 8, 9, 13 and 16 above record the changes.
