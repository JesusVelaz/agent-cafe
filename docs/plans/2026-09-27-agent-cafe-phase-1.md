# Agent Café — Phase 1 Implementation Plan

> **For agentic workers:** Execute task by task. Steps use checkbox (`- [ ]`) syntax.
> Executed inline in the authoring session, so each task gives exact interfaces,
> test code for the logic, and precise behaviour specs for the rendering and UI
> code, rather than repeating every UI line twice.

**Goal:** A running monorepo where seeded mock agents run tasks through the real
orchestrator, and the two-story isometric café shows them live over SSE. It
includes a crew roster, an inspector and an order pad.

**Architecture:** A pnpm workspace with `apps/server` (Fastify + Prisma/SQLite +
the orchestrator), `apps/web` (Next.js + Tailwind + PixiJS) and `packages/shared`
(types, events, catalog). The orchestrator emits `CafeEvent`s. The web store
reduces them, and the simulation layer (pure TS) turns store state into sprite
positions and animations for the Pixi renderer.

**Tech stack (pinned after a registry check on 2026-09-27):** Node 24, pnpm 11,
TypeScript 6.0.3 (not 7.x: Next still needs the JS compiler API), Next 16.3,
React 19.3, Tailwind 4.3 (`@tailwindcss/postcss`), PixiJS 8.21, Zustand 5,
Fastify 5.12 + `@fastify/cors` 11, Prisma 7.10 + `@prisma/adapter-better-sqlite3`
(not the 8.0 RC), Zod 4, Vitest 5, tsx 4, concurrently 10.

**Spec:** `docs/specs/2026-09-27-agent-cafe-design.md`

## Global Constraints

- Server binds `127.0.0.1:4318`. The web app runs on `:3000`. CORS allows only `http://localhost:3000` and `http://127.0.0.1:3000`.
- The server never returns API keys. It returns only `keyHint` (`sk-…a1b2`).
- The tool loop is capped at 8 model steps per task.
- Default budget caps: $0.50 per task and $5 per provider per day. Mock tasks record a cost but never count toward the daily cap.
- Ground floor = `openai`, upstairs = `anthropic`.
- A task that is `running`/`tool_wait` at boot becomes `interrupted`. Queued tasks resume.
- `zzz` means a running task has had no events for 60 s.
- ESM everywhere. `packages/shared` is consumed as TS source (Next `transpilePackages`).
- No `eval`/`Function` anywhere. The calculator uses a hand-written parser.
- Every file read by the file tools must resolve inside `WORKSPACE_DIR`.

## File structure

```
agent-cafe/
├─ package.json                 # workspace scripts: dev, test, build, db:*
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .env.example                 # OPENAI_API_KEY, ANTHROPIC_API_KEY, WORKSPACE_DIR…
├─ packages/shared/src/
│  ├─ index.ts
│  ├─ domain.ts                 # ProviderId, TaskStatus, AgentDTO, TaskDTO, ProviderStatusDTO
│  ├─ events.ts                 # TaskEventDTO kinds, CafeEvent union
│  ├─ catalog.ts                # MODEL_CATALOG, estimateCost(), findModel()
│  └─ catalog.test.ts
├─ apps/server/
│  ├─ prisma/schema.prisma
│  ├─ prisma.config.ts
│  └─ src/
│     ├─ index.ts               # boot: recover, listen
│     ├─ app.ts                 # buildApp(deps) → Fastify (used by tests)
│     ├─ config.ts
│     ├─ db/{client.ts,seed.ts,mappers.ts}
│     ├─ secrets/{vault.ts,masterKey.ts,vault.test.ts}
│     ├─ providers/{types.ts,mock.ts,registry.ts,config.ts,mock.test.ts,config.test.ts}
│     ├─ tools/{registry.ts,calculator.ts,files.ts,notes.ts,time.ts,*.test.ts}
│     ├─ events/bus.ts
│     ├─ orchestrator/{runner.ts,orchestrator.ts,budget.ts,ambient.ts,*.test.ts}
│     └─ routes/{agents.ts,tasks.ts,providers.ts,stream.ts,settings.ts,routes.test.ts}
└─ apps/web/src/
   ├─ app/{layout.tsx,page.tsx,globals.css}
   ├─ lib/{api.ts,stream.ts,format.ts}
   ├─ store/cafe.ts
   ├─ components/{TopBar,CrewRoster,Inspector,OrderPad,PixelPanel,CafeCanvas}.tsx
   ├─ sim/{layout.ts,activity.ts,pathfinding.ts,agentSim.ts,world.ts,*.test.ts}
   └─ scene/{palette.ts,iso.ts,pixelFont.ts,registry.ts,room.ts,props.ts,agentSprite.ts,icons.ts,renderer.ts}
```

