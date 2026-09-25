import { Download, Minus, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { regionsToPathData } from "@/lib/export";
import type { LetterTemplate } from "@/lib/templates";
import type { HandlePlacement } from "@/lib/handle";
import { cn } from "@/lib/utils";

interface LetterCardProps {
  template: LetterTemplate;
  handle: HandlePlacement | null;
  copies: number;
  onCopiesChange: (n: number) => void;
  onDownload: () => void;
  tooBig: boolean;
}

export function LetterCard({ template, handle, copies, onCopiesChange, onDownload, tooBig }: LetterCardProps) {
  const pad = Math.max(template.width, template.height) * 0.08;
  return (
    <div className={cn("flex flex-col rounded-xl border bg-card p-3 shadow-xs", tooBig && "border-destructive/60")}>
      <div className="relative aspect-square rounded-lg bg-muted/60">
        <svg
          viewBox={`${-pad} ${-pad} ${template.width + pad * 2} ${template.height + pad * 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)]"
          role="img"
          aria-label={`Template for ${template.char}`}
        >
          <path
            d={regionsToPathData(template.regions, template.height)}
            fill="var(--letter-1)"
            fillRule="evenodd"
            stroke="rgba(0,0,0,.35)"
            strokeWidth={Math.max(template.width, template.height) / 200}
          />
          {handle && (
            <circle
              cx={handle.x}
              cy={template.height - handle.y}
              r={handle.radius}
              fill="rgba(255,255,255,.9)"
              stroke="rgba(0,0,0,.35)"
              strokeWidth={Math.max(template.width, template.height) / 200}
            />
          )}
        </svg>
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
            <Button variant="ghost" size="icon-sm" onClick={onDownload} aria-label={`Download STL for ${template.char}`}>
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
        <Button variant="ghost" size="icon-sm" onClick={() => onCopiesChange(Math.min(20, copies + 1))} aria-label="More copies">
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
