import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Font } from "opentype.js";
import { DropdownMenu, Popover } from "radix-ui";
import { Loader2, TriangleAlert, Type, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FontTiles } from "@/components/FontPicker";
import { LetterCard } from "@/components/LetterCard";
import { LetterPicker, sortChars, type LetterMode } from "@/components/LetterPicker";
import { PlatePreview } from "@/components/PlatePreview";
import { SliderField } from "@/components/SliderField";
import { ToggleRow } from "@/components/ToggleRow";
import { usePacking } from "@/hooks/usePacking";
import { BUNDLED_FONTS, cssFamily, loadFont, registerPreviewFace, type FontChoice } from "@/lib/fonts";
import { downloadBlob, meshToStl, meshesTo3mf, regionsToPathData, zipFiles } from "@/lib/export";
import { mergeMeshes } from "@/lib/mesh";
import { handleVolume, placeHandle, templateSolid, type HandleSettings } from "@/lib/handle";
import type { NestOptions } from "@/lib/nest";
import { printPaperTemplates } from "@/lib/paper";
import { buildPlates, type PlateLayout } from "@/lib/plates";
import { PRINTERS, keepOutAreas } from "@/lib/printers";
import { buildTemplates, countCharacters, thicknessOf, type TemplateSettings } from "@/lib/templates";
import { cn } from "@/lib/utils";

// three.js is large, so the 3D view is only loaded when it is first opened.
const Plate3D = lazy(() => import("@/components/Plate3D").then((m) => ({ default: m.Plate3D })));

const PLA_DENSITY = 1.24; // g/cm³
const REPO_URL = "https://github.com/drfonz/applique-letters";
const STUDIO_URL = "https://indigolabs.studio";
const LAYER_HEIGHTS = [0.12, 0.16, 0.2, 0.28];

const TIPS = [
  {
    title: "Slicing.",
    body: "Open the .3mf, pick your filament and press print. Thin templates need no supports; a textured PEI plate gives a grippy underside. If Bambu Studio says the file has an “invalid config”, click OK: the file only carries the letters, so your own settings are kept.",
  },
  {
    title: "Tracing.",
    body: "Lay the template on the wrong side of the fabric and trace with a fabric pencil or heat-erasable pen. Flip the template to trace a mirrored letter.",
  },
  {
    title: "Pinking shears.",
    body: "Cutting just outside the line with pinking shears stops raw edges fraying; leave the seam allowance at 0.",
  },
  {
    title: "Grip handles.",
    body: "Press straight down on the knob with one finger and trace all the way round without letting go. With handles on, flip-tracing a mirrored letter is not possible, so use the Mirror letters option and print a second set instead.",
  },
  {
    title: "Fusible web.",
    body: "Letters go on the paper backing reversed. Trace round the template face-down, or print mirrored paper templates.",
  },
];

type SectionId = "letters" | "font" | "size" | "printer";
type View = "plates" | "3d" | "letters";

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
  /** Leave room for Bambu Studio's prime tower on Bambu printers. */
  primeTower: boolean;
  handle: HandleSettings;
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
  primeTower: false,
  handle: { enabled: false, diameter: 12, height: 15 },
};

