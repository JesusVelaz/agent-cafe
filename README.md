# Agent Café ☕

A local-first control room for AI agents, drawn as a cosy two-story pixel-art café on a street corner.

The point is to see what your agents are doing and hand them work. Each agent is a worker in
the café, and where they stand is what they're doing: a tool call walks them to that tool's
station, and bubbles show thinking, waiting, asking, done or failed. Next to the café, the
**side panel** lists what needs you (including actions waiting for your OK), who is working on
what, and what just finished. Click anyone to open their thread: your messages, their steps and
answers, and a message box to prompt them directly.

- **Ground floor: OpenAI.** **Upstairs: Anthropic.** The upper floor sits on top, one step smaller.
- **No API keys.** Live floors run the vendor's own coding agent (Claude Code upstairs, Codex
  downstairs), signed in with *your* subscription. Agent Café never sees or stores credentials.
- Every floor also has a **Demo** mode: scripted runs, no real calls.

> Status: Claude Code runs the Anthropic floor live and Codex runs the OpenAI floor live; both
> can work at the same time. See [Roadmap](#roadmap).

## Install

No Node or pnpm needed: each release ships the café with everything it runs on.

- **Windows:** download `AgentCafeSetup.exe` from the
  [latest release](https://github.com/JesusVelaz/agent-cafe/releases/latest) and run it. Open
  **Agent Café** from the Start menu. The installer can also let phones on your home Wi-Fi through
  Windows Firewall (private networks only), so [network access](#on-your-phone) works straight away. It isn't code-signed yet, so Windows
  may say it "protected your PC": click **More info → Run anyway**.
- **macOS and Linux:** run this in a terminal, then open **Agent Café** from Applications (in your
  home folder) or your app menu, or run `agent-cafe`:

  ```bash
  curl -fsSL https://github.com/JesusVelaz/agent-cafe/releases/latest/download/install.sh | sh
  ```

The café opens in your browser and runs in a terminal window; close the window to close the café.
Run the installer again to update. Your data stays in `~/.agent-cafe`.

To publish a release, set the version in `apps/cli/package.json` and push a matching tag
(`git tag v0.2.0 && git push origin v0.2.0`). The [Release workflow](.github/workflows/release.yml)
builds the app for Windows, macOS (Apple silicon and Intel) and Linux (x64 and arm64) and
publishes it. `pnpm build && pnpm --filter ./apps/cli standalone` builds it for your own computer
into `apps/cli/release/`.

## Quick start (from source)

Requirements: Node 22+ (24 recommended) and pnpm 10+.

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The first run creates `apps/server/data/cafe.db`, seeds six
agents (Mocha, Chai and Biscotti downstairs; Earl, Matcha and Scone upstairs). Agents only
work when you give them something to do.

### Running it as one app

`pnpm dev` runs the UI (Next on :3000) and the server (:4318) separately, with hot reload. To
run the café the way it ships, as one process that serves the UI and the API on one port:

```bash
pnpm build
pnpm start
```

This is the `agent-cafe` command (`apps/cli`). It opens http://127.0.0.1:4318 in your browser
and keeps its data in `~/.agent-cafe`, apart from the dev database. Options: `--port`,
`--data-dir`, `--no-browser` (see `agent-cafe --help`). Like `pnpm dev`, it only listens on
this computer unless you open it to your phone (below). Once the package is published,
`npx agent-cafe` does the same with no checkout.

### On your phone

The café keeps running on your computer; your phone becomes another screen for it. Open
**Settings → Connections** in the café, turn on **Network access** and pick how your phone reaches it
(it stays on when the café restarts, until you turn it off), or start it with `--host`
(from the repo: `pnpm start --host tailscale`; this also works while the café is already open):

| | Works | Connection |
|---|---|---|
| `--host tailscale` | Anywhere your phone has [Tailscale](https://tailscale.com) on (install it on both, same account) | Encrypted |
| `--host lan` | Only on the same home network (Wi-Fi or router) as your computer | Not encrypted: use it on a network you trust, never public Wi-Fi |

The café shows a QR code (the command prints it too). Scan it with your phone's camera and the café opens; the phone
stays paired (a cookie) from then on. The code holds a long random token, saved in
`~/.agent-cafe/pairing-token`: anyone with it can control the café, so keep it to yourself.
`--new-token` (with the café closed) makes a new one and signs out every paired device; turning
**Network access** off closes the café to phones until you turn it on again. The first time, your computer's
firewall may ask whether to accept incoming connections: allow it (on Windows, for private
networks only).

How it works: the café still listens on 127.0.0.1 for this computer, and adds a second listener
on the chosen address (`apps/server/src/phone.ts`). Every request through that one needs the token, and the server checks
the `Host` header on both (`apps/server/src/remote.ts`). The computer has to be on and the café
running for the phone to reach it.

### Going live with your Claude subscription

1. Install [Claude Code](https://code.claude.com).
2. Open **Settings → Providers** and press **Connect** on Claude. Claude Code's own sign-in opens in a
   terminal window (and your browser); the card turns *Connected* when you're done. (The Claude desktop
   app's sign-in is separate; the `claude` command needs its own.)
3. On the same card, switch the upstairs floor to **Live**.
4. Under the message box, open the project chip and **add a project**: paste the full path of a
   folder once, then pick it by name from then on (like a checkout).
5. Send a task. In the box, pick the model (the choices reported by your signed-in Claude Code harness) and a permission:
   **Ask first** (default) or **Auto-accept edits** (commands still ask). When Claude Code wants to
   run a command or edit a file, the agent raises a hand and an **Allow / Deny** card appears.

Open an agent to see their threads, then open a thread to reply in that conversation (Claude Code
resumes the session). Use **New thread** in the thread list to start fresh. A reply stays in its
thread's project; each agent remembers the model, permission and project it used last.

Live runs count against your plan's normal usage limits; the top bar shows the current window.

Type `/` at the start of the message box to open the selected agent harness's command menu.
The list is scoped to the chosen project, so project-local skills appear alongside global ones.
`/skills` prints the current catalog without spending a model turn. Claude Code commands keep
their `/name` syntax; Codex skills are inserted with Codex's native `$name` syntax.

### Agents working together

Live Claude and Codex agents can discover teammates, send messages, delegate tasks, and read
the status of tasks in their collaboration. The Café server attributes and queues each exchange;
the sending agent cannot choose another sender identity or raise the recipient's permissions.

Try sending Earl a task such as:

> Implement this fix, then delegate a read-only review to Mocha. Incorporate the review and
> report what changed and how you verified it.

Both floors must be connected and in **Live** mode. Delegated tasks use the sender's project,
the recipient's model and permission setting, and a fresh harness conversation. Sending a
message continues the recipient's most recent completed conversation in that project, if one
exists; a reply to an ancestor continues that ancestor's original conversation. Recipients can
explicitly send replies. Messages do not automatically return replies; delegation does. A result, including a
failure or cancellation, queues a follow-up in the requester's original conversation. The
requester should finish its turn after dispatching work instead of polling. Task prompts show
the sender, recipient threads label messages/delegations/results, and the sender's thread
records outgoing exchanges. Start a **New thread** for Codex conversations created before
this feature so Codex registers the new tools.

Any agent can act as a coordinator. For example:

> Coordinate this investigation. Delegate backend inspection to Mocha and a read-only test
> review to Earl. Give them separate scopes. Collect their results and summarize the findings
> once both finish. Do not edit files until the reviews are complete.

The coordinator uses existing Café agents, each with its own Claude or Codex conversation.
Different agents work concurrently; each agent's own tasks remain queued in order. Automatic
creation of new agent identities and additional harness adapters are future work. Cross-agent
tools are available in Live mode; Demo agents retain their scripted behavior.

There is a shared limit of **12 outgoing exchanges** and **3 levels** per original request,
and agents cannot delegate to themselves or back to an ancestor. Automatic result deliveries
do not consume that limit. Cancelling a task cancels its outstanding descendant tasks and
suppresses follow-ups to that requester. Result delivery is persisted and deduplicated across
restarts; if the receiving provider is unavailable, delivery is retried on server restart.
Interrupted requesters are not silently resumed. Coordinate reviews or disjoint files: this
feature does not isolate worktrees or merge competing edits.

Tools: `cafe_list_agents`, `cafe_send_message`, `cafe_delegate_task`, `cafe_get_task`.
Claude receives these through an in-process MCP server; Codex uses App Server dynamic tools
(an experimental interface verified against the installed 0.154.0 schema).
Claude sessions load only the Café MCP server; personal, project, plugin and auto-discovered
claude.ai connectors are excluded from Café runs and model/usage checks. This setting applies
only to Café sessions and does not change your Claude configuration.

Live tasks check the signed-in harness's account model list before queuing work. If an agent's saved model
is no longer offered, Café uses an available model from the same family (or the account's
default), updates the saved preference, and records the change in the task. Explicit user
model choices are validated without substitution. Retrying a delegated task preserves its
sender and result routing. Chat bubbles show message/result content; attribution and resume
instructions are kept separately. Existing result history also hides the old internal wrapper.

### Going live with your ChatGPT subscription (Codex)

1. Install [Codex](https://developers.openai.com/codex) 0.154 or newer (the Codex desktop app ships
   one). Agent Café talks to it through `codex app-server`.
2. In **Settings → Providers**, press **Connect** on ChatGPT (it runs `codex login`), then switch the
   ground floor on. On Windows, Codex's sandbox must be set up (the Codex app does this); without
   it, live Codex tasks don't start.
3. Pick a project and send a task to a ground-floor agent. The model list is the one Codex offers
   your account.

How the permission picker maps to Codex: both settings run Codex with approval policy
`untrusted` and the `workspace-write` sandbox, and approvals always come to you (never Codex's
auto-reviewer). **Ask first** sends every file edit and every command Codex doesn't already trust
to an Allow / Deny card. **Auto-accept edits** lets Agent Café accept file edits itself when every
file the edit writes, including move destinations and resolved symlink/junction targets, is inside the project (the thread notes each
one); commands, and edits that reach outside the project, still ask. Agent Café pins the sandbox
(no network, no extra writable folders) over anything in `~/.codex/config.toml`, and refuses to
start a task if the policy Codex reports back is looser. Differences from Claude Code: approved
commands still run inside Codex's sandbox (they can write only in the project and temp folders,
with no network unless Codex asks again and you allow it), and read-only commands Codex already
trusts run without a card. Codex reports tokens and plan-limit
windows, never a price, so live tasks show no cost.

## What you're looking at

| In the café | Means |
|---|---|
| Sitting and typing, thought bubble | Waiting on the model |
| Walking to a station | Using a tool: bookcase = reading/searching, archive = editing/notes, register = commands |
| Hourglass at a station | Waiting on a tool result |
| `?` bubble | Waiting for you to allow or deny an action |
| Green ✓ bubble | Just finished |
| Red `!` | Failed |
| `zzz` | Demo task silent for over 60 s: probably stuck |
| Hoodie / office wear | Ground floor (OpenAI) / upstairs (Anthropic) |
| "Usage limit reached" sign | That floor's plan limit is used up for now |

The top bar answers the at-a-glance questions: how many are working, need you and are queued,
plus **Settings** (general, providers, projects); its gear shows a dot when a live floor can't run. **Needs you** lists
approvals first, then stuck demo agents and failures; allow, deny, retry, stop or dismiss them there.
Live harnesses stay working during silent thinking or long commands; silence alone does not mean they need you.

**Café view:** fold the side panel away (» at its top) and the café fills the screen. Agents that
need you get a callout, the message box floats bottom-right by the rail (it keeps your
draft when the panel comes back), and a rail on the right shows everyone's
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
| `CAFE_DEMO_TRAFFIC` | off | Set to `1` for a showcase café: idle Demo agents pick up sample tasks by themselves |

`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` and `OPENAI_API_KEY` / `CODEX_API_KEY` are deliberately
removed from the harnesses' environment, and Codex must be signed in with ChatGPT, so live runs
always use your subscription.

Live model pickers use only the connected harness's model list, including its default and
aliases. Demo catalogs appear only in Demo mode. If discovery fails or the harness is signed
out, the picker shows an empty/error state and Live sends are blocked until models can be
verified. Use **Refresh** in the model picker to recheck sign-in and available choices. Lists
expire after one minute and are invalidated by connection checks; switching accounts, plans,
or provider modes clears the browser's visible options. Live task submissions and model
changes in agent settings are also validated against the offered models.

Useful scripts: `pnpm test`, `pnpm typecheck`, `pnpm db:reset` (wipe and reseed).

The server brings the database up to date when it starts, from `apps/server/prisma/migrations`.
After changing `schema.prisma`, run `pnpm db:migrate` to add a migration (a test fails until you do).

## Architecture

```
apps/web (Next.js 16, Tailwind 4, canvas)           apps/server (Fastify 5, Prisma 7 / SQLite)
┌───────────────────────────────────────┐            ┌─────────────────────────────────────────┐
│ UI: TopBar · WorkBoard · AgentPanel   │   REST     │ routes/     agents · tasks · providers  │
│     Composer · CafeStage · SidePanel  │ ─────────► │ orchestrator/  Orchestrator (per-agent  │
│ store/  zustand + pure reducer        │            │   FIFO, routing, approvals, recovery)   │
│ sim/    layout · A* · activity · cats │   SSE      │   · runner (demo tool loop) · ambient   │
│ scene/  software rasteriser · sprites │ ◄───────── │ providers/  harness (sign-in, models) · │
└───────────────────────────────────────┘ CafeEvents │   claude (Agent SDK) · codex            │
                                                     │   (app-server) · mock · config          │
                                                     │ tools/  calculator · time · notes · file │
                                                     └─────────────────────────────────────────┘
          packages/shared: domain types · CafeEvent protocol · model catalog (used by both)
```

Key decisions:

- **Harnesses, not keys.** A floor's live tasks run on the vendor's agent (Claude Code via
  `@anthropic-ai/claude-agent-sdk`, driving your installed `claude`; Codex via JSON-RPC to
  `codex app-server`, one process per task). Their permission prompts become approvals in the café. See [docs/specs/2026-09-27-subscription-harnesses.md](docs/specs/2026-09-27-subscription-harnesses.md).
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
apps/server/src         app.ts · main.ts (startup) · index.ts (dev entry) · remote.ts (phone pairing) · services.ts (composition root)
  orchestrator/         orchestrator.ts · runner.ts · ambient.ts
  providers/            harness.ts · live.ts · claude.ts · codex.ts · codexRpc.ts · config.ts · mock.ts · registry.ts · types.ts
  tools/                registry.ts · calculator.ts · files.ts   (demo runs)
  routes/  db/  events/
apps/web/src
  app/                  layout.tsx · page.tsx · globals.css (design tokens)
  components/           CafeApp · TopBar · SidePanel · AgentThread · Composer · pickers · CafeStage · CafeScene
  store/                reduce.ts (pure, incl. needsAttention) · cafe.ts (zustand)
  sim/                  layout.ts · pathfinding.ts · activity.ts · world.ts · cats.ts
  scene/                renderer.ts · building.ts · props.ts · outdoor.ts · atmosphere.ts · sprites.ts · raster.ts
  lib/                  api.ts · stream.ts · theme.ts (auto themes) · format.ts
apps/cli/src            cli.ts · options.ts · browser.ts · network.ts · token.ts   (the `agent-cafe` command; build.mjs bundles it)
docs/                   specs/ (design decisions) · plans/ (implementation plans)
```

## Roadmap

- **Done:** orchestrator with queues and recovery, demo provider, SSE; stacked café on a street
  corner with cats, side panel with agent threads and café view, auto themes; Claude Code on the
  Anthropic floor with projects, per-message models and resumable conversations; Codex
  (`codex app-server`) on the OpenAI floor, signed in with `codex login`.
- **Later:** "always allow" rules, history page,
  live weather (Open-Meteo), `POST /api/events` ingest so outside sessions appear as visiting agents.
