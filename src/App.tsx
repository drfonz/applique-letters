import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { Font } from "opentype.js";
import {
  Box,
  Download,
  FileArchive,
  LayoutGrid,
  Loader2,
  Moon,
  Printer,
  Ruler,
  Scissors,
  Sparkles,
  Sun,
  TriangleAlert,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FontPicker } from "@/components/FontPicker";
import { LetterCard } from "@/components/LetterCard";
import { LetterPicker, sortChars, type LetterMode } from "@/components/LetterPicker";
import { PlatePreview } from "@/components/PlatePreview";
import { SliderField } from "@/components/SliderField";
import { usePacking } from "@/hooks/usePacking";
import { BUNDLED_FONTS, loadFont, type FontChoice } from "@/lib/fonts";
import { downloadBlob, meshToStl, meshesTo3mf, regionsToPathData, zipFiles } from "@/lib/export";
import { extrudeRegions, mergeMeshes } from "@/lib/mesh";
import type { NestOptions } from "@/lib/nest";
import { printPaperTemplates } from "@/lib/paper";
import { buildPlates, type PlateLayout } from "@/lib/plates";
import { PRINTERS } from "@/lib/printers";
import { buildTemplates, countCharacters, thicknessOf, type TemplateSettings } from "@/lib/templates";

// three.js is large, so the 3D view is only loaded when it is first opened.
const Plate3D = lazy(() => import("@/components/Plate3D").then((m) => ({ default: m.Plate3D })));

const PLA_DENSITY = 1.24; // g/cm³
const REPO_URL = "https://github.com/drfonz/applique-letters";

interface Settings extends TemplateSettings {
  mode: LetterMode;
  text: string;
  perOccurrence: boolean;
  picked: string[];
  overrides: Record<string, number>;
  font: FontChoice;
  printer: string;
  bedWidth: number;
  bedDepth: number;
  margin: number;
  spacing: number;
  allowRotation: boolean;
}

const DEFAULTS: Settings = {
  mode: "text",
  text: "HAPPY BIRTHDAY",
  perOccurrence: false,
  picked: Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  overrides: {},
  font: BUNDLED_FONTS[0],
  letterHeight: 100,
  outlineOffset: 0,
  layers: 6,
  layerHeight: 0.2,
  mirror: false,
  printer: "bambu-x1",
  bedWidth: 256,
  bedDepth: 256,
  margin: 5,
  spacing: 3,
  allowRotation: true,
};

const STORAGE_KEY = "applique-letters:v1";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULTS, ...saved };
    // Bundled font URLs change between builds, so always use the current entry.
    if (merged.font?.source === "bundled") merged.font = BUNDLED_FONTS.find((f) => f.key === merged.font.key) ?? DEFAULTS.font;
    if (merged.font?.source === "upload") merged.font = DEFAULTS.font;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      /* private mode */
    }
  }, [dark]);
  return [dark, setDark] as const;
}

const inches = (mm: number) => (mm / 25.4).toFixed(mm < 50 ? 2 : 1);

