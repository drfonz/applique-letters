import { useId, useMemo } from "react";
import { boundsOf } from "@/lib/geometry";
import { regionsToPathData } from "@/lib/export";
import type { PlateLayout } from "@/lib/plates";
import { placeHandle, type HandleSettings } from "@/lib/handle";
import { cn } from "@/lib/utils";

const COLOURS = ["var(--letter-1)", "var(--letter-2)", "var(--letter-3)", "var(--letter-4)", "var(--letter-5)"];

interface PlatePreviewProps {
  plate: PlateLayout;
  bed: { width: number; depth: number };
  margin: number;
  handle?: HandleSettings;
  /** Show the plate name, letter count and fill in the corner. */
  label?: boolean;
  className?: string;
}

/** Top-down view of one build plate, drawn to scale. */
export function PlatePreview({ plate, bed, margin, handle, label, className }: PlatePreviewProps) {
  const patternId = useId();
  const shapes = useMemo(
    () =>
      plate.letters.map((l, i) => {
        const b = boundsOf(l.regions);
        return {
          key: `${l.template.char}-${l.copy}-${i}`,
          d: regionsToPathData(l.regions, bed.depth),
          cx: (b.minX + b.maxX) / 2,
          cy: bed.depth - (b.minY + b.maxY) / 2,
          colour: COLOURS[i % COLOURS.length],
          handle: handle ? placeHandle(l.regions, handle) : null,
        };
      }),
    [plate, bed.depth, handle],
  );
  const grid = Math.max(bed.width, bed.depth) / 8;
  const stroke = Math.max(bed.width, bed.depth) / 500;
  const count = plate.letters.length;
  return (
    <div className={cn("relative overflow-hidden bg-plate", className)}>
      <svg
        viewBox={`0 0 ${bed.width} ${bed.depth}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Plate ${plate.index + 1}: ${plate.letters.map((l) => l.template.char).join(" ")}`}
      >
        <defs>
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
        {shapes.map((s) => (
          <g key={s.key}>
            <path d={s.d} fill={s.colour} fillRule="evenodd" stroke="rgba(0,0,0,.35)" strokeWidth={stroke} />
            {s.handle && (
              <>
                <circle cx={s.handle.x} cy={bed.depth - s.handle.y} r={s.handle.footRadius} fill="rgba(0,0,0,.18)" />
                <circle
                  cx={s.handle.x}
                  cy={bed.depth - s.handle.y}
                  r={s.handle.radius}
                  fill="rgba(255,255,255,.9)"
                  stroke="rgba(0,0,0,.35)"
                  strokeWidth={stroke}
                />
              </>
            )}
          </g>
        ))}
      </svg>
      {label && (
        <div className="absolute bottom-[3.5%] left-[3.5%] rounded-[7px] bg-black/50 px-2.5 py-1 font-mono text-xs font-medium text-white backdrop-blur-sm">
          Plate {plate.index + 1} · {count} letter{count === 1 ? "" : "s"} · {Math.round(plate.utilisation * 100)}% full
        </div>
      )}
    </div>
  );
}
