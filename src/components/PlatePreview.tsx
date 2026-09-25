import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { regionsToPathData } from "@/lib/export";
import type { Vec2 } from "@/lib/geometry";
import type { HandlePlacement } from "@/lib/handle";
import type { KeepOut } from "@/lib/nest";
import type { PlacedLetter, PlateLayout } from "@/lib/plates";
import { cn } from "@/lib/utils";

const COLOURS = ["var(--letter-1)", "var(--letter-2)", "var(--letter-3)", "var(--letter-4)", "var(--letter-5)"];

interface PlatePreviewProps {
  plate: PlateLayout;
  bed: { width: number; depth: number };
  margin: number;
  /** Each letter's grip handle in bed coordinates, if handles are on. */
  handleOf?: (letter: PlacedLetter) => HandlePlacement | null;
  /** Makes handles draggable; called with the bed point the handle is dragged to. */
  onHandleMove?: (letter: PlacedLetter, point: Vec2) => void;
  /** Areas the nesting left clear, drawn hatched. */
  keepOut?: KeepOut[];
  /** Show the plate name, letter count and fill in the corner. */
  label?: boolean;
  className?: string;
}

/** Top-down view of one build plate, drawn to scale. */
export function PlatePreview({
  plate,
  bed,
  margin,
  handleOf,
  onHandleMove,
  keepOut = [],
  label,
  className,
}: PlatePreviewProps) {
  const patternId = useId();
  const hatchId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const shapes = useMemo(
    () =>
      plate.letters.map((l, i) => ({
        key: `${l.template.char}-${l.copy}-${i}`,
        d: regionsToPathData(l.regions, bed.depth),
        colour: COLOURS[i % COLOURS.length],
        handle: handleOf ? handleOf(l) : null,
      })),
    [plate, bed.depth, handleOf],
  );
  const grid = Math.max(bed.width, bed.depth) / 8;
  const stroke = Math.max(bed.width, bed.depth) / 500;
  const count = plate.letters.length;

  /** Pointer position in bed coordinates (mm, origin front-left). */
  const bedPoint = (e: PointerEvent): Vec2 | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [p.x, bed.depth - p.y];
  };
  const onPointerMove = (e: PointerEvent) => {
    if (dragging === null || !onHandleMove) return;
    const p = bedPoint(e);
    if (p) onHandleMove(plate.letters[dragging], p);
  };
  const onKeyDown = (i: number, h: HandlePlacement) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, Vec2> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (!m || !onHandleMove) return;
    e.preventDefault();
    e.stopPropagation();
    onHandleMove(plate.letters[i], [h.x + m[0], h.y + m[1]]);
  };

  return (
    <div className={cn("group relative overflow-hidden bg-plate", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${bed.width} ${bed.depth}`}
        className={cn("block h-auto w-full", dragging !== null && "cursor-grabbing")}
        role="img"
        aria-label={`Plate ${plate.index + 1}: ${plate.letters.map((l) => l.template.char).join(" ")}`}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        <defs>
          <pattern
            id={hatchId}
            width={stroke * 6}
            height={stroke * 6}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2={stroke * 6} stroke="var(--plate-edge)" strokeWidth={stroke * 1.5} />
          </pattern>
          <pattern id={patternId} width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="var(--plate-grid)" strokeWidth={stroke * 1.2} />
          </pattern>
        </defs>
        <rect width={bed.width} height={bed.depth} fill={`url(#${patternId})`} />
        <rect
          x={margin}
          y={margin}
          width={bed.width - margin * 2}
          height={bed.depth - margin * 2}
          rx={stroke * 4}
          fill="none"
          stroke="var(--plate-edge)"
          strokeWidth={stroke * 1.2}
          strokeDasharray={`${stroke * 5} ${stroke * 5}`}
        />
        {keepOut.map((k) => (
          <rect
            key={`${k.x}-${k.y}`}
            x={k.x}
            y={bed.depth - k.y - k.depth}
            width={k.width}
            height={k.depth}
            rx={stroke * 3}
            fill={`url(#${hatchId})`}
            stroke="var(--plate-edge)"
            strokeWidth={stroke}
          >
            <title>
              {k.kind === "prime-tower" ? "Kept clear for the prime tower" : "The printer doesn’t print here"}
            </title>
          </rect>
        ))}
        {shapes.map((s, i) => (
          <g key={s.key}>
            <path d={s.d} fill={s.colour} fillRule="evenodd" stroke="rgba(0,0,0,.35)" strokeWidth={stroke} />
            {s.handle && (
              <g
                data-handle
                tabIndex={onHandleMove ? 0 : undefined}
                role={onHandleMove ? "button" : undefined}
                aria-label={
                  onHandleMove
                    ? `Grip handle on ${plate.letters[i].template.char}: drag, or use the arrow keys, to move it`
                    : undefined
                }
                className={cn(
                  onHandleMove && "cursor-grab touch-none outline-none",
                  dragging === i && "cursor-grabbing",
                )}
                onPointerDown={
                  onHandleMove
                    ? (e) => {
                        e.preventDefault();
                        svgRef.current?.setPointerCapture(e.pointerId);
                        setDragging(i);
                      }
                    : undefined
                }
                onKeyDown={onHandleMove ? onKeyDown(i, s.handle) : undefined}
              >
                <circle cx={s.handle.x} cy={bed.depth - s.handle.y} r={s.handle.footRadius} fill="rgba(0,0,0,.18)" />
                <circle
                  className="[g:focus-visible>&]:stroke-primary"
                  cx={s.handle.x}
                  cy={bed.depth - s.handle.y}
                  r={s.handle.radius}
                  fill="rgba(255,255,255,.9)"
                  stroke={dragging === i ? "var(--primary)" : "rgba(0,0,0,.35)"}
                  strokeWidth={dragging === i ? stroke * 2.5 : stroke}
                />
              </g>
            )}
          </g>
        ))}
      </svg>
      {label && (
        <div className="pointer-events-none absolute right-[3.5%] bottom-[3.5%] rounded-[7px] transition-opacity group-hover:opacity-0 bg-black/50 px-2.5 py-1 font-mono text-xs font-medium text-white backdrop-blur-sm">
          Plate {plate.index + 1} · {count} letter{count === 1 ? "" : "s"} · {Math.round(plate.utilisation * 100)}% full
        </div>
      )}
    </div>
  );
}