---

### Task 1: Workspace scaffold

**Files:** root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`,
`.env.example`, a skeleton for each package, and `apps/server/src/app.ts` with `GET /api/health`.

- [ ] `git init`. Write the workspace files. The root scripts are `dev` (concurrently server+web), `test` (`pnpm -r test`) and `typecheck`.
- [ ] Server: Fastify `buildApp()` returns an app with `/api/health → {ok:true}`. `index.ts` listens on 127.0.0.1:4318.
- [ ] Web: minimal Next app (App Router, Tailwind v4, `transpilePackages: ['@agent-cafe/shared']`).
- [ ] Test `app.test.ts`: `buildApp().inject('/api/health')` returns 200 `{ok:true}`.
- [ ] `pnpm install` and `pnpm test` pass. `pnpm dev` serves both. Commit `chore: scaffold monorepo`.

### Task 2: Shared domain, events, model catalog

**Produces:**
```ts
type ProviderId = 'openai' | 'anthropic';
type ProviderMode = 'live' | 'mock' | 'off';
type TaskStatus = 'queued'|'running'|'tool_wait'|'completed'|'failed'|'cancelled'|'interrupted';
type FailureKind = 'provider_error'|'budget'|'daily_cap'|'max_steps'|'refusal';
type ToolName = 'notes_read'|'notes_write'|'calculator'|'current_time'|'read_file'|'list_files';
interface ModelInfo { id; providerId; label; inputPerMTok: number|null; outputPerMTok: number|null; tier: 'flagship'|'balanced'|'fast' }
const CATALOG_AS_OF = '2026-09-27';
function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number | null;
function findModel(modelId: string): ModelInfo | undefined;
// DTOs: AgentDTO, TaskDTO, ProviderStatusDTO, TaskEventDTO{seq,at,kind,data}
// CafeEvent = snapshot | agent.upserted | task.upserted | task.event | provider.updated | settings.updated
```
Catalog (verified 2026-09-27; Anthropic from the claude-api reference, OpenAI from developers.openai.com/api/docs/pricing):
anthropic `claude-fable-5-1` 10/50, `claude-opus-5-5` 4/20, `claude-opus-5` 5/25, `claude-sonnet-5` 2/10, `claude-haiku-4-5` 1/5;
openai `gpt-6-astra` 10/50, `gpt-6-sol` 2/10, `gpt-6-luna` 0.10/0.50, `gpt-5.4-mini` 0.75/4.50.

- [ ] Test first (`catalog.test.ts`): `estimateCost('claude-sonnet-5', 1_000_000, 0) === 2`; `estimateCost('gpt-6-luna', 2000, 1000)` ≈ `0.0007`; an unknown model returns `null`.
- [ ] Implement, run and commit `feat(shared): domain types, events, model catalog`.

### Task 3: Database

Prisma models per spec §4, plus `Setting {key @id, value}` (ambient toggle) and
`Task.failureKind`, `Task.isMock`, `Task.steps`. The DB file is `apps/server/data/cafe.db` (gitignored).
The seed creates 6 agents: ground/OpenAI **Mocha, Chai, Biscotti**; upstairs/Anthropic **Earl, Matcha, Scone**.
It also creates ProviderConfig rows (mode `mock`, cap 5).

- [ ] Spike Prisma 7 + the better-sqlite3 adapter on Windows. Fall back to `@prisma/adapter-libsql` if the native build fails.
- [ ] `db/client.ts` exports `createDb(url)`. `db/mappers.ts` maps rows to DTOs.
- [ ] Scripts: `db:push`, `db:seed`, `db:reset`. Commit.

### Task 4: Secrets vault + provider config

**Produces:** `encryptSecret(plain, key): string` (`v1:iv:tag:ct`, base64 parts), `decryptSecret(blob, key): string`
(throws when tampered), `maskKey(k)` → `sk-…a1b2`, and `loadOrCreateMasterKey(dir): Buffer`.
`ProviderConfigService(db, env, masterKey)` exposes `status(id): ProviderStatusDTO`, `setMode`, `setKey`,
`clearKey`, `setDailyCap`, `resolveKey(id): string | null` (env wins), and `spentToday(id)`.

- [ ] Tests: round trip; a flipped ciphertext byte throws; two encryptions of the same input differ; the mask never leaks more than 4 characters; env takes precedence over a stored key and reports `keySource:'env'`; `status()` never includes the key.
- [ ] Implement and commit.

### Task 5: Tools

**Produces:** `ToolSpec {name, description, inputSchema(JSON schema)}` and
`ToolRegistry.execute(name, input, ctx) → {ok, output}`. Station mapping lives in the web sim, not here.
- `calculator`: recursive-descent parser for `+ - * / % ^ ( )`, unary minus and decimals. Rejects anything else.
- `current_time`: ISO time plus the local timezone.
- `notes_read {key?}` / `notes_write {key, content}`: the Note table.
- `list_files {path?}` / `read_file {path}`: resolved against `WORKSPACE_DIR`. Reject paths that escape it, including through symlinks (`realpath`), cap reads at 64 KB, and reject binary files.

- [ ] Tests: `2+3*4 → 14`, `(1+2)^2 → 9`, `process.exit()` is rejected; `../secret` and absolute paths outside the workspace are rejected; reading a file inside it works.
- [ ] Implement and commit.

### Task 6: Provider adapter interface + MockAdapter

```ts
interface ToolCall { id: string; name: ToolName; input: Record<string, unknown> }
type NeutralMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown } // raw: provider-native blocks (e.g. thinking) replayed verbatim
  | { role: 'tool'; results: { callId: string; name: ToolName; output: string; isError: boolean }[] };
