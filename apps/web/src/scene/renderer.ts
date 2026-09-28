/**
 * Runs the café: steps the simulation, renders a frame into a 400×360
 * framebuffer, and pushes it to a <canvas> that CSS scales up with
 * `image-rendering: pixelated`. About 15 fps is plenty for pixel art.
 *
 * A timer (not requestAnimationFrame) drives the loop so it keeps ticking in
 * embedded previews; it skips frames while the tab is hidden.
 */
import type { ProviderId, ProviderMode } from '@agent-cafe/shared';
import { Cats } from '@/sim/cats';
import { World } from '@/sim/world';
import type { CafeData } from '@/store/reduce';
import type { ThemeId } from './atmosphere';
import { renderScene, SCENE_H, SCENE_W, type AgentHit, type SceneAgent } from './building';
import { Raster } from './raster';

export { SCENE_H, SCENE_W, type AgentHit };

export interface SceneState {
  data: CafeData;
  selectedAgentId: string | null;
  theme: ThemeId;
  labels: boolean;
  transparent: boolean;
}

export interface SceneHooks {
  read(): SceneState;
  pickAgent(id: string): void;
  /** Hover target changed (null = nothing). Coordinates are scene px of the head. */
  hover(target: { id: string; x: number; y: number } | null): void;
  /** Every frame, with each agent's bounds (for callouts that follow agents). */
  frame?(hits: AgentHit[]): void;
}

const FRAME_MS = 66;

export class CafeRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly raster = new Raster(SCENE_W, SCENE_H);
  private readonly world = new World();
  private readonly cats = new Cats();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = 0;
  private readonly t0 = Date.now();
  private hits: AgentHit[] = [];
  private hovered: string | null = null;
  private pointer: { x: number; y: number } | null = null;

  constructor(private readonly hooks: SceneHooks) {}

  mount(host: HTMLElement): void {
    const canvas = document.createElement('canvas');
    canvas.width = SCENE_W;
    canvas.height = SCENE_H;
    canvas.className = 'pixelated block h-full w-full';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The café: Anthropic agents upstairs, OpenAI agents in the café below');
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('click', this.onClick);
    host.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.last = performance.now();
    this.loop();
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.canvas) {
      this.canvas.removeEventListener('pointermove', this.onMove);
      this.canvas.removeEventListener('pointerleave', this.onLeave);
      this.canvas.removeEventListener('click', this.onClick);
      this.canvas.remove();
    }
    this.canvas = null;
    this.ctx = null;
  }

  private loop = () => {
    if (!this.canvas) return;
    if (document.visibilityState !== 'hidden') this.tick();
    this.timer = setTimeout(this.loop, FRAME_MS);
  };

  private tick() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    const s = this.hooks.read();
    this.world.update(dt, s.data, Date.now());
    this.cats.update(dt);

    const agents: SceneAgent[] = this.world.agents.map((v) => ({
      id: v.id, name: v.name, providerId: v.providerId, x: v.x, y: v.y, face: v.face,
      pose: v.pose, t: v.t, bubble: v.bubble, spriteSeed: v.spriteSeed, demo: v.demo,
    }));
    const floors: Partial<Record<ProviderId, { mode: ProviderMode; closed: boolean }>> = {};
    for (const p of Object.values(s.data.providers)) if (p) floors[p.id] = { mode: p.mode, closed: p.closed };

    this.hits = renderScene(this.raster, agents, {
      theme: s.theme,
      t: (Date.now() - this.t0) / 1000,
      transparent: s.transparent,
      labels: s.labels,
      selectedId: s.selectedAgentId,
      floors,
      cats: this.cats.views,
    });
    this.ctx?.putImageData(new ImageData(this.raster.d, SCENE_W, SCENE_H), 0, 0);
    this.hooks.frame?.(this.hits);
    this.updateHover();
  }

  // ── pointer ──────────────────────────────────────────────────────────────

  private toScene(e: MouseEvent) {
    const r = this.canvas!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SCENE_W, y: ((e.clientY - r.top) / r.height) * SCENE_H };
  }

  /** Front-most agent under a point (later hits were drawn on top). */
  private hitAt(p: { x: number; y: number }): AgentHit | undefined {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (p.x >= h.x0 && p.x <= h.x1 && p.y >= h.y0 && p.y <= h.y1) return h;
    }
    return undefined;
  }

  private updateHover() {
    const h = this.pointer ? this.hitAt(this.pointer) : undefined;
    if (this.canvas) this.canvas.style.cursor = h ? 'pointer' : 'default';
    if (h) this.hooks.hover({ id: h.id, x: h.headX, y: h.headY });
    else if (this.hovered) this.hooks.hover(null);
    this.hovered = h?.id ?? null;
  }

  private onMove = (e: PointerEvent) => {
    this.pointer = this.toScene(e);
    this.updateHover();
  };

  private onLeave = () => {
    this.pointer = null;
    this.updateHover();
  };

  private onClick = (e: MouseEvent) => {
    const h = this.hitAt(this.toScene(e));
    if (h) this.hooks.pickAgent(h.id);
  };
}