function StepCard({
  step,
  icon: Icon,
  title,
  description,
  children,
}: {
  step: number;
  icon: typeof Type;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {step}
          </span>
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center gap-2 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [dark, setDark] = useTheme();
  const [font, setFont] = useState<Font | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontLoading, setFontLoading] = useState(false);
  const [selectedPlate, setSelectedPlate] = useState(0);
  const [view, setView] = useState("plates");
  const [actionError, setActionError] = useState<string | null>(null);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, font: settings.font.buffer ? DEFAULTS.font : settings.font }));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    setFontLoading(true);
    setFontError(null);
    loadFont(settings.font)
      .then((f) => !cancelled && setFont(f))
      .catch((e) => !cancelled && setFontError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setFontLoading(false));
    return () => {
      cancelled = true;
    };
  }, [settings.font]);

  // Which characters, and how many copies of each.
  const selection = useMemo(() => {
    if (settings.mode === "text") {
      const counts = countCharacters(settings.text);
      return [...counts].map(([char, n]) => ({ char, copies: settings.overrides[char] ?? (settings.perOccurrence ? n : 1) }));
    }
    return sortChars(settings.picked).map((char) => ({ char, copies: settings.overrides[char] ?? 1 }));
  }, [settings.mode, settings.text, settings.perOccurrence, settings.picked, settings.overrides]);

  const geometry = {
    letterHeight: settings.letterHeight,
    outlineOffset: settings.outlineOffset,
    layers: settings.layers,
    layerHeight: settings.layerHeight,
    mirror: settings.mirror,
  };
  const geometryKey = JSON.stringify(geometry);
  const charsKey = selection.map((s) => s.char).join("");

  const { templates, missing } = useMemo(() => {
    if (!font) return { templates: [], missing: [] };
    return buildTemplates(
      font,
      selection.map((s) => s.char),
      geometry,
    );
  }, [font, charsKey, geometryKey]);

  const copiesFor = (char: string) => selection.find((s) => s.char === char)?.copies ?? 1;
  const items = useMemo(
    () =>
      templates.flatMap((t, shape) => Array.from({ length: copiesFor(t.char) }, (_, i) => ({ shape, copy: i + 1 }))),
    [templates, selection],
  );

  const bed = { width: settings.bedWidth, depth: settings.bedDepth };
  const nestOptions: NestOptions = useMemo(
    () => ({
      bedWidth: settings.bedWidth,
      bedDepth: settings.bedDepth,
      margin: settings.margin,
      spacing: settings.spacing,
      allowRotation: settings.allowRotation,
      timeBudgetMs: 4000,
    }),
    [settings.bedWidth, settings.bedDepth, settings.margin, settings.spacing, settings.allowRotation],
  );
  const packing = usePacking(templates, items, nestOptions);
  const thickness = thicknessOf(settings);

  const plates: PlateLayout[] = useMemo(() => {
    if (!packing.result) return [];
    return buildPlates(packing.templates, packing.result, bed);
  }, [packing.result, packing.templates, bed.width, bed.depth]);

  useEffect(() => {
    if (selectedPlate >= plates.length) setSelectedPlate(0);
  }, [plates.length, selectedPlate]);

  const tooBig = new Set(
    (packing.result?.unplaced ?? []).map((u) => packing.templates[u.shape]?.char).filter(Boolean) as string[],
  );
  const totalPieces = items.length;
  const grams =
    (templates.reduce((s, t) => s + t.area * copiesFor(t.char), 0) * thickness * PLA_DENSITY) / 1000;
  const stale = packing.running || packing.templates !== templates;

  const plateObjects = (plate: PlateLayout) =>
    plate.letters.map((l) => ({
      name: l.copy > 1 ? `${l.template.char} (${l.copy})` : l.template.char,
      mesh: extrudeRegions(l.regions, thickness),
    }));

  const fileBase = () => {
    const words = settings.mode === "text" ? settings.text.trim() : "letters";
    return (
      (words || "letters")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40)
        .toLowerCase() || "letters"
    );
  };

  const run = (fn: () => void) => {
    try {
      setActionError(null);
      fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const download3mf = (plate: PlateLayout) =>
    run(() =>
      downloadBlob(
        meshesTo3mf(plateObjects(plate), `${fileBase()} plate ${plate.index + 1}`),
        `${fileBase()}-plate-${plate.index + 1}.3mf`,
        "model/3mf",
      ),
    );

  const downloadStl = (plate: PlateLayout) =>
    run(() =>
      downloadBlob(
        meshToStl(mergeMeshes(plateObjects(plate).map((o) => o.mesh)), `plate ${plate.index + 1}`),
        `${fileBase()}-plate-${plate.index + 1}.stl`,
        "model/stl",
      ),
    );

  const downloadAll = () =>
    run(() => {
      const files: Record<string, Uint8Array> = {};
      for (const plate of plates) {
        const objects = plateObjects(plate);
        files[`plates/plate-${plate.index + 1}.3mf`] = meshesTo3mf(objects, `${fileBase()} plate ${plate.index + 1}`);
        files[`plates/plate-${plate.index + 1}.stl`] = meshToStl(mergeMeshes(objects.map((o) => o.mesh)));
        const paths = plate.letters.map((l) => `<path d="${regionsToPathData(l.regions, bed.depth)}"/>`).join("\n");
        files[`svg/plate-${plate.index + 1}.svg`] = new TextEncoder().encode(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${bed.width}mm" height="${bed.depth}mm" viewBox="0 0 ${bed.width} ${bed.depth}">\n` +
            `<g fill="none" stroke="#000" stroke-width="0.2" fill-rule="evenodd">\n${paths}\n</g></svg>\n`,
        );
      }
      for (const t of templates) {
        files[`letters/${t.slug}.stl`] = meshToStl(extrudeRegions(t.regions, thickness), t.char);
      }
      files["README.txt"] = new TextEncoder().encode(
        [
          `Appliqué letter templates: ${settings.mode === "text" ? settings.text : sortChars(settings.picked).join(" ")}`,
          `Font: ${settings.font.family} (${settings.font.weight})`,
          `Capital letter height: ${settings.letterHeight} mm, outline offset: ${settings.outlineOffset} mm`,
          `Thickness: ${thickness} mm (${settings.layers} layers of ${settings.layerHeight} mm)`,
          `Plates: ${plates.length} for a ${bed.width} × ${bed.depth} mm bed`,
          "",
          "plates/   Ready-to-print plates. Open the .3mf files in Bambu Studio, OrcaSlicer or PrusaSlicer;",
          "          every letter is its own object.",
          "letters/  One STL per letter, if you'd rather arrange them yourself.",
          "svg/      1:1 outlines of each plate, for cutting machines or laser cutters.",
          "",
          `Made with Appliqué Letters: ${REPO_URL}`,
        ].join("\n"),
      );
      downloadBlob(zipFiles(files), `${fileBase()}-templates.zip`, "application/zip");
    });

  const printPaper = () =>
    run(() =>
      printPaperTemplates(
        templates,
        templates.map((t) => copiesFor(t.char)),
        `${settings.font.family} · ${settings.letterHeight} mm letters`,
      ),
    );

  const setCopies = (char: string, n: number) => set("overrides", { ...settings.overrides, [char]: n });
  const printer = PRINTERS.find((p) => p.id === settings.printer) ?? PRINTERS[0];
  const current = plates[selectedPlate];

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Scissors className="size-4" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-semibold">Appliqué Letters</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">3D-printable letter templates for banners & quilts</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">
                {dark ? <Sun /> : <Moon />}
              </Button>
              <Button variant="ghost" size="icon" asChild>
                <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source code on GitHub">
                  <GithubIcon />
                </a>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[400px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <StepCard step={1} icon={Type} title="Letters" description="Type your banner words, or pick exactly the letters you need.">
              <LetterPicker
                mode={settings.mode}
                onModeChange={(m) => set("mode", m)}
                text={settings.text}
                onTextChange={(t) => set("text", t)}
                perOccurrence={settings.perOccurrence}
                onPerOccurrenceChange={(v) => setSettings((s) => ({ ...s, perOccurrence: v, overrides: {} }))}
                picked={settings.picked}
                onPickedChange={(p) => set("picked", p)}
                missing={missing}
              />
            </StepCard>

            <StepCard step={2} icon={Sparkles} title="Font">
              <FontPicker value={settings.font} onChange={(f) => set("font", f)} />
              {fontError && <p className="text-sm text-destructive">{fontError}</p>}
            </StepCard>

            <StepCard step={3} icon={Ruler} title="Size & thickness">
              <SliderField
                id="height"
                label="Letter height"
                value={settings.letterHeight}
                min={30}
                max={250}
                step={5}
                onChange={(v) => set("letterHeight", v)}
                display={
                  <>
                    <span className="font-semibold text-foreground">{settings.letterHeight} mm</span> · {inches(settings.letterHeight)}″
                  </>
                }
                hint="Height of a capital letter. Lower-case letters and symbols are scaled to match."
              />
              <SliderField
                id="offset"
                label="Seam allowance"
                value={settings.outlineOffset}
                min={-2}
                max={10}
                step={0.5}
                onChange={(v) => set("outlineOffset", v)}
                display={
                  <>
                    <span className="font-semibold text-foreground">
                      {settings.outlineOffset > 0 ? "+" : ""}
                      {settings.outlineOffset} mm
                    </span>
                    {settings.outlineOffset !== 0 && <> · {inches(Math.abs(settings.outlineOffset))}″</>}
                  </>
                }
                hint="Grows the outline all round. Leave at 0 for raw-edge or pinked appliqué; add 4–6 mm (about ¼″) for needle-turn."
              />
              <SliderField
                id="layers"
                label="Thickness"
                value={settings.layers}
                min={2}
                max={16}
                step={1}
                onChange={(v) => set("layers", v)}
                display={
                  <>
                    <span className="font-semibold text-foreground">{thickness} mm</span> · {settings.layers} layers
                  </>
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Layer height</Label>
                  <Select value={String(settings.layerHeight)} onValueChange={(v) => set("layerHeight", Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0.08, 0.12, 0.16, 0.2, 0.24, 0.28].map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {h.toFixed(2)} mm
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
                  <Label htmlFor="mirror" className="leading-snug">
                    Mirror letters
                  </Label>
                  <Switch id="mirror" checked={settings.mirror} onCheckedChange={(v) => set("mirror", v)} />
                </div>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                Mirroring is handy for paper templates traced onto fusible web, which needs reversed letters.
              </p>
            </StepCard>

            <StepCard step={4} icon={Printer} title="Printer">
              <div className="space-y-2">
                <Label>Printer</Label>
                <Select
                  value={settings.printer}
                  onValueChange={(id) => {
                    const p = PRINTERS.find((x) => x.id === id)!;
                    setSettings((s) => ({
                      ...s,
                      printer: id,
                      ...(id === "custom" ? {} : { bedWidth: p.width, bedDepth: p.depth }),
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRINTERS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.id !== "custom" && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {p.width} × {p.depth}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {printer.id === "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  {(["bedWidth", "bedDepth"] as const).map((k) => (
                    <div key={k} className="space-y-2">
                      <Label htmlFor={k}>{k === "bedWidth" ? "Width (mm)" : "Depth (mm)"}</Label>
                      <Input
                        id={k}
                        type="number"
                        min={50}
                        max={1000}
                        value={settings[k]}
                        onChange={(e) => set(k, Math.max(50, Math.min(1000, Number(e.target.value) || 50)))}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <SliderField
                  id="spacing"
                  label="Gap between letters"
                  value={settings.spacing}
                  min={1}
                  max={15}
                  step={0.5}
                  onChange={(v) => set("spacing", v)}
                  display={`${settings.spacing} mm`}
                />
                <SliderField
                  id="margin"
                  label="Edge margin"
                  value={settings.margin}
                  min={0}
                  max={20}
                  step={1}
                  onChange={(v) => set("margin", v)}
                  display={`${settings.margin} mm`}
                />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/50 p-3">
                <div className="space-y-1">
                  <Label htmlFor="rotate">Rotate letters to save plates</Label>
                  <p className="text-xs text-muted-foreground">
                    Lets letters turn sideways or upside down so they nest together more tightly.
                  </p>
                </div>
                <Switch id="rotate" checked={settings.allowRotation} onCheckedChange={(v) => set("allowRotation", v)} />
              </div>
            </StepCard>
          </aside>

          <section className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Templates" value={totalPieces} sub={`${templates.length} different characters`} />
              <Stat
                label="Build plates"
                value={
                  <>
                    {packing.result ? packing.result.plateCount : "–"}
                    {stale && items.length > 0 && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  </>
                }
                sub={
                  packing.result && items.length > 0
                    ? packing.running
                      ? `Optimising… ${packing.result.iterations} layouts tried`
                      : packing.result.plateCount <= packing.result.lowerBound
                        ? "Optimal: can't be done in fewer"
                        : `${packing.result.iterations} layouts tried`
                    : "Nothing to print yet"
                }
              />
              <Stat
                label="Filament"
                value={`${grams < 10 ? grams.toFixed(1) : Math.round(grams)} g`}
                sub="Estimated, in PLA"
              />
              <Stat label="Thickness" value={`${thickness} mm`} sub={`${settings.layers} × ${settings.layerHeight} mm layers`} />
            </div>

            {(missing.length > 0 || tooBig.size > 0 || packing.error || actionError || fontLoading) && (
              <div className="space-y-2">
                {fontLoading && (
                  <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading {settings.font.family}…
                  </div>
                )}
                {missing.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <span>
                      {settings.font.family} has no {missing.map((m) => `“${m}”`).join(", ")}, so{" "}
                      {missing.length === 1 ? "it has" : "they have"} been left out.
                    </span>
                  </div>
                )}
                {tooBig.size > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <span>
                      {[...tooBig].join(", ")} {tooBig.size === 1 ? "is" : "are"} too big for a {bed.width} × {bed.depth} mm
                      plate. Reduce the letter height or margin.
                    </span>
                  </div>
                )}
                {(packing.error || actionError) && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {packing.error || actionError}
                  </div>
                )}
              </div>
            )}

            <Card className="gap-4">
              <CardContent>
                <Tabs value={view} onValueChange={setView}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <TabsList>
                      <TabsTrigger value="plates">
                        <LayoutGrid /> Plates
                      </TabsTrigger>
                      <TabsTrigger value="3d">
                        <Box /> 3D view
                      </TabsTrigger>
                      <TabsTrigger value="letters">
                        <Type /> Letters
                      </TabsTrigger>
                    </TabsList>
                    {plates.length > 1 && view !== "letters" && (
                      <div className="flex flex-wrap gap-1">
                        {plates.map((p) => (
                          <Button
                            key={p.index}
                            size="sm"
                            variant={p.index === selectedPlate ? "default" : "outline"}
                            onClick={() => setSelectedPlate(p.index)}
                          >
                            Plate {p.index + 1}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>

                  <TabsContent value="plates">
                    {plates.length === 0 ? (
                      <EmptyState running={stale && items.length > 0} />
                    ) : (
                      <div className={`grid gap-4 ${plates.length > 1 ? "sm:grid-cols-2" : "max-w-xl mx-auto"}`}>
                        {plates.map((p) => (
                          <PlatePreview
                            key={p.index}
                            plate={p}
                            bed={bed}
                            margin={settings.margin}
                            selected={plates.length > 1 && p.index === selectedPlate}
                            onSelect={() => setSelectedPlate(p.index)}
                            className={stale ? "opacity-70" : undefined}
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="3d">
                    {current ? (
                      <div className="space-y-2">
                        <Suspense
                          fallback={
                            <div className="flex h-[420px] items-center justify-center rounded-xl bg-muted/60 sm:h-[520px]">
                              <Loader2 className="size-5 animate-spin text-muted-foreground" />
                            </div>
                          }
                        >
                          <Plate3D plate={current} bed={bed} thickness={thickness} />
                        </Suspense>
                        <p className="text-xs text-muted-foreground">Drag to orbit, scroll or pinch to zoom.</p>
                      </div>
                    ) : (
                      <EmptyState running={stale && items.length > 0} />
                    )}
                  </TabsContent>

                  <TabsContent value="letters">
                    {templates.length === 0 ? (
                      <EmptyState running={false} />
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                          {templates.map((t) => (
                            <LetterCard
                              key={t.char}
                              template={t}
                              copies={copiesFor(t.char)}
                              onCopiesChange={(n) => setCopies(t.char, n)}
                              tooBig={tooBig.has(t.char)}
                              onDownload={() =>
                                run(() =>
                                  downloadBlob(meshToStl(extrudeRegions(t.regions, thickness), t.char), `${t.slug}.stl`, "model/stl"),
                                )
                              }
                            />
                          ))}
                        </div>
                        {Object.keys(settings.overrides).length > 0 && (
                          <Button variant="ghost" size="sm" onClick={() => set("overrides", {})}>
                            Reset copies
                          </Button>
                        )}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="size-4" /> Download
                </CardTitle>
                <CardDescription>
                  .3mf files open in Bambu Studio with every letter as its own object, already laid out on the plate.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {plates.length > 0 && (
                  <div className="divide-y rounded-lg border">
                    {plates.map((p) => (
                      <div key={p.index} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <div className="mr-auto min-w-0">
                          <div className="text-sm font-medium">Plate {p.index + 1}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {p.letters.map((l) => l.template.char).join(" ")}
                          </div>
                        </div>
                        <Button size="sm" onClick={() => download3mf(p)} disabled={stale}>
                          <Download /> 3MF
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadStl(p)} disabled={stale}>
                          STL
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={downloadAll} disabled={plates.length === 0 || stale} variant="secondary">
                    <FileArchive /> Everything (.zip)
                  </Button>
                  <Button onClick={printPaper} disabled={templates.length === 0} variant="outline">
                    <Printer /> Print on paper
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tips for printing and sewing</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                  <li>
                    <strong className="text-foreground">Slicing.</strong> Open the .3mf, pick your filament and press print.
                    Thin templates need no supports; a textured PEI plate gives a grippy underside.
                  </li>
                  <li>
                    <strong className="text-foreground">Tracing.</strong> Lay the template on the wrong side of the fabric and
                    trace with a fabric pencil or heat-erasable pen. Flip the template to trace a mirrored letter.
                  </li>
                  <li>
                    <strong className="text-foreground">Pinking shears.</strong> Cutting just outside the line with pinking
                    shears stops raw edges fraying; leave the seam allowance at 0.
                  </li>
                  <li>
                    <strong className="text-foreground">Fusible web.</strong> Letters go on the paper backing reversed. Trace
                    round the template face-down, or print mirrored paper templates.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </section>
        </main>

        <Separator />
        <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground">
          <span>
            Free and open source under the MIT licence. Fonts are from Google Fonts, under their own open licences.
          </span>
          <a className="underline" href={REPO_URL} target="_blank" rel="noreferrer">
            Contribute on GitHub
          </a>
        </footer>
      </div>
    </TooltipProvider>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function EmptyState({ running }: { running: boolean }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground">
      {running ? (
        <>
          <Loader2 className="size-5 animate-spin" /> Arranging your letters…
        </>
      ) : (
        <>
          <Type className="size-5" /> Type some words or pick letters to get started.
        </>
      )}
    </div>
  );
}
