import opentype, { type Font } from "opentype.js";

import fredoka from "@fontfiles/fredoka/files/fredoka-latin-700-normal.woff?url";
import luckiestGuy from "@fontfiles/luckiest-guy/files/luckiest-guy-latin-400-normal.woff?url";
import titanOne from "@fontfiles/titan-one/files/titan-one-latin-400-normal.woff?url";
import lilitaOne from "@fontfiles/lilita-one/files/lilita-one-latin-400-normal.woff?url";
import chewy from "@fontfiles/chewy/files/chewy-latin-400-normal.woff?url";
import sniglet from "@fontfiles/sniglet/files/sniglet-latin-800-normal.woff?url";
import baloo2 from "@fontfiles/baloo-2/files/baloo-2-latin-800-normal.woff?url";
import rubik from "@fontfiles/rubik/files/rubik-latin-800-normal.woff?url";
import poppins from "@fontfiles/poppins/files/poppins-latin-800-normal.woff?url";
import archivoBlack from "@fontfiles/archivo-black/files/archivo-black-latin-400-normal.woff?url";
import anton from "@fontfiles/anton/files/anton-latin-400-normal.woff?url";
import bebasNeue from "@fontfiles/bebas-neue/files/bebas-neue-latin-400-normal.woff?url";
import passionOne from "@fontfiles/passion-one/files/passion-one-latin-700-normal.woff?url";
import bungee from "@fontfiles/bungee/files/bungee-latin-400-normal.woff?url";
import righteous from "@fontfiles/righteous/files/righteous-latin-400-normal.woff?url";
import alfaSlabOne from "@fontfiles/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff?url";
import abrilFatface from "@fontfiles/abril-fatface/files/abril-fatface-latin-400-normal.woff?url";
import shrikhand from "@fontfiles/shrikhand/files/shrikhand-latin-400-normal.woff?url";
import lobster from "@fontfiles/lobster/files/lobster-latin-400-normal.woff?url";
import pacifico from "@fontfiles/pacifico/files/pacifico-latin-400-normal.woff?url";

export type FontCategory = "Rounded" | "Bold sans" | "Condensed" | "Slab & serif" | "Script";

export interface FontChoice {
  /** Unique key, e.g. "bundled:fredoka", "google:rubik:900" or "upload:My Font". */
  key: string;
  family: string;
  weight: number;
  source: "bundled" | "google" | "upload";
  category?: FontCategory | string;
  note?: string;
  url?: string;
  /** Alternative URL to try if the first one fails. */
  fallbackUrl?: string;
  buffer?: ArrayBuffer;
}

const bundled = (
  id: string,
  family: string,
  weight: number,
  url: string,
  category: FontCategory,
  note?: string,
): FontChoice => ({ key: `bundled:${id}`, family, weight, source: "bundled", category, url, note });

/**
 * A hand-picked set of Google Fonts that make good appliqué letters: thick strokes with no
 * spindly bits, so they are easy to trace, cut out and stitch round. They ship with the app,
 * so they work offline too.
 */
export const BUNDLED_FONTS: FontChoice[] = [
  bundled("fredoka", "Fredoka", 700, fredoka, "Rounded", "Soft and friendly; a great all-rounder"),
  bundled("luckiest-guy", "Luckiest Guy", 400, luckiestGuy, "Rounded", "Playful, great for children's banners"),
  bundled("titan-one", "Titan One", 400, titanOne, "Rounded", "Very chunky and easy to sew"),
  bundled("lilita-one", "Lilita One", 400, lilitaOne, "Rounded"),
  bundled("chewy", "Chewy", 400, chewy, "Rounded", "Bouncy, hand-made feel"),
  bundled("sniglet", "Sniglet", 800, sniglet, "Rounded"),
  bundled("baloo-2", "Baloo 2", 800, baloo2, "Rounded"),
  bundled("rubik", "Rubik", 800, rubik, "Bold sans"),
  bundled("poppins", "Poppins", 800, poppins, "Bold sans"),
  bundled("archivo-black", "Archivo Black", 400, archivoBlack, "Bold sans"),
  bundled("passion-one", "Passion One", 700, passionOne, "Bold sans"),
  bundled("righteous", "Righteous", 400, righteous, "Bold sans", "Retro, art-deco touch"),
  bundled("bungee", "Bungee", 400, bungee, "Bold sans", "Blocky signage letters"),
  bundled("anton", "Anton", 400, anton, "Condensed", "Tall and narrow; fits long words"),
  bundled("bebas-neue", "Bebas Neue", 400, bebasNeue, "Condensed", "Capitals only"),
  bundled("alfa-slab-one", "Alfa Slab One", 400, alfaSlabOne, "Slab & serif"),
  bundled("abril-fatface", "Abril Fatface", 400, abrilFatface, "Slab & serif", "Elegant, but has thin hairlines"),
  bundled("shrikhand", "Shrikhand", 400, shrikhand, "Script", "Bold vintage script"),
  bundled("lobster", "Lobster", 400, lobster, "Script"),
  bundled("pacifico", "Pacifico", 400, pacifico, "Script", "Surf-style script"),
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

const parsed = new Map<string, Promise<Font>>();
const faces = new Set<string>();

async function fetchBuffer(choice: FontChoice): Promise<ArrayBuffer> {
  if (choice.buffer) return choice.buffer;
  const urls = [choice.url, choice.fallbackUrl].filter(Boolean) as string[];
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

/** CSS font-family name used to preview a choice in the UI. */
export function cssFamily(choice: FontChoice): string {
  return `al-${choice.key.replace(/[^a-z0-9]+/gi, "-")}`;
}

/** Register a FontFace so the font name can be previewed in its own typeface. */
export function registerPreviewFace(choice: FontChoice) {
  if (faces.has(choice.key) || typeof document === "undefined") return;
  faces.add(choice.key);
  const source = choice.buffer ?? `url(${JSON.stringify(choice.url)})`;
  const face = new FontFace(cssFamily(choice), source as string | ArrayBuffer, { weight: "100 900" });
  document.fonts.add(face);
  face.load().catch(() => faces.delete(choice.key));
}

export function loadFont(choice: FontChoice): Promise<Font> {
  let p = parsed.get(choice.key);
  if (!p) {
    p = fetchBuffer(choice).then((buf) => {
      try {
        return opentype.parse(buf);
      } catch (e) {
        throw new Error(
          `${choice.family} could not be read. TTF, OTF and WOFF files work; WOFF2 does not. (${e instanceof Error ? e.message : e})`,
        );
      }
    });
    p.catch(() => parsed.delete(choice.key));
    parsed.set(choice.key, p);
  }
  return p;
}

export async function uploadedFontChoice(file: File): Promise<FontChoice> {
  const buffer = await file.arrayBuffer();
  const font = opentype.parse(buffer);
  const family = font.names.fontFamily?.en ?? font.names.fullName?.en ?? file.name.replace(/\.[^.]+$/, "");
  return { key: `upload:${file.name}:${file.size}`, family, weight: 400, source: "upload", buffer };
}
