import { ToggleRow } from "@/components/ToggleRow";
import { cn } from "@/lib/utils";

export type LetterMode = "text" | "pick";

export const LETTER_GROUPS: { id: string; label: string; chars: string[] }[] = [
  { id: "upper", label: "Capitals", chars: Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ") },
  { id: "lower", label: "Lower case", chars: Array.from("abcdefghijklmnopqrstuvwxyz") },
  { id: "digits", label: "Numbers", chars: Array.from("0123456789") },
  { id: "symbols", label: "Symbols & shapes", chars: Array.from("♥★●&!?'.,-+#@£") },
];

const ALL_CHARS = LETTER_GROUPS.flatMap((g) => g.chars);

/** Keep picked characters in a predictable, alphabet-like order. */
export function sortChars(chars: Iterable<string>): string[] {
  return [...new Set(chars)].sort((a, b) => {
    const ia = ALL_CHARS.indexOf(a);
    const ib = ALL_CHARS.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
}

interface LetterPickerProps {
  mode: LetterMode;
  onModeChange: (m: LetterMode) => void;
  text: string;
  onTextChange: (t: string) => void;
  perOccurrence: boolean;
  onPerOccurrenceChange: (v: boolean) => void;
  picked: string[];
  onPickedChange: (chars: string[]) => void;
  missing: string[];
  /** CSS font family used to show the banner text in the chosen typeface. */
  fontFamily?: string;
}

const SHAPES = [
  { c: "♥", label: "Heart" },
  { c: "★", label: "Star" },
  { c: "●", label: "Circle" },
];

const linkClass = "cursor-pointer font-medium text-primary hover:underline";

export function LetterPicker(props: LetterPickerProps) {
  const {
    mode,
    onModeChange,
    text,
    onTextChange,
    perOccurrence,
    onPerOccurrenceChange,
    picked,
    onPickedChange,
    missing,
    fontFamily,
  } = props;
  const pickedSet = new Set(picked);
  const toggle = (c: string) => {
    const next = new Set(pickedSet);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    onPickedChange(sortChars(next));
  };
  const setGroup = (chars: string[], on: boolean) => {
    const next = new Set(pickedSet);
    for (const c of chars) {
      if (on) next.add(c);
      else next.delete(c);
    }
    onPickedChange(sortChars(next));
  };

  if (mode === "text") {
    return (
      <div className="flex flex-col gap-3.5">
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="HAPPY BIRTHDAY"
          rows={2}
          aria-label="Banner text"
          className="resize-none rounded-[10px] border bg-background px-3.5 py-3 text-[26px] leading-[1.15] tracking-[.02em] outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          style={{ fontFamily: fontFamily ? `"${fontFamily}", var(--font-display)` : "var(--font-display)" }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Add</span>
          {SHAPES.map(({ c, label }) => (
            <button
              key={c}
              type="button"
              onClick={() => onTextChange(text + c)}
              aria-label={`Add a ${label.toLowerCase()}`}
              className="h-[30px] shrink-0 cursor-pointer whitespace-nowrap rounded-lg border px-2.5 text-[13px] transition-colors hover:border-primary/50 hover:bg-accent"
            >
              {c} {label}
            </button>
          ))}
        </div>
        <ToggleRow
          checked={perOccurrence}
          onChange={onPerOccurrenceChange}
          className="rounded-[10px] bg-muted"
          title={<span className="font-semibold">A template for every letter</span>}
          description={
            perOccurrence
              ? "Repeated letters (the two P’s in HAPPY) each get their own template."
              : "One template per distinct letter: trace it as many times as you need."
          }
        />
        <p className="text-xs text-muted-foreground">
          Or{" "}
          <button type="button" className={linkClass} onClick={() => onModeChange("pick")}>
            pick exact letters
          </button>{" "}
          from A–Z, a–z, 0–9
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: "Full alphabet", chars: LETTER_GROUPS[0].chars },
          { label: "A–Z + 0–9", chars: [...LETTER_GROUPS[0].chars, ...LETTER_GROUPS[2].chars] },
          { label: "Clear", chars: [] },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onPickedChange(preset.chars)}
            className="h-[30px] cursor-pointer whitespace-nowrap rounded-lg border px-2.5 text-[13px] transition-colors hover:border-primary/50 hover:bg-accent"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {LETTER_GROUPS.map((group) => {
        const all = group.chars.every((c) => pickedSet.has(c));
        return (
          <div key={group.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[.06em] text-muted-foreground">
                {group.label}
              </span>
              <button type="button" className={cn(linkClass, "text-xs")} onClick={() => setGroup(group.chars, !all)}>
                {all ? "None" : "All"}
              </button>
            </div>
            <div className="grid grid-cols-9 gap-1">
              {group.chars.map((c) => {
                const on = pickedSet.has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c)}
                    className={cn(
                      "flex aspect-square cursor-pointer items-center justify-center rounded-md border text-sm font-semibold transition",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      missing.includes(c) && on && "border-destructive bg-destructive/80",
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Or{" "}
        <button type="button" className={linkClass} onClick={() => onModeChange("text")}>
          type your banner words
        </button>{" "}
        instead
      </p>
    </div>
  );
}
