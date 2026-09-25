import { useMemo } from "react";
import { boundsOf } from "@/lib/geometry";
import { regionsToPathData } from "@/lib/export";
import type { PlateLayout } from "@/lib/plates";
import { cn } from "@/lib/utils";

const COLOURS = ["var(--letter-1)", "var(--letter-2)", "var(--letter-3)", "var(--letter-4)", "var(--letter-5)"];

interface PlatePreviewProps {
  plate: PlateLayout;
  bed: { width: number; depth: number };
  margin: number;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}

/** Top-down view of one build plate, drawn to scale. */
export function PlatePreview({ plate, bed, margin, selected, onSelect, className }: PlatePreviewProps) {
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
          label: l.template.char,
        };
      }),
    [plate, bed.depth],
  );
  const grid = 32;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative block w-full overflow-hidden rounded-xl border-2 bg-plate p-0 transition cursor-pointer",
        selected ? "border-primary shadow-lg shadow-primary/10" : "border-transparent hover:border-primary/40",
        className,
      )}
      aria-label={`Plate ${plate.index + 1}`}
    >
      <svg viewBox={`0 0 ${bed.width} ${bed.depth}`} className="block h-auto w-full">
        <defs>
          <pattern id={`grid-${plate.index}`} width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="var(--plate-grid)" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width={bed.width} height={bed.depth} fill={`url(#grid-${plate.index})`} />
        <rect
          x={margin}
          y={margin}
          width={bed.width - margin * 2}
          height={bed.depth - margin * 2}
          fill="none"
          stroke="var(--plate-grid)"
          strokeWidth="0.8"
          strokeDasharray="3 3"
        />
        {shapes.map((s) => (
          <g key={s.key}>
            <path d={s.d} fill={s.colour} fillRule="evenodd" stroke="rgba(0,0,0,.35)" strokeWidth="0.5" />
          </g>
        ))}
      </svg>
      <div className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
        Plate {plate.index + 1} · {plate.letters.length} letter{plate.letters.length === 1 ? "" : "s"} ·{" "}
        {Math.round(plate.utilisation * 100)}% full
      </div>
    </button>
  );
}
