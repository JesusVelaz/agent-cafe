import { CUP_FILL_ROWS, cupFillPixels, cupPixels, type Mood, type Px } from '@/lib/cup';

const PIXELS: Record<Mood, Px[]> = {
  quiet: cupPixels('quiet'),
  working: cupPixels('working'),
  alert: cupPixels('alert'),
};
const FILLS: Px[][] = Array.from({ length: CUP_FILL_ROWS + 1 }, (_, i) => cupFillPixels(i / CUP_FILL_ROWS));

/**
 * The Agents Café mark, drawn crisp at any whole-pixel size, wearing the café's mood.
 * While working, the steam drifts between two frames (holds still under reduced motion).
 * With `fill` (0–1) it's the empty cup filling up instead: the first-load meter.
 */
export function CupIcon({ size = 28, mood = 'quiet', fill }: { size?: number; mood?: Mood; fill?: number }) {
  const pixels = fill === undefined ? PIXELS[mood] : FILLS[Math.round(Math.min(1, Math.max(0, fill)) * CUP_FILL_ROWS)]!;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden className="shrink-0">
      {pixels.filter((p) => !p.steam).map((p) => (
        <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
      ))}
      {mood === 'working' && (
        <>
          <g className="steam-a">
            {pixels.filter((p) => p.steam === 's').map((p) => (
              <rect key={`s${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
            ))}
          </g>
          <g className="steam-b">
            {pixels.filter((p) => p.steam === 't').map((p) => (
              <rect key={`t${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
            ))}
          </g>
        </>
      )}
    </svg>
  );
}