interface TurnRequest { model: string; system: string; messages: NeutralMessage[]; tools: ToolSpec[]; maxOutputTokens: number }
interface TurnResult { text: string; toolCalls: ToolCall[]; usage: { inputTokens: number; outputTokens: number }; stop: 'end'|'tool_use'|'max_tokens'|'refusal'; raw?: unknown }
interface ProviderAdapter { readonly kind: 'live'|'mock'; runTurn(req, signal, onDelta): Promise<TurnResult>; testConnection(): Promise<{ok: boolean; message: string}> }
```
MockAdapter(opts: {rng, sleep, failRate}) plans a scripted run from the prompt: 0–3 tool
calls picked by keyword (a number leads to calculator, "file" to list/read, "remember/note" to notes,
"time/date" to current_time, otherwise random), followed by a final answer. Each turn streams deltas over
0.6–2.2 s, and token counts scale with text length. `failRate` (default 0.08) throws an `AdapterError`.

- [ ] Tests (seeded rng, instant sleep): a prompt containing "12*7" produces a calculator call and then ends; deltas concatenate to the text; abort rejects with `AbortError`.
- [ ] Implement `providers/registry.ts` with `adapterFor(providerId, mode, key)` (live adapters come in Phase 2; live mode without a key is an error). Commit.

### Task 7: AgentRunner (tool loop)

`runTask(ctx): Promise<RunOutcome>` with ctx `{task, agent, adapter, tools, signal, emit, maxSteps=8}`.
`emit(kind, data)` kinds: `status`, `model.start`, `model.delta`, `model.end`, `tool.start`, `tool.end`, `log`.
Budget: before each turn, `remaining = maxCostUsd − spent`. `maxOutputTokens = min(8192, floor((remaining − estInputCost)/outPrice·1e6))`,
where estInputCost prices the previous turn's input plus the new content (chars/4). If this is below 256, stop with failureKind `budget`.
Models without a price have no budget enforcement, and the runner logs a warning.
Outcome `{status:'completed', output} | {status:'failed', failureKind, error} | {status:'cancelled'}`, plus the token and cost totals.

- [ ] Tests (fake adapter): a two-turn tool run gives completed status and the event order `model.start, model.end, tool.start, tool.end, model.start, model.end`; the 9th step fails with `max_steps`; a tiny budget fails with `budget` before calling the adapter; abort gives cancelled; an adapter throw gives `provider_error`; a tool error is fed back as `isError` and the loop continues.
- [ ] Implement and commit.

### Task 8: Orchestrator

`Orchestrator(db, bus, providers, tools, adapters)`:
`recover()` (running/tool_wait become interrupted; schedule queued tasks), `enqueue({agentId | {providerId, model, any:true}, prompt, maxCostUsd}) → TaskDTO`,
`cancel(taskId)`, `retry(taskId)`, and `pump(agentId)` (one active task per agent, FIFO by createdAt).
It persists each emitted event as a TaskEvent, except `model.delta`, which only goes to the bus. It updates the Task row and publishes `task.upserted` and `task.event`.
Before a live task starts, a provider over its daily cap makes the task fail with `daily_cap`. Mode `off` is refused when a task is enqueued.
`AmbientDriver` runs every 10±5 s while ambient is on: it picks an idle agent on a **mock**-mode provider and enqueues a canned prompt.

- [ ] Tests (temp SQLite, fake adapters): FIFO per agent; two agents run concurrently; "any idle" routes to an idle matching agent, or queues on the shortest queue; `recover()` marks interrupted and restarts queued tasks; cancel of a queued task never runs it; retry clones with `retryOf`.
- [ ] Implement and commit.

### Task 9: HTTP + SSE

Routes: `GET/POST/PATCH /api/agents`, `GET /api/tasks?limit&agentId`, `GET /api/tasks/:id` (with events),
`POST /api/tasks`, `POST /api/tasks/:id/cancel|retry`, `GET /api/providers`, `PATCH /api/providers/:id`
(`mode`, `apiKey`, `clearKey`, `dailyCapUsd`), `GET/PATCH /api/settings`, `GET /api/catalog`, `GET /api/stream` (SSE: a `snapshot` first, then the bus events, with a heartbeat every 15 s).
Zod validates every body.

- [ ] Tests via `inject`: creating a task returns queued; `PATCH` with a key returns a status holding only `keyHint`, and the response body never contains the key; enqueueing on a provider in `off` mode returns 409; an invalid body returns 400.
- [ ] Implement, boot, test with curl and commit.

### Task 10: Web data layer + shell

- `lib/api.ts`: typed fetchers. `lib/stream.ts`: EventSource with exponential reconnect, and it replaces state on each `snapshot`.
- `store/cafe.ts` (zustand): `agents`, `tasks` (map), `eventsByTask` (last 200), `streamText[taskId]`, `providers`, `settings`, `selectedAgentId`, `connection`, and `applyEvent(e)`.
- Shell layout per spec decision 13: TopBar (title, connection dot, today's spend per provider, ambient toggle), CrewRoster (grouped by floor, status glyph, active task snippet), CafeCanvas (centre), Inspector (right drawer, shown when an agent is selected: agent header, current task, status timeline, streamed output, events log, duration/tokens/cost, recent tasks with retry), OrderPad (provider, model, agent-or-any, prompt, cap, Send; Ctrl+Enter).
- Fonts via `next/font/google`: Pixelify Sans for display and JetBrains Mono for body text. Colours are Tailwind v4 `@theme` tokens taken from the reference palette. A `.pixel-frame` utility gives stepped borders with a box-shadow and no radius.

- [ ] Store reducer tests: `task.upserted` merges; `model.delta` appends to streamText; `snapshot` resets.
- [ ] Commit.

### Task 11: Simulation layer (pure TS, no Pixi)

- `layout.ts`: `FLOORS: Record<ProviderId, FloorLayout>`, a 14×10 tile grid, `blocked` tiles, and `stations: Record<StationId, {tile, facing, seats: Tile[]}>`.
  Ground: counter/register, pickup counter, ticket rail, tables (agent home seats), coding desks, bookcase, filing cabinet, wall clock, entrance.
  Upstairs: office desks (home seats), planning table, archive shelf, bookcase, register-style "calc desk", wall clock, balcony rail.
- `activity.ts`: `deriveActivity(agent, activeTask, lastEvent, now) → Activity` where
  `Activity = idle | thinking | tool{tool} | waiting{tool} | delivering | failed | stuck | queued`.
  `stationFor(activity, floor)`: tool → station per spec §5, thinking → home desk, delivering → pickup counter.
- `pathfinding.ts`: A* on the grid, 4-neighbour, deterministic tie-break.
- `agentSim.ts`: per agent `{tile (float), path, facing, anim: 'idle'|'walk'|'type'|'wait'|'slump'|'sleep'|'cheer', bubble}`; `update(dt, target)`; walk speed 3 tiles/s; claims a free seat at the station.
- `world.ts`: holds the AgentSims, reconciles them with the store every frame, and exposes a readonly view for the renderer.

- [ ] Tests: the A* path avoids blocked tiles and returns null when there's no path; `deriveActivity` for tool.start(read_file) gives tool/read_file, and running with no event for 61 s gives stuck; an agent reaches its target and switches to the station animation.
- [ ] Commit.

### Task 12: Pixi renderer + pixel art

- `palette.ts`: warm café palette (teal walls, cream, beige, walnut wood, checker navy/cream, brass).
- `iso.ts`: `TILE_W=20, TILE_H=10`, `toScreen(x,y,z)`, and `isoBox(g, x,y,z,w,d,h, color)` with three-tone shading (top = base lightened, left = base, right = base darkened).
- `pixelFont.ts`: a 3×5 bitmap font for signage (MENU, COFFEE, floor labels).
- `registry.ts`: `SpriteRegistry` turns palette-indexed string grids into `Texture`s (cached), with `nearest` scale mode.
- `room.ts`: draws a floor diorama (checker floor, two back walls with trim, window, door, menu board, posters). The upper floor sits at a +Y offset with a gap, and a staircase connects the two.
- `props.ts`: counter, espresso machine, tables, chairs, desks with monitors, bookcase, archive shelf, filing cabinet, clock, plants, ticket rail, cups.
- `agentSprite.ts`: a 12×20 grid body with per-agent colours derived from spriteSeed (hair, shirt), a DEMO apron overlay, a 4-frame walk, and type/idle/slump poses. Facing is mirrored.
- `icons.ts`: thought bubble (pulsing), hourglass, `!`, ✓, zzz, and small tool glyphs.
- `renderer.ts`: `CafeRenderer.mount(canvas, getWorld, onPick)`, logical size 480×540 (tuned when the art is laid out), integer CSS upscale with `image-rendering: pixelated`, depth sort by (x+y), hover tooltip, click → select agent, click cup → select that task, "Closed for today" sign.
- `CafeCanvas.tsx`: client-only, `ResizeObserver` picks the integer scale, zoom buttons.

- [ ] Visual check in the browser with seeded mock agents and ambient mode on.
- [ ] Commit.

### Task 13: Phase 1 verification & checkpoint

- [ ] `pnpm test` all green and `pnpm typecheck` clean.
- [ ] `pnpm db:reset && pnpm dev`. In the browser, send tasks to each floor and check every state appears: walk, tool station, waiting, cup delivered, failure `!`, cancel, and the ticket rail. Restart the server mid-run and confirm the interrupted status and Retry.
- [ ] Screenshots → checkpoint with the user.

---

## Later phases (planned in detail after the Phase 1 checkpoint)

**Phase 2 — live providers:** AnthropicAdapter (`@anthropic-ai/sdk` streaming, manual tool loop,
adaptive thinking, replay `raw` blocks, `refusal` stop handling) and OpenAIAdapter (`openai` SDK, Responses API
streaming + function tools), both verified against current SDK docs before writing. Settings page (keys, mode, caps,
Test connection, ambient). Daily-cap "Closed" sign wired to real spend.

**Phase 3 — polish & history:** a History route (filterable table: agent, provider, status, duration, cost, output
drawer), idle flavour animations (coffee sips, steam), and README + architecture docs + screenshots.

**Phase 4 — external ingest:** `POST /api/events` for Claude Code hooks and Codex, plus "visitor" agents.
