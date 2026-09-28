# Agent Café ☕

A local-first control room for AI agents, drawn as a cosy two-story pixel-art café.

The point is to see what your agents are doing and hand them work. Each agent is a worker in
the café, and where they stand is what they're doing: a tool call walks them to that tool's
station, and bubbles show thinking, waiting, done or failed. Next to the café, a **work board**
lists what needs you, who is working on what (live step, time, cost) and what just finished.
Click anyone for their current task, streamed output, tool timeline, tokens, cost and duration.

- **Ground floor: OpenAI.** **Upper floor: Anthropic.** The upper floor sits on top, one step smaller.
- Works with no API keys: every floor starts in **Demo** mode (scripted runs, no API calls).
- Keys stay on your machine, encrypted at rest, and are never sent back to the browser.

> Status: **Phase 1 + redesign** (orchestrator, stacked café, work board, Focus mode, themes). Live OpenAI and
> Anthropic calls land in Phase 2; see [Roadmap](#roadmap).

## Quick start

Requirements: Node 22+ (24 recommended) and pnpm 10+.

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The first run creates `apps/server/data/cafe.db`, seeds six
agents (Mocha, Chai and Biscotti downstairs; Earl, Matcha and Scone upstairs), and turns on
**Demo traffic**, so idle demo agents pick up sample orders by themselves.

Try a task from the composer at the top of the work board:

- `What is 12*7 + 3? Then check the time.` sends an agent to the register, then the wall clock.
- `List the files in the workspace and read the README` sends an agent to the bookcase.
- `Remember that deliveries come on Fridays` sends an agent to the archive.

## What you're looking at

| In the café | Means |
|---|---|
| Sitting and typing, thought bubble | Waiting on the model |
| Walking to a station | Running a tool: register = calculator, clock = time, bookcase = files, archive/cabinet = notes |
| Hourglass at a station | Waiting on a tool result |
| Green ✓ bubble | Just finished |
| Red `!` | Failed |
| `zzz` | Running but silent for over 60 s: probably stuck |
| Cream apron | Demo (mock) agent |
| "Closed for today" sign | That floor reached its daily spending cap |

The top bar answers the at-a-glance questions: how many are working, need you and are queued,
plus live spend per provider against its daily cap. **Needs you** on the board lists stuck
agents and failures the agent hasn't recovered from; retry, cancel or dismiss them there.

**Focus mode** (top bar) lets the café fill the screen: only agents that need you get a
callout, a command bar sits at the bottom, and the selected agent opens in a drawer.

**Themes:** Auto follows your local time (day, golden hour from 17:30, night from 20:00) and
season (snow in December to February). Pick Day, Summer, Rain, Snow or Night to override it;
the choice is remembered in this browser. Live weather is planned.

## Configuration

Copy `.env.example` to `.env` at the repo root. Everything is optional.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | none | Keys set here take precedence over keys entered in the UI |
| `WORKSPACE_DIR` | `./workspace` | The only folder agents can read (read-only) |
| `AGENT_CAFE_HOME` | `~/.agent-cafe` | Holds the encryption master key |
| `CAFE_API_PORT` | `4318` | API server port (always bound to 127.0.0.1) |

Useful scripts: `pnpm test`, `pnpm typecheck`, `pnpm db:reset` (wipe and reseed).

## Architecture

```
apps/web (Next.js 16, Tailwind 4, canvas)           apps/server (Fastify 5, Prisma 7 / SQLite)
┌───────────────────────────────────────┐            ┌─────────────────────────────────────────┐
│ UI: TopBar · WorkBoard · AgentPanel   │   REST     │ routes/     agents · tasks · providers  │
│     Composer · CafeScene · FocusView  │ ─────────► │ orchestrator/  Orchestrator (per-agent  │
│ store/  zustand + pure reducer        │            │   FIFO, routing, recovery) · runner     │
│ sim/    layout · A* · activity · world│   SSE      │   (tool loop, budget guard) · ambient   │
│ scene/  software rasteriser · sprites │ ◄───────── │ providers/  adapter interface · mock    │
└───────────────────────────────────────┘ CafeEvents │ tools/  calculator · time · notes · file │
                                                     │ secrets/  AES-256-GCM vault             │
                                                     └─────────────────────────────────────────┘
          packages/shared: domain types · CafeEvent protocol · model catalog (used by both)
```

Key decisions:

- **Two layers that only share events.** The orchestration layer (server) emits
  `CafeEvent`s: task lifecycle, model steps, tool calls. The simulation layer (web) turns them
  into positions and poses. Neither imports the other, which is what will let external agents
  (Claude Code hooks, Codex) report into the café later.
- **Provider adapters.** The runner's tool loop talks to one `ProviderAdapter` interface.
  The mock, OpenAI and Anthropic adapters translate to their own SDKs. To add a provider:
  implement the interface, add its id and models to `packages/shared`, and give it a floor
  in `apps/web/src/sim/layout.ts`.
- **A separate long-running process for the orchestrator.** Agent loops outlive UI reloads and
  Next's dev hot-reload. The browser gets one snapshot on connect, then deltas over SSE.
- **Budget guard by construction.** Each model turn's `max_tokens` is capped by what's left of
  the order's budget, so a single call can't blow past it. Per-provider daily caps close a floor.
- **Safe recovery.** Tasks running when the server stops come back as *interrupted*, never
  silently re-billed; queued tasks resume.
- **Art in code, drawn by a tiny software rasteriser.** The scene renders into a 400×360
  framebuffer (`scene/raster.ts`) and is upscaled by a whole number with nearest-neighbour
  filtering. A lighting pass multiplies each pixel by the theme's ambient light plus dithered
  lamp pools, leaving windows, bulbs and screens emissive. That's what makes night and rain
  glow, and it's far simpler on a CPU framebuffer than in a GPU scene graph. Sprites are
  palette-indexed string grids (`scene/sprites.ts`), so a real sprite sheet can replace them later.
- **One floor plan for everything.** `sim/layout.ts` is pure data (props with footprints,
  stations, seats). The simulation paths over it on a half-tile grid and the renderer draws it.

## Project layout

```
packages/shared/src     domain.ts · events.ts · catalog.ts (models + prices, dated)
apps/server/src         app.ts · index.ts · services.ts (composition root)
  orchestrator/         orchestrator.ts · runner.ts · ambient.ts
  providers/            types.ts · mock.ts · registry.ts · config.ts
  tools/                registry.ts · calculator.ts · files.ts
  secrets/  routes/  db/  events/
apps/web/src
  app/                  layout.tsx · page.tsx · globals.css (design tokens)
  components/           CafeApp · TopBar · WorkBoard · AgentPanel · Composer · CafeScene · FocusView
  store/                reduce.ts (pure, incl. needsAttention) · cafe.ts (zustand)
  sim/                  layout.ts · pathfinding.ts · activity.ts · world.ts
  scene/                renderer.ts · building.ts · props.ts · atmosphere.ts · sprites.ts · raster.ts · iso.ts · font.ts
  lib/                  api.ts · stream.ts · theme.ts (auto themes) · format.ts
docs/                   specs/ (design decisions) · plans/ (implementation plans)
```

## Roadmap

- **Phase 1 (done):** monorepo, SQLite persistence, orchestrator with queues, budgets and recovery,
  mock provider, SSE.
- **Redesign (done):** stacked, set-back café with cosy detail, work board, Focus mode, auto themes.
- **Phase 2:** live Anthropic and OpenAI adapters (streaming and tool use), a Settings page for keys,
  test connection and caps.
- **Phase 3:** history page, live weather (Open-Meteo), idle animations, polish, screenshots.
- **Phase 4:** `POST /api/events` ingest so Claude Code or Codex sessions appear as visiting agents.
