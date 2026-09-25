import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A pill switch drawn to match the workbench design. */
export function Toggle({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors",
        on ? "bg-primary" : "bg-input",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left]",
          on ? "left-[19px]" : "left-[3px]",
        )}
      />
    </span>
  );
}

interface ToggleRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}

/** A whole-row switch: the title, an optional explanation and the toggle, all one click target. */
export function ToggleRow({ checked, onChange, title, description, className }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 p-3 text-left text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {description && <span className="text-xs leading-[1.45] text-muted-foreground">{description}</span>}
      </span>
      <Toggle on={checked} />
    </button>
  );
}
