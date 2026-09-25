import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe, Loader2, Search, Sparkles, Type, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BUNDLED_FONTS,
  cssFamily,
  defaultWeight,
  googleFontChoice,
  loadGoogleCatalogue,
  registerPreviewFace,
  uploadedFontChoice,
  type CatalogueFont,
  type FontChoice,
} from "@/lib/fonts";
import { cn } from "@/lib/utils";

const SAMPLE = "ABC abc 123";

function FontSample({ choice, text = SAMPLE, className }: { choice: FontChoice; text?: string; className?: string }) {
  useEffect(() => registerPreviewFace(choice), [choice]);
  return (
    <span className={cn("block truncate", className)} style={{ fontFamily: `"${cssFamily(choice)}", system-ui` }}>
      {text}
    </span>
  );
}

const CATEGORY_NAMES: Record<string, string> = {
  display: "Display",
  "sans-serif": "Sans serif",
  serif: "Serif",
  handwriting: "Handwriting",
  monospace: "Monospace",
};

function GoogleFontsTab({ onPick }: { onPick: (c: FontChoice) => void }) {
  const [catalogue, setCatalogue] = useState<CatalogueFont[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("display");
  const [selected, setSelected] = useState<CatalogueFont | null>(null);
  const [weight, setWeight] = useState<number>(400);

  useEffect(() => {
    loadGoogleCatalogue()
      .then(setCatalogue)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const matches = useMemo(() => {
    if (!catalogue) return [];
    const q = query.trim().toLowerCase();
    return catalogue.filter(
      (f) => (category === "all" || f.category === category) && (!q || f.family.toLowerCase().includes(q)),
    );
  }, [catalogue, query, category]);

  const preview = selected ? googleFontChoice(selected, weight) : null;

  if (error) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Couldn't reach the Google Fonts catalogue ({error}). Check your connection, or pick one of the recommended fonts,
        or upload a font file.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search 1,800+ Google Fonts…"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All styles</SelectItem>
            {Object.entries(CATEGORY_NAMES).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="h-56 overflow-y-auto rounded-lg border">
        {!catalogue ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading catalogue…
          </div>
        ) : matches.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No fonts match.</div>
        ) : (
          <ul className="divide-y">
            {matches.slice(0, 200).map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(f);
                    setWeight(defaultWeight(f.weights));
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent cursor-pointer",
                    selected?.id === f.id && "bg-accent",
                  )}
                >
                  <span className="font-medium">{f.family}</span>
                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_NAMES[f.category] ?? f.category} · {f.weights.length} weight{f.weights.length > 1 ? "s" : ""}
                  </span>
                </button>
              </li>
            ))}
            {matches.length > 200 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                {matches.length - 200} more; refine your search to see them.
              </li>
            )}
          </ul>
        )}
      </div>

      {selected && preview && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1">
            <FontSample choice={preview} text="Aa Bb Gg 123" className="text-3xl leading-tight" />
            <p className="mt-1 text-xs text-muted-foreground">{selected.family}</p>
          </div>
          <Select value={String(weight)} onValueChange={(v) => setWeight(Number(v))}>
            <SelectTrigger className="w-32" aria-label="Weight">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selected.weights.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  Weight {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => onPick(preview)}>Use font</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Fonts are downloaded from the free{" "}
        <a className="underline" href="https://fontsource.org" target="_blank" rel="noreferrer">
          Fontsource
        </a>{" "}
        mirror of Google Fonts. Tip: heavier weights make sturdier templates that are easier to trace.
      </p>
    </div>
  );
}

export function FontPicker({ value, onChange }: { value: FontChoice; onChange: (c: FontChoice) => void }) {
  const [open, setOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (c: FontChoice) => {
    onChange(c);
    setOpen(false);
  };

  const categories = [...new Set(BUNDLED_FONTS.map((f) => f.category))];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-3 rounded-lg border bg-background p-3 text-left shadow-xs transition hover:border-primary/50 hover:bg-accent/40 cursor-pointer"
        >
          <div className="min-w-0 flex-1">
            <FontSample choice={value} text="Aa Bb Cc" className="text-2xl leading-tight" />
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {value.family}
              {value.source !== "bundled" && <span>· weight {value.weight}</span>}
              {value.source === "google" && <Globe className="size-3" />}
              {value.source === "upload" && <Upload className="size-3" />}
            </p>
          </div>
          <span className="text-sm font-medium text-primary group-hover:underline">Change</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a font</DialogTitle>
          <DialogDescription>Bold, chunky fonts are easiest to trace, cut and stitch around.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="recommended">
          <TabsList className="w-full">
            <TabsTrigger value="recommended">
              <Sparkles /> Recommended
            </TabsTrigger>
            <TabsTrigger value="google">
              <Globe /> All Google Fonts
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload /> Upload
            </TabsTrigger>
          </TabsList>
          <TabsContent value="recommended">
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
              {categories.map((cat) => (
                <div key={cat}>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h4>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {BUNDLED_FONTS.filter((f) => f.category === cat).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        title={f.note}
                        onClick={() => pick(f)}
                        className={cn(
                          "relative rounded-lg border p-3 text-left transition hover:border-primary/60 hover:bg-accent/40 cursor-pointer",
                          value.key === f.key && "border-primary ring-2 ring-primary/20",
                        )}
                      >
                        <FontSample choice={f} text="Aa Bb" className="text-2xl" />
                        <p className="mt-1 truncate text-xs text-muted-foreground">{f.family}</p>
                        {value.key === f.key && <Check className="absolute right-2 top-2 size-4 text-primary" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="google">
            <GoogleFontsTab onPick={pick} />
          </TabsContent>
          <TabsContent value="upload">
            <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
              <Type className="mx-auto size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Use any font file on your computer: TTF, OTF or WOFF. (WOFF2 files are not supported.)
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    setUploadError(null);
                    pick(await uploadedFontChoice(file));
                  } catch (err) {
                    setUploadError(`That file couldn't be read as a font. ${err instanceof Error ? err.message : ""}`);
                  }
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload /> Choose font file
              </Button>
              {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
            </div>
          </TabsContent>
        </Tabs>
        {value.source === "google" && (
          <Badge variant="secondary" className="justify-self-start">
            Current: {value.family} {value.weight}
          </Badge>
        )}
      </DialogContent>
    </Dialog>
  );
}
