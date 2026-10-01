import { cupPixels } from '@/lib/cup';

const PIXELS = cupPixels();

/**
 * The Agent Café mark, drawn crisp at any whole-pixel size. With `steaming`, the
 * steam drifts between two frames (holds still under reduced motion).
 */
export function CupIcon({ size = 28, steaming = false }: { size?: number; steaming?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden className="shrink-0">
      {PIXELS.filter((p) => !p.steam).map((p) => (
        <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
      ))}
      {steaming && (
        <>
          <g className="steam-a">
            {PIXELS.filter((p) => p.steam === 's').map((p) => (
              <rect key={`s${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
            ))}
          </g>
          <g className="steam-b">
            {PIXELS.filter((p) => p.steam === 't').map((p) => (
              <rect key={`t${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
            ))}
          </g>
        </>
      )}
    </svg>
  );
}
