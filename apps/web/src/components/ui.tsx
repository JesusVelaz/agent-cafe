'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A button that opens a floating panel above (or below) it. Closes on Escape,
 * on a click outside, and when `close` is called by the content.
 *
 * 'top' and 'bottom' hang the panel off the trigger. 'auto' places it against the
 * window instead (below, or above when there's more room there), so a scrolling
 * parent, like a dialog's body, can't clip it; it follows the trigger as that scrolls.
 */
export function Popover({
  trigger,
  children,
  side = 'top',
  align = 'start',
  label,
  className = '',
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  side?: 'top' | 'bottom' | 'auto';
  align?: 'start' | 'end';
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const [fixed, setFixed] = useState<{ top: number; left: number } | null>(null);

  // Keep the panel inside the window: slide it sideways when it would spill off an edge.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      setFixed(null);
      return;
    }
    const el = panel.current;
    const anchor = ref.current;
    if (!el || !anchor) return;
    const margin = 8;
    const place = () => {
      if (side === 'auto') {
        const t = anchor.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const below = window.innerHeight - t.bottom - margin;
        const above = t.top - margin;
        const top = r.height + margin <= below || below >= above ? t.bottom + margin : t.top - margin - r.height;
        const left = align === 'end' ? t.right - r.width : t.left;
        setFixed({
          top: Math.round(Math.max(margin, Math.min(top, window.innerHeight - margin - r.height))),
          left: Math.round(Math.max(margin, Math.min(left, window.innerWidth - margin - r.width))),
        });
        return;
      }
      el.style.translate = '0px';
      const r = el.getBoundingClientRect();
      let dx = 0;
      if (r.right > window.innerWidth - margin) dx = window.innerWidth - margin - r.right;
      if (r.left + dx < margin) dx = margin - r.left;
      el.style.translate = '';
      setShift(Math.round(dx));
    };
    place();
    window.addEventListener('resize', place);
    // A scrolling parent moves the trigger; keep a window-placed panel with it.
    if (side === 'auto') window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // inside a <dialog>, Escape closes just this, not the dialog too
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const where =
    side === 'auto'
      ? 'fixed' // placed by the layout effect; transparent until then (still focusable) so it never flashes at 0,0
      : `absolute ${side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} ${align === 'start' ? 'left-0' : 'right-0'}`;
  return (
    <div ref={ref} className="relative min-w-0">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          style={
            side === 'auto'
              ? { top: fixed?.top ?? 0, left: fixed?.left ?? 0, opacity: fixed ? undefined : 0 }
              : { translate: `${shift}px 0` }
          }
          className={`${where} z-40 max-w-[calc(100vw-16px)] rounded-xl border border-slate-line bg-slate shadow-[0_16px_40px_rgba(0,0,0,.45)] ${className}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A small rounded control in the composer's rows. */
export function Chip({
  children,
  onClick,
  active,
  label,
  title,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  label?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={active}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[12px] disabled:opacity-40 ${
        active ? 'bg-slate-2 text-chalk' : 'text-chalk-dim hover:bg-slate-2 hover:text-chalk'
      }`}
    >
      {children}
    </button>
  );
}

export function Caret() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0 opacity-60">
      <path d="M2.5 4l2.5 2.5L7.5 4" />
    </svg>
  );
}

/** Claude Code's mark in this UI: an eight-point spark (not the vendor logo). */
export function HarnessIcon({ harness, size = 12 }: { harness: 'claude-code' | 'codex'; size?: number }) {
  return harness === 'claude-code' ? (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0 text-claude">
      <path d="M6 1v10M1 6h10M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0 text-chalk-dim">
      <path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z" />
      <path d="M8 5.5v5M5.8 6.8L10.2 9.2" />
    </svg>
  );
}

export function FolderIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0">
      <path d="M1.5 4.5v8h13v-7h-7l-1.5-2h-4.5z" />
    </svg>
  );
}

/**
 * The send button: an 8-bit round arrow, drawn on a 10×10 pixel grid at 3 px per
 * pixel so every edge stays crisp.
 */
export function PixelSend({ disabled, busy }: { disabled?: boolean; busy?: boolean }) {
  const body = [[3, 4], [1, 8], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10], [0, 10]] as const;
  const shade = [[1, 8], [3, 4]] as const;
  const arrow = [[4, 2], [3, 4], [2, 6], [4, 2], [4, 2], [4, 2]] as const;
  return (
    <button
      type="submit"
      aria-label={busy ? 'Sending' : 'Send'}
      disabled={disabled}
      className="group grid size-8 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed"
    >
      <svg width="30" height="30" viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden className="transition-transform group-enabled:group-active:translate-y-px">
        <g className={disabled ? 'fill-slate-line' : 'fill-accent group-enabled:group-hover:fill-[#86a0ff]'}>
          {body.map(([x, w], y) => <rect key={y} x={x} y={y} width={w} height={1} />)}
        </g>
        <g className={disabled ? 'fill-slate-2' : 'fill-accent-dark'}>
          {shade.map(([x, w], i) => <rect key={i} x={x} y={8 + i} width={w} height={1} />)}
        </g>
        <g className={disabled ? 'fill-chalk-faint' : 'fill-white'}>
          {arrow.map(([x, w], i) => <rect key={i} x={x} y={2 + i} width={w} height={1} />)}
        </g>
      </svg>
    </button>
  );
}

/** Small-caps pixel heading for panel sections, with an optional count on the right. */
export function SectionHeading({ id, children, tone, count, action }: { id: string; children: ReactNode; tone: string; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 id={id} className="flex items-center gap-2 font-label text-[11px] font-normal tracking-wide" style={{ color: tone }}>
        <span aria-hidden className="size-2" style={{ background: tone }} />
        {children}
      </h3>
      {action ?? (count !== undefined && <span className="text-[12px] text-chalk-faint">{count}</span>)}
    </div>
  );
}

/** An on/off switch. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-slate-line'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}
