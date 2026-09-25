import type { Font } from "opentype.js";
import {
  SYMBOLS,
  boundsOf,
  cleanAndOffset,
  fontHasGlyph,
  glyphRings,
  mirrorRegions,
  normaliseRegions,
  regionArea,
  transformRegions,
  type Region,
} from "./geometry";
import { extrudeRegions, type Mesh } from "./mesh";

export interface TemplateSettings {
  /** Height of capital letters in millimetres. */
  letterHeight: number;
  /** Grow (positive) or shrink (negative) the outline, e.g. to add a turn-under allowance. */
  outlineOffset: number;
  layers: number;
  layerHeight: number;
  /** Reverse the letters, for tracing onto the paper side of fusible web. */
  mirror: boolean;
}

export interface LetterTemplate {
  /** Stable identity: the character. */
  char: string;
  /** File-system friendly name. */
  slug: string;
  /** Outline in mm, with the bounding box starting at the origin. */
  regions: Region[];
  width: number;
  height: number;
  /** Number of separate pieces (e.g. "i" has two: the stem and the dot). */
  pieces: number;
  /** Area in mm², used for filament estimates. */
  area: number;
}

export interface TemplateResult {
  templates: LetterTemplate[];
  /** Characters the chosen font cannot draw. */
  missing: string[];
}

const NAMED: Record<string, string> = {
  "&": "ampersand",
  "!": "exclamation",
  "?": "question",
  ".": "full-stop",
  ",": "comma",
  "'": "apostrophe",
  "’": "apostrophe",
  "-": "hyphen",
  "+": "plus",
  "#": "hash",
  "@": "at",
  "£": "pound",
  "$": "dollar",
  "€": "euro",
  "%": "percent",
  ":": "colon",
  ";": "semicolon",
  "/": "slash",
  "(": "paren-open",
  ")": "paren-close",
  "♥": "heart",
  "★": "star",
  "●": "circle",
};

/** Case-insensitive file systems would merge "A.stl" and "a.stl", so lower case gets a suffix. */
export function slugFor(char: string): string {
  if (/^[A-Z0-9]$/.test(char)) return char;
  if (/^[a-z]$/.test(char)) return `${char}-lower`;
  if (/^\p{L}$/u.test(char)) return char.toLocaleUpperCase() === char ? char : `${char}-lower`;
  return NAMED[char] ?? `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Characters in the order they first appear, with how often each one is used. */
export function countCharacters(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of Array.from(text.normalize("NFC"))) {
    if (/\s/.test(ch)) continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return counts;
}

/** Build one template per character (duplicates are ignored). */
export function buildTemplates(font: Font, chars: string[], settings: TemplateSettings): TemplateResult {
  const templates: LetterTemplate[] = [];
  const missing: string[] = [];

  for (const char of new Set(chars)) {
    const symbol = SYMBOLS[char];
    if (!symbol && !fontHasGlyph(font, char)) {
      missing.push(char);
      continue;
    }
    const rings = symbol ? symbol.rings(settings.letterHeight) : glyphRings(font, char, settings.letterHeight);
    let regions = cleanAndOffset(rings, settings.outlineOffset);
    if (regions.length === 0) continue; // e.g. punctuation that vanishes when shrunk
    if (settings.mirror) regions = mirrorRegions(regions);
    regions = normaliseRegions(regions);
    const b = boundsOf(regions);
    templates.push({
      char,
      slug: slugFor(char),
      regions,
      width: b.maxX,
      height: b.maxY,
      pieces: regions.length,
      area: regions.reduce((s, r) => s + regionArea(r), 0),
    });
  }
  return { templates, missing };
}

export function thicknessOf(settings: Pick<TemplateSettings, "layers" | "layerHeight">): number {
  return Math.round(settings.layers * settings.layerHeight * 1000) / 1000;
}

/** Rotate a quarter turn anticlockwise and move back to the origin. */
export function rotateQuarter(regions: Region[]): Region[] {
  return normaliseRegions(transformRegions(regions, ([x, y]) => [-y, x]));
}

export function templateMesh(regions: Region[], thickness: number, offset: [number, number] = [0, 0]): Mesh {
  return extrudeRegions(regions, thickness, offset);
}
