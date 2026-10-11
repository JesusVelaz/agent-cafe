/**
 * Runs the café: steps the simulation, renders a frame into a framebuffer (at
 * least SCENE_W×SCENE_H; the stage sizes it to fill its width and height, with the
 * plot centred), and pushes it to a <canvas> that CSS scales up with
 * `image-rendering: pixelated`. About 15 fps is plenty for pixel art; while the
 * café is turning it runs at 60 so the turn is smooth.
 *
 * A timer (not requestAnimationFrame) drives the loop so it keeps ticking in
 * embedded previews; it skips frames while the tab is hidden.
 *
 * Turning: the café rests on one of four quarter turns (the store's viewAngle).
 * Dragging sideways spins it freely; on release it eases onto the nearest quarter.
 */
import type { ProviderId, ProviderMode } from '@agent-cafe/shared';
import { Cats } from '@/sim/cats';
import { World } from '@/sim/world';
import type { CafeData } from '@/store/reduce';
import type { ThemeId } from './atmosphere';
import { inside, renderScene, SCENE_H, SCENE_W, type AgentHit, type SceneAgent } from './building';
import type { Pt2 } from './raster';
import { Raster } from './raster';

export { SCENE_H, SCENE_W, type AgentHit };

export interface SceneState {
  data: CafeData;
  selectedAgentId: string | null;
  theme: ThemeId;
  labels: boolean;
  transparent: boolean;
  /** The quarter turn (0–3) the café should rest at. */
  viewAngle: number;
}

export interface SceneHooks {
  read(): SceneState;
  pickAgent(id: string): void;
  /** Hover target changed (null = nothing). Coordinates are scene px of the head. */
  hover(target: { id: string; x: number; y: number } | null): void;
  /** Every frame, with each agent's bounds (for callouts that follow agents). */
  frame?(hits: AgentHit[]): void;
  /** The user dragged the café round to this quarter turn (0–3). */
  turned?(quarter: number): void;
}

const FRAME_MS = 66;
const TURN_FRAME_MS = 16;
const QUARTER = Math.PI / 2;
/** Radians of turn per CSS pixel dragged. */
const DRAG_TURN = 0.008;
/** How far a press has to move before it's a drag rather than a click (CSS px). */
const DRAG_SLOP = 5;

const quarterOf = (a: number) => ((Math.round(a / QUARTER) % 4) + 4) % 4;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Target = { kind: 'agent' | 'cat'; hit: AgentHit };

