import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface SliderFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
}

export function SliderField({ id, label, value, min, max, step, onChange, display, hint, compact }: SliderFieldProps) {
  return (
    <div className={compact ? "space-y-2" : "space-y-2.5"}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className={cn(compact ? "text-[13px] font-normal" : "text-sm font-medium")}>
          {label}
        </Label>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-mono tabular-nums text-muted-foreground",
            compact ? "text-xs" : "text-[13px]",
          )}
        >
          {display}
        </span>
      </div>
      <Slider id={id} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
