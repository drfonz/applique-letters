import { Heart, Star, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
}

export function LetterPicker(props: LetterPickerProps) {
  const { mode, onModeChange, text, onTextChange, perOccurrence, onPerOccurrenceChange, picked, onPickedChange, missing } =
    props;
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

  return (
    <Tabs value={mode} onValueChange={(v) => onModeChange(v as LetterMode)}>
      <TabsList className="w-full">
        <TabsTrigger value="text">From banner words</TabsTrigger>
        <TabsTrigger value="pick">Pick letters</TabsTrigger>
      </TabsList>

      <TabsContent value="text" className="space-y-3">
        <Textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="HAPPY BIRTHDAY"
          className="min-h-20 text-lg font-semibold tracking-wide"
          aria-label="Banner text"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Add a shape:</span>
          {[
            { c: "♥", icon: Heart, label: "Heart" },
            { c: "★", icon: Star, label: "Star" },
            { c: "●", icon: Circle, label: "Circle" },
          ].map(({ c, icon: Icon, label }) => (
            <Button key={c} variant="outline" size="sm" onClick={() => onTextChange(text + c)} aria-label={`Add ${label}`}>
              <Icon /> {label}
            </Button>
          ))}
        </div>
        <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 p-3">
          <div className="space-y-1">
            <Label htmlFor="per-occurrence">A template for every letter</Label>
            <p className="text-xs text-muted-foreground">
              {perOccurrence
                ? "Repeated letters (the two P's in HAPPY) each get their own template."
                : "One template per distinct letter: trace it as many times as you need."}
            </p>
          </div>
          <Switch id="per-occurrence" checked={perOccurrence} onCheckedChange={onPerOccurrenceChange} />
        </div>
      </TabsContent>

      <TabsContent value="pick" className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => onPickedChange(LETTER_GROUPS[0].chars)}>
            Full alphabet
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPickedChange([...LETTER_GROUPS[0].chars, ...LETTER_GROUPS[2].chars])}
          >
            A–Z + 0–9
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onPickedChange([])}>
            Clear
          </Button>
        </div>
        {LETTER_GROUPS.map((group) => {
          const all = group.chars.every((c) => pickedSet.has(c));
          return (
            <div key={group.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</span>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline cursor-pointer"
                  onClick={() => setGroup(group.chars, !all)}
                >
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
                        "flex aspect-square items-center justify-center rounded-md border text-sm font-semibold transition cursor-pointer",
                        on
                          ? "border-primary bg-primary text-primary-foreground shadow-xs"
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
      </TabsContent>
    </Tabs>
  );
}
