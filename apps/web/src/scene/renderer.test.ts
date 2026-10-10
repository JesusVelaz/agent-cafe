import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData } from '@/store/reduce';
import { CafeRenderer } from './renderer';

/** Just enough of a DOM canvas to see what the renderer does to it, in order. */
function fakeCanvas(log: string[]) {
  let w = 300, h = 150;
  const ctx = { putImageData: (img: { width: number; height: number }) => log.push(`draw ${img.width}x${img.height}`) };
  return {
    get width() { return w; },
    set width(v: number) { w = v; log.push(`wipe width=${v}`); },
    get height() { return h; },
    set height(v: number) { h = v; log.push(`wipe height=${v}`); },
    className: '',
    style: {} as Record<string, string>,
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    getContext: () => ctx,
  };
}

describe('CafeRenderer', () => {
  const log: string[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    log.length = 0;
    const canvas = fakeCanvas(log);
    vi.stubGlobal('document', { createElement: () => canvas, visibilityState: 'visible' });
    vi.stubGlobal('ImageData', class { constructor(_d: unknown, readonly width: number, readonly height: number) {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('redraws straight after a resize, so the wiped canvas is never what shows', () => {
    const r = new CafeRenderer({
      read: () => ({ data: emptyData(), selectedAgentId: null, theme: 'day', labels: false, transparent: true, viewAngle: 0 }),
      pickAgent() {},
      hover() {},
    });
    r.mount({ appendChild() {} } as unknown as HTMLElement);
    log.length = 0;

    r.resize(600, 450);
    expect(log).toEqual(['wipe width=600', 'wipe height=450', 'draw 600x450']);

    // The same size again is a no-op: no wipe, no extra frame.
    log.length = 0;
    r.resize(600, 450);
    expect(log).toEqual([]);
    r.destroy();
  });
});

describe('turning the café', () => {
  type Handler = (e: Partial<PointerEvent>) => void;
  let on: Record<string, Handler>;
  let view: number;
  let turned: number[];
  let picked: string[];
  let r: CafeRenderer;
  const Q = Math.PI / 2;

  beforeEach(() => {
    vi.useFakeTimers();
    on = {};
    view = 0;
    turned = [];
    picked = [];
    const canvas = {
      ...fakeCanvas([]),
      addEventListener: (t: string, f: Handler) => { on[t] = f; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 400 }),
      setPointerCapture() {},
    };
    vi.stubGlobal('document', { createElement: () => canvas, visibilityState: 'visible' });
    vi.stubGlobal('ImageData', class { constructor(_d: unknown, readonly width: number, readonly height: number) {} });
    r = new CafeRenderer({
      read: () => ({ data: emptyData(), selectedAgentId: null, theme: 'day', labels: false, transparent: true, viewAngle: view }),
      pickAgent: (id) => picked.push(id),
      hover() {},
      turned: (q) => { turned.push(q); view = q; },
    });
    r.mount({ appendChild() {} } as unknown as HTMLElement);
  });
  afterEach(() => {
    r.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('spins with a sideways drag and settles on the nearest quarter, without a click', () => {
    on.pointerdown!({ button: 0, clientX: 300, clientY: 200 });
    on.pointermove!({ clientX: 260, clientY: 200, pointerId: 1 });
    on.pointermove!({ clientX: 120, clientY: 205, pointerId: 1 }); // 180 px left: past half a quarter
    expect(r.turning).toBe(true);
    on.pointerup!({});
    on.click!({ clientX: 120, clientY: 205 });
    expect(turned).toEqual([1]);
    expect(picked).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(r.turning).toBe(false);
    expect(r.cameraAngle).toBeCloseTo(Q, 6);
  });

  it('treats a press that barely moves as a click, not a turn', () => {
    on.pointerdown!({ button: 0, clientX: 300, clientY: 200 });
    on.pointermove!({ clientX: 303, clientY: 201, pointerId: 1 });
    on.pointerup!({});
    expect(r.turning).toBe(false);
    expect(turned).toEqual([]);
  });

  it('follows the store the short way round', () => {
    vi.advanceTimersByTime(100);
    view = 3; // from 0 to 3 is a quarter to the right, not three to the left
    vi.advanceTimersByTime(2000);
    expect(r.cameraAngle).toBeCloseTo(-Q, 6);
    view = 1; // and from 3 to 1 is a half turn
    vi.advanceTimersByTime(2000);
    expect(Math.abs(r.cameraAngle - -Q)).toBeCloseTo(Math.PI, 6);
  });
});