export class CafeRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raster = new Raster(SCENE_W, SCENE_H);
  private readonly world = new World();
  private readonly cats = new Cats();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = 0;
  private readonly t0 = Date.now();
  private hits: AgentHit[] = [];
  private catHits: AgentHit[] = [];
  /** The café's outline on screen this frame: only there does the cursor offer a grab. */
  private outline: Pt2[] = [];
  private hovered: string | null = null;
  private pointer: { x: number; y: number } | null = null;
  /** When each cat was last petted, in scene seconds. */
  private readonly petted = new Map<string, number>();

  /** Camera angle now and where it's easing to (radians, unwrapped so a turn takes the short way). */
  private angle: number | null = null;
  private target = 0;
  /** The store's quarter the target was last set from. */
  private quarter = 0;
  private drag: { x: number; angle: number; turning: boolean } | null = null;
  /** The click that ends a drag isn't a click. */
  private swallowClick = false;

  constructor(private readonly hooks: SceneHooks) {}

  mount(host: HTMLElement): void {
    const canvas = document.createElement('canvas');
    canvas.width = this.raster.w;
    canvas.height = this.raster.h;
    canvas.className = 'pixelated block h-full w-full';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The café: Anthropic agents upstairs, OpenAI agents in the café below. Drag sideways to turn it.');
    // Sideways drags turn the café; vertical swipes still scroll the page on touch screens.
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('click', this.onClick);
    host.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.last = performance.now();
    this.loop();
  }

  /**
   * Frame size in scene px (the stage's size over its pixel scale), never below the
   * base frame. Resizing a canvas wipes it, so the new frame is drawn straight away:
   * called before paint (from a ResizeObserver), the stage never shows a blank or
   * stretched frame while the panel slides open or shut.
   */
  resize(w: number, h: number): void {
    w = Math.max(SCENE_W, Math.round(w));
    h = Math.max(SCENE_H, Math.round(h));
    if (w === this.raster.w && h === this.raster.h) return;
    this.raster = new Raster(w, h);
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.draw();
    }
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onDown);
      this.canvas.removeEventListener('pointermove', this.onMove);
      this.canvas.removeEventListener('pointerup', this.onUp);
      this.canvas.removeEventListener('pointercancel', this.onUp);
      this.canvas.removeEventListener('pointerleave', this.onLeave);
      this.canvas.removeEventListener('click', this.onClick);
      this.canvas.remove();
    }
    this.canvas = null;
    this.ctx = null;
  }

  /** The camera's angle right now (radians, unwrapped). */
  get cameraAngle(): number {
    return this.angle ?? 0;
  }

  /** Is the café mid-turn (being dragged, or easing onto a quarter)? */
  get turning(): boolean {
    return Boolean(this.drag?.turning) || (this.angle !== null && Math.abs(this.target - this.angle) > 1e-3);
  }

  private loop = () => {
    if (!this.canvas) return;
    if (document.visibilityState !== 'hidden') this.tick();
    this.timer = setTimeout(this.loop, this.turning ? TURN_FRAME_MS : FRAME_MS);
  };

  private tick() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.world.update(dt, this.hooks.read().data, Date.now());
    this.cats.update(dt);
    this.steer(dt);
    this.draw();
  }

  /** Follow the store's quarter turn, easing the camera onto it. */
  private steer(dt: number) {
    const q = this.hooks.read().viewAngle;
    if (this.angle === null) {
      // First frame: start where the café was left, no turn.
      this.quarter = q;
      this.angle = this.target = q * QUARTER;
      return;
    }
    if (q !== this.quarter) {
      // The short way round: a quarter either way, or a half turn.
      const d = (((q - this.quarter) % 4) + 4) % 4;
      this.target += (d === 3 ? -1 : d) * QUARTER;
      this.quarter = q;
    }
    if (this.drag?.turning) return;
    const diff = this.target - this.angle;
    this.angle = Math.abs(diff) < 1e-3 || reducedMotion() ? this.target : this.angle + diff * (1 - Math.exp(-dt * 10));
  }

  /** Render the current state (no simulation step) and push it to the canvas. */
  private draw() {
    const s = this.hooks.read();
    const agents: SceneAgent[] = this.world.agents.map((v) => ({
      id: v.id, name: v.name, providerId: v.providerId, x: v.x, y: v.y, face: v.face,
      pose: v.pose, t: v.t, bubble: v.bubble, spriteSeed: v.spriteSeed, demo: v.demo,
    }));
    const floors: Partial<Record<ProviderId, { mode: ProviderMode; closed: boolean }>> = {};
    for (const p of Object.values(s.data.providers)) if (p) floors[p.id] = { mode: p.mode, closed: p.closed };

    const hits = renderScene(this.raster, agents, {
      theme: s.theme,
      t: this.sceneTime(),
      transparent: s.transparent,
      labels: s.labels,
      selectedId: s.selectedAgentId,
      floors,
      cats: this.cats.views,
      petted: this.petted,
      angle: this.angle ?? s.viewAngle * QUARTER,
    });
    this.hits = hits.agents;
    this.catHits = hits.cats;
    this.outline = hits.outline;
    this.ctx?.putImageData(new ImageData(this.raster.d, this.raster.w, this.raster.h), 0, 0);
    this.hooks.frame?.(this.hits);
    this.updateHover();
  }

  private sceneTime() {
    return (Date.now() - this.t0) / 1000;
  }

  // ── pointer ──────────────────────────────────────────────────────────────

  private toScene(e: MouseEvent) {
    const r = this.canvas!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.raster.w, y: ((e.clientY - r.top) / r.height) * this.raster.h };
  }

  /** Front-most agent under a point (later hits were drawn on top), else a cat. */
  private hitAt(p: { x: number; y: number }): Target | undefined {
    const inside = (h: AgentHit) => p.x >= h.x0 && p.x <= h.x1 && p.y >= h.y0 && p.y <= h.y1;
    for (let i = this.hits.length - 1; i >= 0; i--) if (inside(this.hits[i]!)) return { kind: 'agent', hit: this.hits[i]! };
    for (let i = this.catHits.length - 1; i >= 0; i--) if (inside(this.catHits[i]!)) return { kind: 'cat', hit: this.catHits[i]! };
    return undefined;
  }

  private updateHover() {
    const t = this.pointer && !this.drag?.turning ? this.hitAt(this.pointer) : undefined;
    const onCafe = Boolean(this.pointer) && inside(this.outline, this.pointer!.x, this.pointer!.y);
    if (this.canvas) this.canvas.style.cursor = this.drag?.turning ? 'grabbing' : t ? 'pointer' : onCafe ? 'grab' : 'default';
    const h = t?.kind === 'agent' ? t.hit : undefined;
    if (h) this.hooks.hover({ id: h.id, x: h.headX, y: h.headY });
    else if (this.hovered) this.hooks.hover(null);
    this.hovered = h?.id ?? null;
  }

  private onDown = (e: PointerEvent) => {
    this.swallowClick = false;
    if (e.button !== 0 || this.angle === null) return;
    // Only the café itself can be grabbed; the sky around it can't.
    const p = this.toScene(e);
    if (!inside(this.outline, p.x, p.y)) return;
    this.drag = { x: e.clientX, angle: this.angle, turning: false };
  };

  private onMove = (e: PointerEvent) => {
    this.pointer = this.toScene(e);
    const d = this.drag;
    if (d) {
      const dx = e.clientX - d.x;
      if (!d.turning && Math.abs(dx) > DRAG_SLOP) {
        d.turning = true;
        this.canvas?.setPointerCapture?.(e.pointerId);
      }
      // Dragging right brings the side on the left round to the front.
      if (d.turning) this.angle = d.angle - dx * DRAG_TURN;
    }
    this.updateHover();
  };

  private onUp = () => {
    const d = this.drag;
    this.drag = null;
    if (!d?.turning || this.angle === null) return;
    this.swallowClick = true;
    // Settle on the nearest quarter, and tell the store so it's remembered.
    const q = Math.round(this.angle / QUARTER);
    this.target = q * QUARTER;
    this.quarter = quarterOf(this.target);
    this.hooks.turned?.(this.quarter);
    this.updateHover();
  };

  private onLeave = () => {
    this.pointer = null;
    this.updateHover();
  };

  private onClick = (e: MouseEvent) => {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    const t = this.hitAt(this.toScene(e));
    if (t?.kind === 'agent') this.hooks.pickAgent(t.hit.id);
    else if (t?.kind === 'cat') {
      this.petted.set(t.hit.id, this.sceneTime());
      this.cats.pet(t.hit.id);
    }
  };
}
