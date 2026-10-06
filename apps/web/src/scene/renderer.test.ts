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
      read: () => ({ data: emptyData(), selectedAgentId: null, theme: 'day', labels: false, transparent: true }),
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
