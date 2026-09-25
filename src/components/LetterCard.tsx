import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Download, Minus, Plus, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { regionsToPathData } from "@/lib/export";
import type { LetterTemplate } from "@/lib/templates";
import type { Region, Vec2 } from "@/lib/geometry";
import type { HandlePlacement } from "@/lib/handle";
import { cn } from "@/lib/utils";

interface LetterCardProps {
  template: LetterTemplate;
  handle: HandlePlacement | null;
  /** What the letter prints as, if not its plain outline. */
  body?: Region[];
  /** Makes the handle draggable; called with the template point it is dragged to. */
  onHandleMove?: (point: Vec2) => void;
  /** Shown when the handle has been moved by hand, to put it back in the automatic spot. */
  onHandleReset?: () => void;
  copies: number;
  onCopiesChange: (n: number) => void;
  onDownload: () => void;
  tooBig: boolean;
}

export function LetterCard({
  template,
  handle,
  body,
  onHandleMove,
  onHandleReset,
  copies,
  onCopiesChange,
  onDownload,
  tooBig,
}: LetterCardProps) {
  const pad = Math.max(template.width, template.height) * 0.08;
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const toTemplate = (e: PointerEvent): Vec2 | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [p.x, template.height - p.y];
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!handle || !onHandleMove) return;
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, Vec2> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    onHandleMove([handle.x + m[0], handle.y + m[1]]);
  };
  return (
    <div className={cn("flex flex-col rounded-xl border bg-card p-3 shadow-xs", tooBig && "border-destructive/60")}>
      <div className="relative aspect-square rounded-lg bg-muted/60">
        <svg
          viewBox={`${-pad} ${-pad} ${template.width + pad * 2} ${template.height + pad * 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)]"
          role="img"
          aria-label={`Template for ${template.char}`}
          onPointerMove={(e) => {
            if (!dragging || !onHandleMove) return;
            const p = toTemplate(e);
            if (p) onHandleMove(p);
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          ref={svgRef}
        >
          <path
            d={regionsToPathData(body ?? template.regions, template.height)}
            fill="var(--letter-1)"
            fillRule="evenodd"
            stroke="rgba(0,0,0,.35)"
            strokeWidth={Math.max(template.width, template.height) / 200}
          />
          {handle && (
            <g
              tabIndex={onHandleMove ? 0 : undefined}
              role={onHandleMove ? "button" : undefined}
              aria-label={
                onHandleMove ? `Grip handle on ${template.char}: drag, or use the arrow keys, to move it` : undefined
              }
              className={cn(onHandleMove && "cursor-grab touch-none outline-none", dragging && "cursor-grabbing")}
              onPointerDown={
                onHandleMove
                  ? (e) => {
                      e.preventDefault();
                      svgRef.current?.setPointerCapture(e.pointerId);
                      setDragging(true);
                    }
                  : undefined
              }
              onKeyDown={onKeyDown}
            >
              <circle cx={handle.x} cy={template.height - handle.y} r={handle.footRadius} fill="rgba(0,0,0,.18)" />
              <circle
                className="[g:focus-visible>&]:stroke-primary"
                cx={handle.x}
                cy={template.height - handle.y}
                r={handle.radius}
                fill="rgba(255,255,255,.9)"
                stroke={dragging ? "var(--primary)" : "rgba(0,0,0,.35)"}
                strokeWidth={(Math.max(template.width, template.height) / 200) * (dragging ? 2.5 : 1)}
              />
            </g>
          )}
        </svg>
        {onHandleReset && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onHandleReset}
                aria-label={`Put the handle on ${template.char} back in its automatic spot`}
                className="absolute bottom-1.5 left-1.5 flex size-6 cursor-pointer items-center justify-center rounded-md bg-card/90 text-muted-foreground shadow-xs hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Reset handle position</TooltipContent>
          </Tooltip>
        )}
        {template.pieces > 1 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="absolute right-1.5 top-1.5 rounded bg-amber-500/90 px-1.5 text-[10px] font-semibold text-white">
                {template.pieces} pieces
              </span>
            </TooltipTrigger>
            <TooltipContent>
              This character is made of separate parts (like the dot on an "i"). Each part prints as its own piece.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{template.char}</div>
          <div className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
            {Math.round(template.width)} × {Math.round(template.height)} mm
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDownload}
              aria-label={`Download STL for ${template.char}`}
            >
              <Download />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download this letter as STL</TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md bg-muted/60 p-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onCopiesChange(Math.max(0, copies - 1))}
          aria-label="Fewer copies"
        >
          <Minus />
        </Button>
        <span className="whitespace-nowrap text-xs tabular-nums" aria-live="polite">
          {copies === 0 ? "Skip" : `× ${copies}`}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onCopiesChange(Math.min(20, copies + 1))}
          aria-label="More copies"
        >
          <Plus />
        </Button>
      </div>
      {tooBig && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-destructive">
          <TriangleAlert className="size-3" /> Too big for the plate
        </p>
      )}
    </div>
  );
}
