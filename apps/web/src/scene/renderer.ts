/**
 * Pixi renderer for the café. Draws at a fixed low resolution (SCENE_W×SCENE_H)
 * and is upscaled by CSS with `image-rendering: pixelated`, so every shape lands on
 * a chunky, consistent pixel grid.
 *
 * Owns the simulation World; each frame: read store → step world → sync sprites.
 */
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  TextureSource,
} from 'pixi.js';
import type { ProviderId, TaskDTO, ToolName } from '@agent-cafe/shared';
import { FLOORS, FLOOR_D, FLOOR_ORDER, FLOOR_W } from '@/sim/layout';
import { World, type AgentView } from '@/sim/world';
import { queuedFor, type CafeData } from '@/store/reduce';
import { floorQuad, proj, wallPoint, type Origin } from './iso';
import { C } from './palette';
import { drawText, textWidth } from './pixelFont';
import { SpriteRegistry } from './registry';
import { buildFloor, depthOf } from './room';
import type { IconName } from './sprites';

export const SCENE_W = 440;
export const SCENE_H = 380;

/** The exploded stack: the loft sits up and back along the ground floor's right wall. */
export const ORIGINS: Record<ProviderId, Origin> = {
  openai: { ox: 140, oy: 216 },
  anthropic: { ox: 240, oy: 74 },
};

const LABEL_AT: Record<ProviderId, { x: number; y: number }> = {
  openai: { x: 246, y: 352 },
  anthropic: { x: 14, y: 22 },
};

export type HoverTarget =
  | { kind: 'agent'; id: string }
  | { kind: 'task'; id: string; agentId: string; source: 'cup' | 'ticket' };

export interface SceneHooks {
  read(): { data: CafeData; selectedAgentId: string | null };
  pickAgent(id: string): void;
  pickTask(taskId: string, agentId: string): void;
  /** Hover target changed (null = nothing). */
  hover(target: HoverTarget | null): void;
  /** Called every frame while something is hovered, with its anchor in scene px. */
  hoverAt(x: number, y: number): void;
}

const TOOL_ICON: Record<ToolName, IconName> = {
  calculator: 'calculator',
  current_time: 'clock',
  notes_read: 'note',
  notes_write: 'note',
  read_file: 'book',
  list_files: 'book',
};

interface AgentNode {
  root: Container;
  shadow: Graphics;
  marker: Graphics;
  sprite: Sprite;
  label: Graphics;
  labelKey: string;
  bubble: Container;
  bubbleBg: Graphics;
  bubbleIcon: Sprite;
  bubbleDots: Graphics;
}

interface FloorNodes {
  root: Container;
  sorted: Container;
  tickets: Container;
  signs: Container;
  signKey: string;
}

export class CafeRenderer {
  private app: Application | null = null;
  private destroyed = false;
  private readonly world = new World();
  private readonly reg = new SpriteRegistry();
  private readonly agentNodes = new Map<string, AgentNode>();
  private floors = {} as Record<ProviderId, FloorNodes>;
  private overlay = new Container();
  private leds: Graphics[] = [];
  private time = 0;
  private lastTasks: CafeData['tasks'] | null = null;
  private hovered: HoverTarget | null = null;
  private hoverPoint = { x: 0, y: 0 };

  constructor(private readonly hooks: SceneHooks) {}