const STORAGE_KEY = "applique-letters:v1";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULTS, ...saved, handle: { ...DEFAULTS.handle, ...saved.handle } };
    // Bundled font URLs change between builds, so always use the current entry.
    if (merged.font?.source === "bundled")
      merged.font = BUNDLED_FONTS.find((f) => f.key === merged.font.key) ?? DEFAULTS.font;
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

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [dark, setDark] = useTheme();
  const [font, setFont] = useState<Font | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontLoading, setFontLoading] = useState(false);
  const [selectedPlate, setSelectedPlate] = useState(0);
  const [view, setView] = useState<View>("plates");
  const [section, setSection] = useState<SectionId | null>("letters");
  const [moreOpen, setMoreOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...settings, font: settings.font.buffer ? DEFAULTS.font : settings.font }),
      );
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

  useEffect(() => registerPreviewFace(settings.font), [settings.font]);

  // Which characters, and how many copies of each.
  const selection = useMemo(() => {
    if (settings.mode === "text") {
      const counts = countCharacters(settings.text);
      return [...counts].map(([char, n]) => ({
        char,
        copies: settings.overrides[char] ?? (settings.perOccurrence ? n : 1),
      }));
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
  const printer = PRINTERS.find((p) => p.id === settings.printer) ?? PRINTERS[0];
  const keepOut = useMemo(
    () => keepOutAreas(printer, { width: settings.bedWidth, depth: settings.bedDepth }, settings.primeTower),
    [printer, settings.bedWidth, settings.bedDepth, settings.primeTower],
  );
  const nestOptions: NestOptions = useMemo(
    () => ({
      bedWidth: settings.bedWidth,
      bedDepth: settings.bedDepth,
      margin: settings.margin,
      spacing: settings.spacing,
      allowRotation: settings.allowRotation,
      keepOut,
      timeBudgetMs: 4000,
    }),
    [settings.bedWidth, settings.bedDepth, settings.margin, settings.spacing, settings.allowRotation, keepOut],
  );
  const packing = usePacking(templates, items, nestOptions);
  const thickness = thicknessOf(settings);

  const plates: PlateLayout[] = useMemo(() => {
    if (!packing.result) return [];
    return buildPlates(packing.templates, packing.result, bed, keepOut.length === 0);
  }, [packing.result, packing.templates, bed.width, bed.depth, keepOut]);

  useEffect(() => {
    if (selectedPlate >= plates.length) setSelectedPlate(0);
  }, [plates.length, selectedPlate]);

  // Left and right arrow keys step through the plates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view === "letters" || plates.length < 2 || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=slider], [role=listbox], [role=menu], [role=dialog]")) return;
      if (e.key === "ArrowRight") setSelectedPlate((i) => Math.min(plates.length - 1, i + 1));
      if (e.key === "ArrowLeft") setSelectedPlate((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, plates.length]);

  const tooBig = new Set(
    (packing.result?.unplaced ?? []).map((u) => packing.templates[u.shape]?.char).filter(Boolean) as string[],
  );
  const totalPieces = items.length;
  const handle = settings.handle;
  const handles = useMemo(
    () => new Map(templates.map((t) => [t.char, placeHandle(t.regions, handle)])),
    [templates, handle],
  );
  const reducedHandles = templates.filter((t) => handles.get(t.char)?.reduced).map((t) => t.char);
  const grams =
    (templates.reduce((s, t) => {
      const h = handles.get(t.char);
      return s + (t.area * thickness + (h ? handleVolume(h, handle.height) : 0)) * copiesFor(t.char);
    }, 0) *
      PLA_DENSITY) /
    1000;
  const stale = packing.running || packing.templates !== templates;

  const plateObjects = (plate: PlateLayout) =>
    plate.letters.map((l) => ({
      name: l.copy > 1 ? `${l.template.char} (${l.copy})` : l.template.char,
      mesh: templateSolid(l.regions, thickness, handle),
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
        files[`letters/${t.slug}.stl`] = meshToStl(templateSolid(t.regions, thickness, handle), t.char);
      }
      files["README.txt"] = new TextEncoder().encode(
        [
          `Appliqué letter templates: ${settings.mode === "text" ? settings.text : sortChars(settings.picked).join(" ")}`,
          `Font: ${settings.font.family} (${settings.font.weight})`,
          `Capital letter height: ${settings.letterHeight} mm, outline offset: ${settings.outlineOffset} mm`,
          `Thickness: ${thickness} mm (${settings.layers} layers of ${settings.layerHeight} mm)`,
          handle.enabled ? `Grip handle: ${handle.diameter} mm across, ${handle.height} mm tall` : "Grip handle: none",
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
  const current = plates[selectedPlate];
  const result = packing.result && items.length > 0 ? packing.result : null;
  const optimal = !!result && !packing.running && result.plateCount <= result.lowerBound;
  const gramsLabel = `${grams < 10 ? grams.toFixed(1) : Math.round(grams)} g`;
  const displayFamily = cssFamily(settings.font);
  const toggleSection = (id: SectionId) => setSection((s) => (s === id ? null : id));

  const packingNote = !result
    ? stale && items.length > 0
      ? "Arranging your letters…"
      : "Nothing to print yet"
    : packing.running
      ? `Optimising… ${result.iterations} layouts tried`
      : optimal
        ? `Optimal · can’t be done in fewer than ${result.plateCount}`
        : `${result.iterations} layouts tried`;

  const stats = (
    <>
      <span>
        <b className="font-medium text-foreground">{totalPieces}</b> templates
      </span>
      <span className="h-4 w-px bg-border" />
      <span className="flex items-center gap-2">
        <span>
          <b className="font-medium text-foreground">{result ? result.plateCount : "–"}</b> plates
        </span>
        {stale && items.length > 0 ? (
          <Loader2 className="size-3.5 animate-spin" aria-label="Optimising" />
        ) : (
          optimal && (
            <span className="rounded-full bg-ochre px-2 py-0.5 text-[11px] text-ochre-foreground">optimal</span>
          )
        )}
      </span>
      <span className="h-4 w-px bg-border" />
      <span>
        <b className="font-medium text-foreground">{gramsLabel}</b> PLA
      </span>
    </>
  );

  const notices = [
    fontLoading && (
      <Notice key="loading" tone="info" icon={<Loader2 className="size-4 animate-spin" />}>
        Loading {settings.font.family}…
      </Notice>
    ),
    fontError && (
      <Notice key="font-error" tone="error">
        {fontError}
      </Notice>
    ),
    missing.length > 0 && (
      <Notice key="missing" tone="warning">
        {settings.font.family} has no {missing.map((m) => `“${m}”`).join(", ")}, so{" "}
        {missing.length === 1 ? "it has" : "they have"} been left out.
      </Notice>
    ),
    reducedHandles.length > 0 && (
      <Notice key="handles" tone="warning">
        {reducedHandles.join(", ")} {reducedHandles.length === 1 ? "is" : "are"} too narrow for a {handle.diameter} mm
        handle, so {reducedHandles.length === 1 ? "its handle has" : "their handles have"} been made thinner. A bolder
        font or bigger letters give room for a chunkier grip.
      </Notice>
    ),
    tooBig.size > 0 && (
      <Notice key="too-big" tone="error">
        {[...tooBig].join(", ")} {tooBig.size === 1 ? "is" : "are"} too big for a {bed.width} × {bed.depth} mm plate.
        Reduce the letter height or margin.
      </Notice>
    ),
    (packing.error || actionError) && (
      <Notice key="error" tone="error">
        {packing.error || actionError}
      </Notice>
    ),
  ].filter(Boolean);

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
        <header className="flex h-[60px] shrink-0 items-center gap-5 border-b bg-card px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo />
            <h1 className="truncate text-[17px] font-bold tracking-[-0.01em]">Appliqué Letters</h1>
          </div>
          <div className="ml-6 hidden shrink-0 items-center gap-3.5 whitespace-nowrap font-mono text-[13px] font-medium text-muted-foreground xl:flex">
            {stats}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <TipsButton />
            <button
              type="button"
              onClick={() => setDark(!dark)}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              title={dark ? "Light mode" : "Dark mode"}
              className={iconButton}
            >
              <span className="size-3.5 rounded-full border-[1.5px] border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]" />
            </button>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Source code on GitHub"
              title="Source code on GitHub"
              className={cn(iconButton, "hidden sm:flex")}
            >
              <GithubIcon />
            </a>
            <DownloadMenu
              current={current}
              disabled={plates.length === 0 || stale}
              canPrintPaper={templates.length > 0}
              onAll={downloadAll}
              on3mf={download3mf}
              onStl={downloadStl}
              onPaper={printPaper}
            />
          </div>
        </header>

        <div className="flex items-center gap-3 overflow-x-auto border-b bg-card px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground xl:hidden">
          {stats}
        </div>

        <div className="grid flex-1 lg:min-h-0 lg:grid-cols-[352px_minmax(0,1fr)]">
          <aside className="flex flex-col border-b bg-card lg:min-h-0 lg:border-r lg:border-b-0">
            <div className="flex-1 [scrollbar-gutter:stable] lg:overflow-y-auto">
              <Section
                id="letters"
                index="01"
                title="Letters"
                summary={`${totalPieces} pcs`}
                open={section === "letters"}
                onToggle={toggleSection}
              >
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
                  fontFamily={displayFamily}
                />
              </Section>

              <Section
                id="font"
                index="02"
                title="Font"
                summary={
                  settings.font.source === "bundled"
                    ? settings.font.family
                    : `${settings.font.family} ${settings.font.weight}`
                }
                open={section === "font"}
                onToggle={toggleSection}
              >
                <FontTiles value={settings.font} onChange={(f) => set("font", f)} />
              </Section>

              <Section
                id="size"
                index="03"
                title="Size & thickness"
                summary={`${settings.letterHeight} mm · ${thickness} mm${handle.enabled ? " · grip" : ""}`}
                open={section === "size"}
                onToggle={toggleSection}
              >
                <div className="flex flex-col gap-4">
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
                        <b className="font-medium text-foreground">{settings.letterHeight} mm</b> ·{" "}
                        {inches(settings.letterHeight)}″
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
                        <b className="font-medium text-foreground">
                          {settings.outlineOffset > 0 ? "+" : ""}
                          {settings.outlineOffset} mm
                        </b>
                        {settings.outlineOffset !== 0 && <> · {inches(Math.abs(settings.outlineOffset))}″</>}
                      </>
                    }
                    hint="Leave at 0 for raw-edge or pinked appliqué; add 4–6 mm (about ¼″) for needle-turn."
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
                        <b className="font-medium text-foreground">{thickness} mm</b> · {settings.layers} layers
                      </>
                    }
                  />
                  <div className="overflow-hidden rounded-xl bg-muted">
                    <button
                      type="button"
                      aria-expanded={moreOpen}
                      onClick={() => setMoreOpen(!moreOpen)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-[11px] text-left"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">Layer height, mirror &amp; grip handle</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {settings.layerHeight.toFixed(2)} mm · {settings.mirror ? "mirrored" : "not mirrored"} ·{" "}
                          {handle.enabled ? `${handle.diameter} mm handle` : "no handle"}
                        </span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-primary">
                        {moreOpen ? "Less ▴" : "More ▾"}
                      </span>
                    </button>
                    {moreOpen && (
                      <div className="flex flex-col border-t">
                        <div className="flex items-center justify-between gap-3 p-3">
                          <span className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium">Layer height</span>
                            <span className="text-xs text-muted-foreground">Match your slicer profile</span>
                          </span>
                          <Segmented
                            label="Layer height"
                            value={settings.layerHeight}
                            options={[...new Set([...LAYER_HEIGHTS, settings.layerHeight])].sort((a, b) => a - b)}
                            format={(v) => v.toFixed(2)}
                            onChange={(v) => set("layerHeight", v)}
                          />
                        </div>
                        <ToggleRow
                          checked={settings.mirror}
                          onChange={(v) => set("mirror", v)}
                          className="border-t"
                          title="Mirror letters"
                          description="For paper templates traced onto fusible web, which needs reversed letters."
                        />
                        <ToggleRow
                          checked={handle.enabled}
                          onChange={(v) => set("handle", { ...handle, enabled: v })}
                          className="border-t"
                          title="Grip handle"
                          description="A knob near the middle of each letter, so it can be held flat with one fingertip while you trace. Ideal if spreading your fingers is difficult."
                        />
                        {handle.enabled && (
                          <div className="grid grid-cols-2 gap-3.5 px-3 pt-1 pb-3.5">
                            <SliderField
                              compact
                              id="handle-diameter"
                              label="Diameter"
                              value={handle.diameter}
                              min={6}
                              max={25}
                              step={1}
                              onChange={(v) => set("handle", { ...handle, diameter: v })}
                              display={`${handle.diameter} mm`}
                            />
                            <SliderField
                              compact
                              id="handle-height"
                              label="Height"
                              value={handle.height}
                              min={6}
                              max={40}
                              step={1}
                              onChange={(v) => set("handle", { ...handle, height: v })}
                              display={`${handle.height} mm`}
                            />
                            <p className="col-span-full text-xs leading-[1.45] text-muted-foreground">
                              Placed on solid material, prints upright without supports, and thinned automatically on
                              narrow letters.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Section>

              <Section
                id="printer"
                index="04"
                title="Printer"
                summary={`${printer.id === "custom" ? "Custom" : printer.name} · ${bed.width} × ${bed.depth}`}
                open={section === "printer"}
                onToggle={toggleSection}
              >
                <div className="flex flex-col gap-3.5">
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
                    <SelectTrigger className="h-10 w-full rounded-[10px] bg-background" aria-label="Printer">
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
                  {printer.id === "custom" && (
                    <div className="grid grid-cols-2 gap-3">
                      {(["bedWidth", "bedDepth"] as const).map((k) => (
                        <div key={k} className="space-y-2">
                          <Label htmlFor={k} className="text-[13px] font-normal">
                            {k === "bedWidth" ? "Width (mm)" : "Depth (mm)"}
                          </Label>
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
                  <div className="grid grid-cols-2 gap-3">
                    <SliderField
                      compact
                      id="spacing"
                      label="Gap"
                      value={settings.spacing}
                      min={1}
                      max={15}
                      step={0.5}
                      onChange={(v) => set("spacing", v)}
                      display={`${settings.spacing} mm`}
                    />
                    <SliderField
                      compact
                      id="margin"
                      label="Margin"
                      value={settings.margin}
                      min={0}
                      max={20}
                      step={1}
                      onChange={(v) => set("margin", v)}
                      display={`${settings.margin} mm`}
                    />
                  </div>
                  <ToggleRow
                    checked={settings.allowRotation}
                    onChange={(v) => set("allowRotation", v)}
                    className="rounded-[10px] bg-muted"
                    title="Rotate letters to save plates"
                    description="Lets letters turn sideways or upside down so they nest together more tightly."
                  />
                  {printer.primeTower && (
                    <ToggleRow
                      checked={settings.primeTower}
                      onChange={(v) => set("primeTower", v)}
                      className="rounded-[10px] bg-muted"
                      title="Leave room for the prime tower"
                      description="Turn on if Bambu Studio adds a prime tower (with the AMS, smooth timelapses or nozzle-wrapping detection). Keeps its spot at the back of the plate clear, at the cost of a little space."
                    />
                  )}
                </div>
              </Section>
            </div>
            <div className="hidden border-t px-5 py-3.5 text-xs text-muted-foreground lg:block">
              Runs in your browser. Nothing is uploaded.
            </div>
          </aside>

          <main className="flex min-w-0 flex-col lg:min-h-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4 sm:px-6">
              <div role="tablist" aria-label="View" className="flex rounded-[10px] bg-muted p-[3px]">
                {(
                  [
                    ["plates", "Plates"],
                    ["3d", "3D"],
                    ["letters", "Letters"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={view === id}
                    onClick={() => setView(id)}
                    className={cn(
                      "h-8 cursor-pointer rounded-lg px-3.5 text-[13px] font-medium transition-colors",
                      view === id
                        ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.1)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2 font-mono text-[13px] text-muted-foreground">
                {packing.running && <Loader2 className="size-3.5 animate-spin" />}
                {packingNote}
              </div>
            </div>

            {notices.length > 0 && <div className="space-y-2 px-4 pt-3 sm:px-6">{notices}</div>}

            {view === "letters" ? (
              <div className="flex-1 overflow-auto px-4 py-5 sm:px-6">
                {templates.length === 0 ? (
                  <EmptyState running={false} />
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                      {templates.map((t) => (
                        <LetterCard
                          key={t.char}
                          template={t}
                          handle={handles.get(t.char) ?? null}
                          copies={copiesFor(t.char)}
                          onCopiesChange={(n) => setCopies(t.char, n)}
                          tooBig={tooBig.has(t.char)}
                          onDownload={() =>
                            run(() =>
                              downloadBlob(
                                meshToStl(templateSolid(t.regions, thickness, handle), t.char),
                                `${t.slug}.stl`,
                                "model/stl",
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                    {Object.keys(settings.overrides).length > 0 && (
                      <button
                        type="button"
                        onClick={() => set("overrides", {})}
                        className="cursor-pointer text-[13px] font-medium text-primary hover:underline"
                      >
                        Reset copies
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : !current ? (
              <div className="flex-1 px-4 py-5 sm:px-6">
                <EmptyState running={stale && items.length > 0} />
              </div>
            ) : (
              <>
                <div className="grid flex-1 items-center gap-7 px-4 py-5 sm:px-6 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="flex h-[min(88vw,560px)] items-center justify-center [container-type:size] lg:h-full lg:min-h-0">
                    {view === "3d" ? (
                      <div className="flex h-full w-full flex-col gap-2">
                        <Suspense
                          fallback={
                            <div className="flex flex-1 items-center justify-center rounded-[14px] bg-muted">
                              <Loader2 className="size-5 animate-spin text-muted-foreground" />
                            </div>
                          }
                        >
                          <Plate3D
                            plate={current}
                            bed={bed}
                            thickness={thickness}
                            handle={handle}
                            className="h-auto min-h-0 flex-1 rounded-[14px] bg-muted sm:h-auto"
                          />
                        </Suspense>
                        <p className="text-xs text-muted-foreground">Drag to orbit, scroll or pinch to zoom.</p>
                      </div>
                    ) : (
                      <div
                        className="overflow-hidden rounded-[14px] shadow-soft"
                        style={{
                          width: `min(100cqw, 100cqh * ${bed.width / bed.depth})`,
                          aspectRatio: `${bed.width} / ${bed.depth}`,
                        }}
                      >
                        <PlatePreview
                          plate={current}
                          bed={bed}
                          margin={settings.margin}
                          handle={handle}
                          keepOut={keepOut}
                          label
                          className={cn("h-full transition-opacity", stale && "opacity-70")}
                        />
                      </div>
                    )}
                  </div>
                  <PlateDetails
                    plate={current}
                    count={plates.length}
                    fontFamily={displayFamily}
                    disabled={stale}
                    on3mf={() => download3mf(current)}
                    onStl={() => downloadStl(current)}
                  />
                </div>
                <nav
                  aria-label="Plates"
                  className="flex shrink-0 items-center gap-3 overflow-x-auto border-t bg-card px-4 pt-3.5 pb-[18px] sm:px-6"
                >
                  {plates.map((p) => (
                    <button
                      key={p.index}
                      type="button"
                      onClick={() => setSelectedPlate(p.index)}
                      aria-current={p.index === selectedPlate}
                      aria-label={`Plate ${p.index + 1}`}
                      className={cn(
                        "flex w-[84px] shrink-0 cursor-pointer flex-col gap-1 rounded-xl border-2 p-[3px] text-left transition-colors",
                        p.index === selectedPlate ? "border-primary" : "border-transparent hover:border-primary/40",
                      )}
                    >
                      <PlatePreview
                        plate={p}
                        bed={bed}
                        margin={settings.margin}
                        handle={handle}
                        keepOut={keepOut}
                        className="rounded-lg"
                      />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {p.index + 1} · {Math.round(p.utilisation * 100)}%
                      </span>
                    </button>
                  ))}
                </nav>
              </>
            )}
          </main>
        </div>

        <footer className="shrink-0 border-t-[1.5px] border-dashed bg-card px-7 pt-3 pb-3.5">
          <div className="flex flex-wrap items-center justify-center gap-x-[22px] gap-y-1 text-center text-xs leading-normal text-muted-foreground">
            <span>
              Made by{" "}
              <a
                href={STUDIO_URL}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-foreground hover:underline"
              >
                Indigo Labs Studio
              </a>
            </span>
            <span>
              Free &amp; open source ·{" "}
              <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className={footerLink}>
                MIT licence
              </a>
            </span>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className={footerLink}>
              Contribute on GitHub
            </a>
            <span>Fonts under the SIL Open Font License</span>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

const iconButton =
  "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border text-foreground transition-colors hover:bg-muted";
const footerLink = "text-primary hover:underline";
const menuItem =
  "flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted";

function Logo() {
  return (
    <div className="relative flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary font-display text-lg text-primary-foreground">
      <div className="absolute inset-[3px] rounded-md border-[1.5px] border-dashed border-primary-foreground opacity-55" />
      a
    </div>
  );
}

function Section({
  id,
  index,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  index: string;
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`section-${id}`}
        onClick={() => onToggle(id)}
        className="flex w-full cursor-pointer items-center gap-3 border-b px-5 py-4 text-left transition-colors hover:bg-muted/50"
      >
        <span className="font-mono text-xs font-medium text-primary">{index}</span>
        <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">{title}</span>
        <span className="ml-auto min-w-0 truncate font-mono text-xs text-muted-foreground">{summary}</span>
      </button>
      {open && (
        <div id={`section-${id}`} className="border-b px-5 pt-4 pb-5">
          {children}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends number | string>({
  label,
  value,
  options,
  format,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  format: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 rounded-lg border bg-card p-0.5 font-mono text-xs"
    >
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn(
            "h-[26px] cursor-pointer rounded-md px-2 transition-colors",
            o === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {format(o)}
        </button>
      ))}
    </div>
  );
}

function PlateDetails({
  plate,
  count,
  fontFamily,
  disabled,
  on3mf,
  onStl,
}: {
  plate: PlateLayout;
  count: number;
  fontFamily: string;
  disabled: boolean;
  on3mf: () => void;
  onStl: () => void;
}) {
  const chars = plate.letters.map((l) => l.template.char).join("");
  const fill = `${Math.round(plate.utilisation * 100)}%`;
  const size = chars.length <= 6 ? "text-[40px]" : chars.length <= 12 ? "text-[30px]" : "text-[22px]";
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs tracking-[.06em] text-muted-foreground uppercase">
          Plate {plate.index + 1} of {count}
        </span>
        <span
          className={cn("leading-[1.05] tracking-[-0.01em] break-all", size)}
          style={{ fontFamily: `"${fontFamily}", var(--font-display)` }}
        >
          {chars}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[13px] text-muted-foreground">
          Bed used<span className="font-mono text-foreground">{fill}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: fill }} />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={on3mf}
          disabled={disabled}
          className="h-[38px] flex-1 cursor-pointer rounded-[10px] bg-foreground text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ↓ 3MF
        </button>
        <button
          type="button"
          onClick={onStl}
          disabled={disabled}
          className="h-[38px] flex-1 cursor-pointer rounded-[10px] border text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          STL
        </button>
      </div>
      <p className="text-xs leading-normal text-pretty text-muted-foreground">
        Every letter is its own object in Bambu Studio, OrcaSlicer or PrusaSlicer.
      </p>
      <p className="text-xs leading-normal text-pretty text-muted-foreground">
        Bambu Studio 2.8.2 may warn that the file has an “invalid config”. That’s expected: click OK and the letters
        load with your own printer and filament settings.
      </p>
    </div>
  );
}

function DownloadMenu({
  current,
  disabled,
  canPrintPaper,
  onAll,
  on3mf,
  onStl,
  onPaper,
}: {
  current: PlateLayout | undefined;
  disabled: boolean;
  canPrintPaper: boolean;
  onAll: () => void;
  on3mf: (p: PlateLayout) => void;
  onStl: (p: PlateLayout) => void;
  onPaper: () => void;
}) {
  const label = current ? `Plate ${current.index + 1}` : "Plate";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-[38px] shrink-0 cursor-pointer items-center gap-2.5 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_0_var(--primary-shade)] transition-transform active:translate-y-px"
        >
          Download <span className="opacity-70">▾</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 flex w-[260px] flex-col rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-soft data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DropdownMenu.Item
            disabled={disabled}
            onSelect={onAll}
            className={cn(menuItem, "flex-col items-start gap-0.5 bg-muted")}
          >
            <span className="font-semibold">Everything (.zip)</span>
            <span className="text-xs text-muted-foreground">3MF + STL per plate, SVG outlines</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={disabled || !current}
            onSelect={() => current && on3mf(current)}
            className={menuItem}
          >
            {label} · 3MF
            <span className="font-mono text-xs text-muted-foreground">Bambu, Orca</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={disabled || !current}
            onSelect={() => current && onStl(current)}
            className={menuItem}
          >
            {label} · STL
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-1.5 my-1 h-px bg-border" />
          <DropdownMenu.Item disabled={!canPrintPaper} onSelect={onPaper} className={menuItem}>
            Print on paper (A4, 1:1)
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function TipsButton() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Tips for printing and sewing"
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[9px] border px-3 text-sm font-medium transition-colors hover:bg-muted max-sm:w-9 max-sm:justify-center max-sm:px-0"
        >
          <span className="flex size-[18px] items-center justify-center rounded-full border-[1.5px] border-current text-[11px] font-bold">
            ?
          </span>
          <span className="max-sm:hidden">Tips</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 flex w-[min(400px,calc(100vw-32px))] flex-col gap-3.5 rounded-[14px] border bg-popover p-5 text-popover-foreground shadow-soft data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center justify-between">
            <span className="text-base font-bold">Tips for printing and sewing</span>
            <Popover.Close
              aria-label="Close"
              className="cursor-pointer rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </Popover.Close>
          </div>
          {TIPS.map((t) => (
            <p key={t.title} className="text-[13px] leading-normal text-pretty text-muted-foreground">
              <b className="text-foreground">{t.title}</b> {t.body}
            </p>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "info" | "warning" | "error";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-[10px] border px-3 py-2 text-[13px] leading-normal",
        tone === "info" && "bg-card text-muted-foreground",
        tone === "warning" && "border-ochre/60 bg-ochre/15",
        tone === "error" && "border-destructive/40 bg-destructive/10",
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0",
          tone === "warning" && "text-ochre-foreground dark:text-ochre",
          tone === "error" && "text-destructive",
        )}
      >
        {icon ?? <TriangleAlert className="size-4" />}
      </span>
      <span>{children}</span>
    </div>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function EmptyState({ running }: { running: boolean }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed text-sm text-muted-foreground">
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
