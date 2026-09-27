import { useMemo, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Plus } from "lucide-react";
import { SHAPES, familiesInOrder, shapesIn, type ShapeGroup } from "@indigolabs/applique-core";
import { cn } from "@/lib/utils";

/** The basics are plain glyphs rather than emoji, so give them the letter colours. */
const TINTS: Record<string, string> = {
  "♥": "var(--letter-1)",
  "★": "var(--letter-2)",
  "●": "var(--letter-4)",
};

export function shapeTint(char: string): string | undefined {
  return TINTS[char];
}

const RECENT_KEY = "applique-letters:recent-shapes";
// Three fit beside the button in the sidebar.
const RECENT_MAX = 3;

function loadRecent(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (Array.isArray(saved)) return saved.filter((c) => typeof c === "string" && SHAPES[c]).slice(0, RECENT_MAX);
  } catch {
    // Private windows and blocked storage just start with no history.
  }
  return [];
}

function saveRecent(recent: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Not worth bothering anyone about.
  }
}

interface ShapePickerProps {
  /** Called with the shape's character when a tile is chosen. */
  onPick: (char: string) => void;
  /** Shapes already chosen, shown as pressed tiles (for picking exact letters). */
  selected?: ReadonlySet<string>;
  /** What sits beside the button; defaults to the recently used shapes. */
  aside?: ReactNode;
}

/** One "Add shape" button opening a searchable popover of every shape family. */
export function ShapePicker({ onPick, selected, aside }: ShapePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<ShapeGroup | "all">("all");
  const families = useMemo(() => familiesInOrder(), []);
  const [recent, setRecent] = useState(() => {
    const saved = loadRecent();
    // Nothing used yet: suggest a few from whatever is in season.
    return saved.length ? saved : shapesIn(families[0].id).slice(0, 3);
  });

  const pick = (char: string) => {
    onPick(char);
    const next = [char, ...recent.filter((c) => c !== char)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
  };

  const q = query.trim().toLowerCase();
  const groups = families
    .filter((f) => family === "all" || f.id === family)
    .map((f) => ({
      ...f,
      chars: shapesIn(f.id).filter(
        (c) => !q || SHAPES[c].label.toLowerCase().includes(q) || f.label.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.chars.length);

  const tabs: { id: ShapeGroup | "all"; label: string }[] = [{ id: "all", label: "All" }, ...families];

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <Popover.Anchor className="flex flex-wrap items-center gap-1.5">
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-[34px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3 text-[13px] font-medium transition-colors",
              open ? "border-primary bg-accent" : "hover:border-primary/50 hover:bg-accent",
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add shape
          </button>
        </Popover.Trigger>
        {aside ?? (
          <>
            <div className="ml-1 flex gap-1" role="group" aria-label="Recent shapes">
              {recent.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pick(c)}
                  title={SHAPES[c].label}
                  aria-label={`Add ${SHAPES[c].label.toLowerCase()} shape`}
                  className="flex size-[34px] cursor-pointer items-center justify-center rounded-[9px] border text-[17px] transition-colors hover:border-primary/50 hover:bg-accent"
                  style={{ color: shapeTint(c) }}
                >
                  {c}
                </button>
              ))}
            </div>
          </>
        )}
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 flex max-h-[min(460px,var(--radix-popover-content-available-height))] w-[min(328px,calc(100vw-24px))] flex-col overflow-hidden rounded-[14px] border bg-popover text-popover-foreground shadow-[var(--elevation)] outline-none"
        >
          <div className="flex flex-col gap-2.5 border-b p-2.5">
            <div className="flex items-center gap-1.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search shapes"
                aria-label="Search shapes"
                className="h-9 min-w-0 flex-1 rounded-[9px] border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
              />
              <Popover.Close asChild>
                <button
                  type="button"
                  title="Close (Esc)"
                  className="h-9 shrink-0 cursor-pointer rounded-[9px] bg-foreground px-3 text-[13px] font-semibold text-background"
                >
                  Done
                </button>
              </Popover.Close>
            </div>
            {/* Wraps rather than scrolls: with a dozen families, a hidden scroll hid most of them. */}
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Shape families">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={family === t.id}
                  onClick={() => setFamily(t.id)}
                  className={cn(
                    "h-7 shrink-0 cursor-pointer whitespace-nowrap rounded-full px-2.5 text-xs font-medium transition-colors",
                    family === t.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2.5 pb-3 pt-1">
            {groups.map((g) => (
              <div key={g.id} className="flex flex-col gap-2 pt-2.5">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.06em] text-muted-foreground">
                  {g.label}
                  {g.inSeason && (
                    <span className="rounded-full bg-ochre px-1.5 py-0.5 normal-case tracking-normal text-ochre-foreground">
                      in season
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {g.chars.map((c) => {
                    const on = selected?.has(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => pick(c)}
                        aria-pressed={selected ? on : undefined}
                        className={cn(
                          "flex aspect-square cursor-pointer flex-col items-center justify-center gap-[3px] rounded-[10px] border transition-colors hover:border-primary",
                          on ? "border-primary bg-accent" : "bg-background",
                        )}
                      >
                        <span className="text-2xl leading-none" style={{ color: shapeTint(c) }} aria-hidden="true">
                          {c}
                        </span>
                        <span className="text-[11px] leading-tight text-muted-foreground">{SHAPES[c].label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <div className="px-1 py-6 text-center text-[13px] text-muted-foreground">No shapes match “{query}”</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
