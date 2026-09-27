import opentype from "opentype.js";
import type { Font } from "./font-types.js";

export type FontCategory = "Rounded" | "Bold sans" | "Condensed" | "Slab & serif" | "Script";

export interface FontChoice {
  /** Unique key, e.g. "bundled:fredoka", "google:rubik:900" or "upload:My Font". */
  key: string;
  family: string;
  weight: number;
  source: "bundled" | "google" | "upload";
  category?: FontCategory | string;
  note?: string;
  /**
   * Where a bundled font lives in its @fontsource package: `@fontsource/<id>/files/<file>`.
   * Browsers turn this into a URL at build time; Node reads the file from node_modules.
   */
  fontsource?: { id: string; file: string };
  url?: string;
  /** Alternative URL to try if the first one fails. */
  fallbackUrl?: string;
  buffer?: ArrayBuffer;
}

const bundled = (id: string, family: string, weight: number, category: FontCategory, note?: string): FontChoice => ({
  key: `bundled:${id}`,
  family,
  weight,
  source: "bundled",
  category,
  note,
  fontsource: { id, file: `${id}-latin-${weight}-normal.woff` },
});

/**
 * A hand-picked set of Google Fonts that make good appliqué letters: thick strokes with no
 * spindly bits, so they are easy to trace, cut out and stitch round. Apps ship the files
 * from the matching @fontsource packages, so they work offline too.
 */
export const BUNDLED_FONTS: FontChoice[] = [
  bundled("fredoka", "Fredoka", 700, "Rounded", "Soft and friendly; a great all-rounder"),
  bundled("luckiest-guy", "Luckiest Guy", 400, "Rounded", "Playful, great for children's banners"),
  bundled("titan-one", "Titan One", 400, "Rounded", "Very chunky and easy to sew"),
  bundled("lilita-one", "Lilita One", 400, "Rounded"),
  bundled("chewy", "Chewy", 400, "Rounded", "Bouncy, hand-made feel"),
  bundled("sniglet", "Sniglet", 800, "Rounded"),
  bundled("baloo-2", "Baloo 2", 800, "Rounded"),
  bundled("rubik", "Rubik", 800, "Bold sans"),
  bundled("poppins", "Poppins", 800, "Bold sans"),
  bundled("archivo-black", "Archivo Black", 400, "Bold sans"),
  bundled("passion-one", "Passion One", 700, "Bold sans"),
  bundled("righteous", "Righteous", 400, "Bold sans", "Retro, art-deco touch"),
  bundled("bungee", "Bungee", 400, "Bold sans", "Blocky signage letters"),
  bundled("anton", "Anton", 400, "Condensed", "Tall and narrow; fits long words"),
  bundled("bebas-neue", "Bebas Neue", 400, "Condensed", "Capitals only"),
  bundled("alfa-slab-one", "Alfa Slab One", 400, "Slab & serif"),
  bundled("abril-fatface", "Abril Fatface", 400, "Slab & serif", "Elegant, but has thin hairlines"),
  bundled("shrikhand", "Shrikhand", 400, "Script", "Bold vintage script"),
  bundled("lobster", "Lobster", 400, "Script"),
  bundled("pacifico", "Pacifico", 400, "Script", "Surf-style script"),
];

/** Entry in the Fontsource catalogue, which mirrors every Google Font as downloadable files. */
export interface CatalogueFont {
  id: string;
  family: string;
  category: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  defSubset: string;
  type: string;
}

let cataloguePromise: Promise<CatalogueFont[]> | null = null;

export function loadGoogleCatalogue(): Promise<CatalogueFont[]> {
  cataloguePromise ??= fetch("https://api.fontsource.org/v1/fonts")
    .then((r) => {
      if (!r.ok) throw new Error(`Font catalogue request failed (${r.status})`);
      return r.json() as Promise<CatalogueFont[]>;
    })
    .then((list) =>
      list
        .filter((f) => f.type === "google" && f.styles.includes("normal"))
        .sort((a, b) => a.family.localeCompare(b.family)),
    )
    .catch((e) => {
      cataloguePromise = null;
      throw e;
    });
  return cataloguePromise;
}

export function googleFontChoice(font: CatalogueFont, weight: number): FontChoice {
  const subset = font.subsets.includes("latin") ? "latin" : font.defSubset;
  return {
    key: `google:${font.id}:${weight}`,
    family: font.family,
    weight,
    source: "google",
    category: font.category,
    url: `https://cdn.jsdelivr.net/fontsource/fonts/${font.id}@latest/${subset}-${weight}-normal.woff`,
    fallbackUrl: `https://cdn.jsdelivr.net/npm/@fontsource/${font.id}/files/${font.id}-${subset}-${weight}-normal.woff`,
  };
}

/** Heaviest weight up to 900: thick strokes make sturdier templates. */
export function defaultWeight(weights: number[]): number {
  const usable = weights.filter((w) => w <= 900);
  return usable.length ? Math.max(...usable) : weights[weights.length - 1];
}

/** Parse a TTF, OTF or WOFF file. */
export function parseFont(buffer: ArrayBuffer, family = "The font"): Font {
  try {
    return opentype.parse(buffer);
  } catch (e) {
    throw new Error(
      `${family} could not be read. TTF, OTF and WOFF files work; WOFF2 does not. (${e instanceof Error ? e.message : e})`,
    );
  }
}

/** The family name a font file gives itself, if any. */
export function fontFamilyName(font: Font): string | undefined {
  return font.names.fontFamily?.en ?? font.names.fullName?.en;
}

async function fetchBuffer(choice: FontChoice): Promise<ArrayBuffer> {
  if (choice.buffer) return choice.buffer;
  const urls = [choice.url, choice.fallbackUrl].filter(Boolean) as string[];
  if (urls.length === 0) throw new Error(`No file to load for ${choice.family}`);
  let lastError: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.arrayBuffer();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Could not download ${choice.family}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

const parsed = new Map<string, Promise<Font>>();

/** Download (or take the uploaded buffer of) a font and parse it, once per key. */
export function loadFont(choice: FontChoice): Promise<Font> {
  let p = parsed.get(choice.key);
  if (!p) {
    p = fetchBuffer(choice).then((buf) => parseFont(buf, choice.family));
    p.catch(() => parsed.delete(choice.key));
    parsed.set(choice.key, p);
  }
  return p;
}