  /**
   * Creates a fresh canvas inside `host`. (Reusing a canvas across mounts breaks
   * under React strict mode: Pixi's teardown loses that canvas's WebGL context.)
   */
  async mount(host: HTMLElement): Promise<void> {
    TextureSource.defaultOptions.scaleMode = 'nearest';
    const canvas = document.createElement('canvas');
    canvas.className = 'pixelated block h-full w-full';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The café: agents at work on two floors');
    const app = new Application();
    await app.init({
      canvas,
      width: SCENE_W,
      height: SCENE_H,
      antialias: false,
      backgroundAlpha: 0,
      resolution: 1,
      autoDensity: false,
      roundPixels: true,
      preference: 'webgl',
    });
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true });
      return;
    }
    host.appendChild(canvas);
    this.app = app;
    this.buildStatic();
    app.ticker.add((t) => this.tick(Math.min(t.deltaMS / 1000, 0.1)));
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app) {
      this.app.destroy({ removeView: true }, { children: true });
      this.app = null;
    }
    this.reg.destroy();
  }

  // ── Static scene ──────────────────────────────────────────────────────────

  private buildStatic() {
    const stage = this.app!.stage;
    for (const id of FLOOR_ORDER) {
      const o = ORIGINS[id];
      const scenery = buildFloor(FLOORS[id], o, this.reg);
      const root = new Container();
      const sorted = new Container();
      sorted.sortableChildren = true;
      const tickets = new Container();
      const signs = new Container();
      root.addChild(scenery.base, tickets, sorted, signs);
      for (const p of scenery.pieces) {
        p.node.zIndex = p.depth;
        sorted.addChild(p.node);
      }
      this.leds.push(...scenery.leds);
      stage.addChild(root);
      this.floors[id] = { root, sorted, tickets, signs, signKey: '' };
    }
    stage.addChild(this.overlay);
    stage.eventMode = 'static';
    stage.hitArea = new Rectangle(0, 0, SCENE_W, SCENE_H);
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  private tick(dt: number) {
    const { data, selectedAgentId } = this.hooks.read();
    this.time += dt;
    this.world.update(dt, data, Date.now());

    this.syncAgents(this.world.agents, selectedAgentId);
    if (data.tasks !== this.lastTasks) {
      this.lastTasks = data.tasks;
      for (const id of FLOOR_ORDER) {
        this.syncTickets(id, data);
        this.syncCups(id, data);
      }
    }
    for (const id of FLOOR_ORDER) this.syncSigns(id, data);
    this.animateCups();

    const blink = Math.floor(this.time * 2) % 2 === 0;
    this.leds.forEach((l, i) => (l.alpha = blink === (i % 2 === 0) ? 1 : 0.35));

    if (this.hovered) this.hooks.hoverAt(this.hoverPoint.x, this.hoverPoint.y);
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  private syncAgents(views: AgentView[], selectedId: string | null) {
    const alive = new Set<string>();
    for (const v of views) {
      alive.add(v.id);
      const node = this.agentNodes.get(v.id) ?? this.createAgent(v);
      const floor = this.floors[v.providerId];
      if (node.root.parent !== floor.sorted) floor.sorted.addChild(node.root);

      const o = ORIGINS[v.providerId];
      const feet = proj(o, v.x + 0.5, v.y + 0.5, 0);
      const seated = v.pose === 'sit' || v.pose === 'type' || v.pose === 'slump' || v.pose === 'sleep';
      const front = v.face === 'x+' || v.face === 'y+';
      const tex = this.reg.agent(v.spriteSeed, v.demo)[front ? 'front' : 'back'];

      let frame: keyof typeof tex = 'stand';
      let bob = 0;
      switch (v.pose) {
        case 'walk':
          frame = (['walkA', 'stand', 'walkB', 'stand'] as const)[Math.floor(v.t * 8) % 4]!;
          bob = Math.floor(v.t * 8) % 2 ? -1 : 0;
          break;
        case 'sit':
          frame = 'sit';
          bob = (v.t + v.spriteSeed) % 3 < 0.35 ? -1 : 0; // slow breathing
          break;
        case 'type':
          frame = Math.floor(v.t * 6) % 2 ? 'typeA' : 'typeB';
          break;
        case 'work':
          frame = 'stand';
          bob = Math.floor(v.t * 3) % 2 ? -1 : 0;
          break;
        case 'slump':
        case 'sleep':
          frame = 'slump';
          bob = 1;
          break;
        default:
          frame = 'stand';
      }
      node.sprite.texture = tex[frame];
      node.sprite.position.set(feet.x, feet.y + (seated ? -1 : 1) + bob);
      node.root.zIndex = depthOf(v.x, v.y, 6);

      const selected = v.id === selectedId;
      node.marker.visible = selected;
      node.marker.position.set(feet.x, feet.y);
      node.shadow.position.set(feet.x, feet.y);

      // Name tag + bubble live in the overlay so furniture never hides them.
      const headY = feet.y + (seated ? -1 : 1) - 20 + (seated ? 3 : 0);
      const labelKey = `${v.name}|${selected}`;
      if (node.labelKey !== labelKey) {
        node.label.clear();
        const name = v.name.toUpperCase().slice(0, 12);
        drawText(node.label, name, -Math.floor(textWidth(name) / 2), 0, {
          color: selected ? C.brass : C.white,
          outline: C.ink,
        });
        node.labelKey = labelKey;
      }
      node.label.position.set(feet.x, headY - 8);
      this.syncBubble(node, v, feet.x, headY);

      if (this.hovered?.kind === 'agent' && this.hovered.id === v.id) this.hoverPoint = { x: feet.x, y: headY - 10 };
    }
    for (const [id, node] of this.agentNodes) {
      if (!alive.has(id)) {
        node.root.destroy({ children: true });
        node.label.destroy();
        node.bubble.destroy({ children: true });
        this.agentNodes.delete(id);
      }
    }
  }

  private createAgent(v: AgentView): AgentNode {
    const root = new Container();
    // Soft pixel shadow grounds the sprite on the floor.
    const marker = new Graphics();
    const shadow = new Graphics();
    shadow.rect(-3, -1, 7, 1).fill({ color: C.ink, alpha: 0.25 });
    shadow.rect(-4, 0, 9, 1).fill({ color: C.ink, alpha: 0.3 });
    shadow.rect(-3, 1, 7, 1).fill({ color: C.ink, alpha: 0.2 });
    // Brass selection diamond on the floor.
    marker.poly([0, -5, 10, 0, 0, 5, -10, 0]).stroke({ width: 1, color: C.brass });
    marker.poly([0, -3, 6, 0, 0, 3, -6, 0]).fill({ color: C.brass, alpha: 0.35 });
    const sprite = new Sprite();
    sprite.anchor.set(0.5, 1);
    sprite.eventMode = 'static';
    sprite.cursor = 'pointer';
    sprite.hitArea = new Rectangle(-8, -22, 16, 24);
    sprite.on('pointertap', () => this.hooks.pickAgent(v.id));
    sprite.on('pointerover', () => this.setHover({ kind: 'agent', id: v.id }));
    sprite.on('pointerout', () => this.clearHover({ kind: 'agent', id: v.id }));
    root.addChild(shadow, marker, sprite);

    const label = new Graphics();
    const bubble = new Container();
    const bubbleBg = new Graphics();
    // 11×9 speech bubble with a tail toward the head.
    bubbleBg.rect(1, 0, 11, 1).fill(C.ink).rect(0, 1, 13, 7).fill(C.ink).rect(1, 8, 11, 1).fill(C.ink);
    bubbleBg.rect(1, 1, 11, 7).fill(C.white);
    bubbleBg.rect(1, 9, 2, 1).fill(C.ink).rect(0, 10, 1, 1).fill(C.ink);
    const bubbleIcon = new Sprite();
    bubbleIcon.position.set(3, 2);
    const bubbleDots = new Graphics();
    bubble.addChild(bubbleBg, bubbleIcon, bubbleDots);
    this.overlay.addChild(label, bubble);

    const node: AgentNode = { root, shadow, marker, sprite, label, labelKey: '', bubble, bubbleBg, bubbleIcon, bubbleDots };
    this.agentNodes.set(v.id, node);
    return node;
  }

  private syncBubble(node: AgentNode, v: AgentView, x: number, headY: number) {
    const b = v.bubble;
    node.bubble.visible = Boolean(b);
    if (!b) return;
    // Up and to the right of the name tag, tail pointing back at the head.
    const nameHalf = Math.ceil(textWidth(v.name.slice(0, 12)) / 2);
    node.bubble.position.set(x + Math.max(5, nameHalf + 2), headY - 18);
    node.bubbleDots.clear();
    node.bubbleIcon.visible = true;
    node.bubbleBg.visible = true;
    switch (b.kind) {
      case 'think': {
        node.bubbleIcon.visible = false;
        const n = Math.floor(this.time * 3) % 4; // 0..3 dots
        for (let i = 0; i < Math.max(1, n); i++) node.bubbleDots.rect(3 + i * 3, 4, 2, 2).fill(C.ink);
        break;
      }
      case 'tool':
        node.bubbleIcon.texture = this.reg.icon(TOOL_ICON[b.tool]);
        break;
      case 'wait':
        node.bubbleIcon.texture = this.reg.icon('hourglass');
        break;
      case 'done':
        node.bubbleIcon.texture = this.reg.icon('check');
        break;
      case 'fail':
        node.bubbleIcon.texture = this.reg.icon('alert');
        node.bubble.position.y += Math.floor(this.time * 4) % 2 ? -1 : 0;
        break;
      case 'zzz':
        node.bubbleBg.visible = false;
        node.bubbleIcon.texture = this.reg.icon('zzz');
        node.bubble.position.y -= Math.floor((this.time * 4) % 4);
        break;
    }
  }

  // ── Tickets (queue) and cups (results) ────────────────────────────────────

  private floorTasks(id: ProviderId, data: CafeData) {
    const agentFloor = (t: TaskDTO) => data.agents[t.agentId]?.providerId ?? t.providerId;
    return Object.values(data.tasks).filter((t) => agentFloor(t) === id);
  }

  private syncTickets(id: ProviderId, data: CafeData) {
    const layer = this.floors[id].tickets;
    for (const c of layer.removeChildren()) c.destroy();
    const queued = queuedFor({ tasks: Object.fromEntries(this.floorTasks(id, data).map((t) => [t.id, t])) });
    const wall = FLOORS[id].ticketWall;
    const o = ORIGINS[id];
    const perRow = Math.floor((wall.span - 0.3) / 0.5);
    const max = wall.kind === 'corkboard' ? perRow * 2 : perRow;
    queued.slice(0, max).forEach((task, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const u = wall.wall === 'right' ? wall.at + 0.35 + col * 0.5 : wall.at + wall.span - 0.35 - col * 0.5;
      const v = wall.kind === 'corkboard' ? 42 - row * 10 : 39;
      const p = wallPoint(o, wall.wall, u, v);
      const s = new Sprite(this.reg.ticket());
      s.anchor.set(0.5, 0);
      s.position.set(p.x, p.y);
      s.eventMode = 'static';
      s.cursor = 'pointer';
      s.hitArea = new Rectangle(-4, -1, 8, 10);
      const target: HoverTarget = { kind: 'task', id: task.id, agentId: task.agentId, source: 'ticket' };
      s.on('pointertap', () => this.hooks.pickTask(task.id, task.agentId));
      s.on('pointerover', () => {
        this.hoverPoint = { x: p.x, y: p.y - 2 };
        this.setHover(target);
      });
      s.on('pointerout', () => this.clearHover(target));
      layer.addChild(s);
    });
    if (queued.length > max) {
      const g = new Graphics();
      const p = wallPoint(o, wall.wall, wall.wall === 'right' ? wall.at + wall.span : wall.at, 30);
      drawText(g, `+${queued.length - max}`, p.x - 4, p.y, { color: C.white, outline: C.ink });
      layer.addChild(g);
    }
  }

  private cupSprites: Array<{ sprite: Sprite; steam: Graphics; finishedAt: number }> = [];

  private syncCups(id: ProviderId, data: CafeData) {
    const floor = this.floors[id];
    // Remove this floor's old cups.
    this.cupSprites = this.cupSprites.filter((c) => {
      if (c.sprite.parent === floor.sorted) {
        c.sprite.destroy();
        c.steam.destroy();
        return false;
      }
      return true;
    });
    const layout = FLOORS[id];
    const o = ORIGINS[id];
    const perSlot = 3;
    const finished = this.floorTasks(id, data)
      .filter((t) => t.finishedAt && (t.status === 'completed' || t.status === 'failed' || t.status === 'interrupted'))
      .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!))
      .slice(0, layout.cupSlots.length * perSlot);
    const offsets = [
      [0.28, 0.35],
      [0.55, 0.5],
      [0.8, 0.62],
    ] as const;
    finished.forEach((task, i) => {
      const slot = layout.cupSlots[Math.floor(i / perSlot)]!;
      const [dx, dy] = offsets[i % perSlot]!;
      const p = proj(o, slot.x + dx, slot.y + dy, 17);
      const failed = task.status !== 'completed';
      const sprite = new Sprite(this.reg.cup(failed));
      sprite.anchor.set(0.5, 1);
      sprite.position.set(p.x, p.y + 1);
      sprite.zIndex = depthOf(slot.x, slot.y, 5.5);
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';
      sprite.hitArea = new Rectangle(-4, -7, 8, 9);
      const target: HoverTarget = { kind: 'task', id: task.id, agentId: task.agentId, source: 'cup' };
      sprite.on('pointertap', () => this.hooks.pickTask(task.id, task.agentId));
      sprite.on('pointerover', () => {
        this.hoverPoint = { x: p.x, y: p.y - 6 };
        this.setHover(target);
      });
      sprite.on('pointerout', () => this.clearHover(target));
      const steam = new Graphics();
      steam.position.set(p.x - 1, p.y - 8);
      steam.zIndex = sprite.zIndex;
      floor.sorted.addChild(sprite, steam);
      this.cupSprites.push({ sprite, steam, finishedAt: failed ? 0 : Date.parse(task.finishedAt!) });
    });
  }

  private animateCups() {
    const now = Date.now();
    for (const c of this.cupSprites) {
      c.steam.clear();
      // Fresh coffee steams for a minute.
      if (!c.finishedAt || now - c.finishedAt > 60_000) continue;
      const f = Math.floor(this.time * 3 + c.finishedAt / 997) % 3;
      c.steam.rect(f === 0 ? 0 : 1, 0, 1, 1).fill({ color: C.white, alpha: 0.7 });
      c.steam.rect(f === 1 ? 2 : 1, -2, 1, 1).fill({ color: C.white, alpha: 0.5 });
      c.steam.rect(f === 2 ? 0 : 2, -4, 1, 1).fill({ color: C.white, alpha: 0.3 });
    }
  }

  // ── Floor signs ───────────────────────────────────────────────────────────

  private syncSigns(id: ProviderId, data: CafeData) {
    const p = data.providers[id];
    const mode = p?.mode ?? 'mock';
    const key = `${mode}|${p?.closed ?? false}`;
    const floor = this.floors[id];
    if (floor.signKey === key) return;
    floor.signKey = key;
    for (const c of floor.signs.removeChildren()) c.destroy();
    const o = ORIGINS[id];
    const hanging = mode === 'off' ? 'SWITCHED OFF' : p?.closed && mode === 'live' ? 'CLOSED FOR TODAY' : null;

    if (hanging) {
      // Dim the whole floor so it reads as shut at a glance.
      const dim = new Graphics();
      floorQuad(dim, o, 0, 0, FLOOR_W, FLOOR_D, C.ink);
      dim.alpha = 0.45;
      floor.signs.addChild(dim);
    }

    const g = new Graphics();
    floor.signs.addChild(g);

    // Floor label plate: name plus mode, mint when live.
    const title = `${FLOORS[id].title} · ${mode === 'live' ? 'LIVE' : mode === 'mock' ? 'DEMO' : 'OFF'}`;
    const at = LABEL_AT[id];
    const w = textWidth(title);
    g.rect(at.x - 3, at.y - 3, w + 6, 11).fill(C.ink);
    g.rect(at.x - 2, at.y - 2, w + 4, 9).fill(C.walnutDark);
    drawText(g, title, at.x, at.y, { color: mode === 'live' ? C.mint : C.brass });

    if (hanging) {
      const center = proj(o, FLOOR_W / 2, FLOOR_D / 2, 30);
      const sw = textWidth(hanging, 2) + 10;
      const sx = center.x - Math.floor(sw / 2);
      g.rect(sx + 6, center.y - 12, 1, 8).fill(C.ink).rect(sx + sw - 7, center.y - 12, 1, 8).fill(C.ink);
      g.rect(sx - 1, center.y - 5, sw + 2, 16).fill(C.ink);
      g.rect(sx, center.y - 4, sw, 14).fill(C.coral);
      drawText(g, hanging, sx + 5, center.y - 1, { color: C.white, scale: 2 });
    }
  }

  // ── Hover plumbing ────────────────────────────────────────────────────────

  private setHover(t: HoverTarget) {
    this.hovered = t;
    this.hooks.hover(t);
  }

  private clearHover(t: HoverTarget) {
    if (this.hovered && this.hovered.kind === t.kind && this.hovered.id === t.id) {
      this.hovered = null;
      this.hooks.hover(null);
    }
  }
}
