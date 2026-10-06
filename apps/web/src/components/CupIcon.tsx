import { cupPixels, type Mood } from '@/lib/cup';

const PIXELS: Record<Mood, ReturnType<typeof cupPixels>> = {
  quiet: cupPixels('quiet'),
  working: cupPixels('working'),
  alert: cupPixels('alert'),
};

/**
 * The Agent Café mark, drawn crisp at any whole-pixel size, wearing the café's mood.
 * While working, the steam drifts between two frames (holds still under reduced motion).
 */
export function CupIcon({ size = 28, mood = 'quiet' }: { size?: number; mood?: Mood }) {
  const pixels = PIXELS[mood];
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
