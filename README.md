# Agent Café ☕

A local-first control room for AI agents, drawn as a cosy two-story pixel-art café on a street corner.

The point is to see what your agents are doing and hand them work. Each agent is a worker in
the café, and where they stand is what they're doing: a tool call walks them to that tool's
station, and bubbles show thinking, waiting, asking, done or failed. Next to the café, the
**side panel** lists what needs you (including actions waiting for your OK), who is working on
what, and what just finished. Click anyone to open their thread: your messages, their steps and
answers, and a message box to prompt them directly.

- **Ground floor: OpenAI.** **Upstairs: Anthropic.** The upper floor sits on top, one step smaller.
- **No API keys.** Live floors run the vendor's own coding agent (Claude Code, and Codex next),
  signed in with *your* subscription. Agent Café never sees or stores credentials.
- Every floor also has a **Demo** mode: scripted runs, no real calls.

> Status: Claude Code runs the Anthropic floor live. Codex for the OpenAI floor is next; until
> then that floor runs in Demo. See [Roadmap](#roadmap).

## Quick start

Requirements: Node 22+ (24 recommended) and pnpm 10+.

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The first run creates `apps/server/data/cafe.db`, seeds six
agents (Mocha, Chai and Biscotti downstairs; Earl, Matcha and Scone upstairs), and turns on
**Demo traffic**, so idle demo agents pick up sample orders by themselves.

### Going live with your Claude subscription

1. Install [Claude Code](https://code.claude.com).
2. Open **Settings → Providers** and press **Connect** on Claude. Claude Code's own sign-in opens in a
   terminal window (and your browser); the card turns *Connected* when you're done. (The Claude desktop
   app's sign-in is separate; the `claude` command needs its own.)
3. On the same card, switch the upstairs floor to **Live**.
4. Under the message box, open the project chip and **add a project**: paste the full path of a
   folder once, then pick it by name from then on (like a checkout).
5. Send a task. In the box, pick the model (every model Claude Code offers) and a permission:
   **Ask first** (default) or **Auto-accept edits** (commands still ask). When Claude Code wants to
   run a command or edit a file, the agent raises a hand and an **Allow / Deny** card appears.

Messaging an agent again continues their last conversation in that project (Claude Code resumes
the session); switch the footer chip to **New thread** to start fresh. Each agent remembers the
model, permission and project it used last.

Live runs count against your plan's normal usage limits; the top bar shows the current window.

## What you're looking at

| In the café | Means |
|---|---|
| Sitting and typing, thought bubble | Waiting on the model |
| Walking to a station | Using a tool: bookcase = reading/searching, archive = editing/notes, register = commands |
| Hourglass at a station | Waiting on a tool result |
| `?` bubble | Waiting for you to allow or deny an action |
| Green ✓ bubble | Just finished |
| Red `!` | Failed |
| `zzz` | Running but silent for over 60 s: probably stuck |
| Hoodie / office wear | Ground floor (OpenAI) / upstairs (Anthropic) |
| "Usage limit reached" sign | That floor's plan limit is used up for now |

The top bar answers the at-a-glance questions: how many are working, need you and are queued,
plus **Settings** (general, providers, projects); its gear shows a dot when a live floor can't run. **Needs you** lists
approvals first, then stuck agents and failures; allow, deny, retry, stop or dismiss them there.

**Café view:** fold the side panel away (» at its top) and the café fills the screen. Agents that
need you get a callout, a message bar sits at the bottom, and a rail on the right shows everyone's
status; click anyone to open the panel on them. « brings the panel back.

**Themes:** Auto follows your local time (day, golden hour from 17:30, night from 20:00) and
season (snow in December to February). Pick Day, Summer, Rain, Snow or Night to override it;
the choice is remembered in this browser. Live weather is planned. Three café cats wander about
regardless.

## Configuration

Everything is optional. Copy `.env.example` to `.env` at the repo root to change:

| Variable | Default | Purpose |
|---|---|---|
| `WORKSPACE_DIR` | `./workspace` | The folder demo runs' file tools can read (read-only) |
| `CAFE_API_PORT` | `4318` | API server port (always bound to 127.0.0.1) |

`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` are deliberately removed from Claude Code's
environment, so live runs always use your subscription.

Useful scripts: `pnpm test`, `pnpm typecheck`, `pnpm db:reset` (wipe and reseed).

## Architecture

```
apps/web (Next.js 16, Tailwind 4, canvas)           apps/server (Fastify 5, Prisma 7 / SQLite)
┌───────────────────────────────────────┐            ┌─────────────────────────────────────────┐
│ UI: TopBar · WorkBoard · AgentPanel   │   REST     │ routes/     agents · tasks · providers  │
│     Composer · CafeStage · SidePanel  │ ─────────► │ orchestrator/  Orchestrator (per-agent  │
│ store/  zustand + pure reducer        │            │   FIFO, routing, approvals, recovery)   │
│ sim/    layout · A* · activity · cats │   SSE      │   · runner (demo tool loop) · ambient   │
│ scene/  software rasteriser · sprites │ ◄───────── │ providers/  harness (sign-in, models) · │
└───────────────────────────────────────┘ CafeEvents │   claude (Agent SDK) · mock · config    │
                                                     │ tools/  calculator · time · notes · file │
                                                     └─────────────────────────────────────────┘
          packages/shared: domain types · CafeEvent protocol · model catalog (used by both)
```

Key decisions:

- **Harnesses, not keys.** A floor's live tasks run on the vendor's agent (Claude Code via
  `@anthropic-ai/claude-agent-sdk`, driving your installed `claude`). Its permission prompts become
  approvals in the café. See [docs/specs/2026-09-27-subscription-harnesses.md](docs/specs/2026-09-27-subscription-harnesses.md).
- **Two layers that only share events.** The orchestration layer (server) emits
  `CafeEvent`s: task lifecycle, model steps, tool calls, approvals. The simulation layer (web)
  turns them into positions and poses. Neither imports the other.
- **A separate long-running process for the orchestrator.** Agent runs outlive UI reloads and
  Next's dev hot-reload. The browser gets one snapshot on connect, then deltas over SSE.
- **Safe recovery.** Tasks running when the server stops come back as *interrupted*, never
  silently re-run; queued tasks resume.
- **Art in code, drawn by a tiny software rasteriser.** The scene renders into a 480×400
  framebuffer (`scene/raster.ts`) and is upscaled by a whole number with nearest-neighbour
  filtering. A lighting pass multiplies each pixel by the theme's ambient light plus dithered
  lamp pools, leaving windows, bulbs and screens emissive. Sprites are palette-indexed string
  grids (`scene/sprites.ts`), so a real sprite sheet can replace them later.
- **One floor plan for everything.** `sim/layout.ts` is pure data (props with footprints,
  stations, seats, cat spots). The simulation paths over it on a half-tile grid and the renderer draws it.

## Project layout

```
packages/shared/src     domain.ts · events.ts · catalog.ts (demo models + prices, dated)
apps/server/src         app.ts · index.ts · services.ts (composition root)
  orchestrator/         orchestrator.ts · runner.ts · ambient.ts
  providers/            harness.ts · claude.ts · config.ts · mock.ts · registry.ts · types.ts
  tools/                registry.ts · calculator.ts · files.ts   (demo runs)
  routes/  db/  events/
apps/web/src
  app/                  layout.tsx · page.tsx · globals.css (design tokens)
  components/           CafeApp · TopBar · SidePanel · AgentThread · Composer · pickers · CafeStage · CafeScene
  store/                reduce.ts (pure, incl. needsAttention) · cafe.ts (zustand)
  sim/                  layout.ts · pathfinding.ts · activity.ts · world.ts · cats.ts
  scene/                renderer.ts · building.ts · props.ts · outdoor.ts · atmosphere.ts · sprites.ts · raster.ts
  lib/                  api.ts · stream.ts · theme.ts (auto themes) · format.ts
docs/                   specs/ (design decisions) · plans/ (implementation plans)
```

## Roadmap

- **Done:** orchestrator with queues and recovery, demo provider, SSE; stacked café on a street
  corner with cats, side panel with agent threads and café view, auto themes; Claude Code on the
  Anthropic floor with projects, per-message models and resumable conversations.
- **Next:** Codex (`codex app-server`) on the OpenAI floor, signed in with `codex login`.
- **Later:** "always allow" rules, history page,
  live weather (Open-Meteo), `POST /api/events` ingest so outside sessions appear as visiting agents.
