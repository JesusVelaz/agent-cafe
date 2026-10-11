# Agents Café — Redesign Implementation Plan (post-Phase-1 checkpoint)

> Executed inline. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Phase 1 café with the approved design: a stacked, set-back building with cosy
detail, a café + work board layout with Focus mode, and automatic themes.

**Architecture:** The orchestration layer (server) is unchanged. On the web side, the simulation
moves to continuous floor coordinates on a half-tile pathing grid. The Pixi renderer is replaced
by a Canvas 2D software rasteriser, ported from the approved mockup renderer, with a lighting
pass. The UI shell becomes TopBar + Café + WorkBoard (or Focus mode).

**Spec:** `docs/specs/2026-09-27-agent-cafe-design.md` (decisions 6–9, 13, 16 and §8)

## Global constraints

- Logical scene is 400×360. It is upscaled by a whole number when it fits, with CSS `image-rendering: pixelated`.
- Ground floor is 14×11 tiles with a 62 px story. The upper floor is 9×6 tiles at z = 62. Ground = `openai`, upstairs = `anthropic`.
- Stairs are hidden; the stairwell opening is at the upper floor's back-left corner (x 0.25–1.85, y 0.25–1.85).
- Nothing tall sits under the upper floor except near its front edge. The visibility rule is height < 56 − (6 − y)·6 px.
- Theme auto: 20:00–06:00 is night, 17:30–20:00 is summer (golden hour), otherwise day. Dec–Feb daytime is snow. A manual override is stored in `localStorage` (`cafe.theme`).
- No new server work. SSE, the store and the reducer stay as they are.

## Tasks

### R1 · Scene engine (apps/web/src/scene/)
Port `cafe-scene.js` from the mockup into typed modules:
`raster.ts` (framebuffer, poly/line/grid), `font.ts` (3×5), `iso.ts` (projection, box, plane, quad, disc),
`palette.ts`, `sprites.ts` (agents + accessories, icons, props), `props.ts` (furniture draw functions),
`atmosphere.ts` (themes, backdrop, weather, lighting grade), `building.ts` (static layout draw items for
the stacked café), `renderer.ts` (frame loop, agents from the World, bubbles/names, hit boxes).
- [ ] Tests: poly fill covers exactly the expected pixels for an axis-aligned square; sprite and accessory grids are rectangular; `grade` leaves emissive pixels untouched.

### R2 · Simulation on the new floor plan
`sim/layout.ts`: floors in continuous coordinates, props with footprints, stations and seats as spots,
pathing grid at 0.5 tile. `sim/pathfinding.ts`: A* over cells. `sim/world.ts`: positions in continuous
coordinates, walking between cell centres.
- [ ] Tests: every seat and station is on a free cell and reachable; paths avoid footprints; a tool visit walks to the station and back.

### R3 · Themes
`lib/theme.ts`: `resolveTheme(date, override) → ThemeId` and `useTheme()`.
- [ ] Tests: 22:00 gives night, 18:30 in July gives summer, noon in January gives snow, noon in May gives day, an override wins.

### R4 · UI shell
TopBar (brand, counts, spend, theme picker with Auto, Focus toggle). `WorkBoard` (composer, Needs you,
Working now, Finished recently, queued and idle lines). `AgentDetail` shown in the board when an agent
is selected. `FocusMode` (callouts for agents that need you plus hover, command bar, drawer).
Remove CrewRoster, OrderPad and the old Inspector shell.
- [ ] Reducer and selector tests for `needsAttention()`.

### R5 · Cleanup and verification
Remove `pixi.js` and the old scene files. `pnpm test` and `pnpm typecheck` pass. In the browser: the
default layout, selecting an agent, Focus mode, every theme, sending a task, and a failure reaching
"Needs you". Commit.
