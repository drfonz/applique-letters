import { cleanAndOffset, regionArea, regionRings, type Region } from "./geometry";

/**
 * Filament estimates that follow what a slicer actually prints, rather than a solid block.
 *
 * With the usual 0.20 mm profiles (Bambu Studio, OrcaSlicer and PrusaSlicer are all close)
 * the bottom 3 and top 5 layers are solid. Any layers between them get two walls round every
 * edge and sparse infill inside. Thin templates are all shell, so they print solid; thicker
 * ones are mostly walls and infill.
 */
export const PLA_DENSITY = 1.24; // g/cm³
const SHELL_LAYERS = 3 + 5;
/** Two wall lines of about 0.42 mm. */
const WALL_WIDTH = 0.84;
const INFILL = 0.15;

export interface PrintSettings {
  thickness: number;
  layerHeight: number;
}

/** Printed volume (mm³) of a flat body `thickness` tall. */
export function printedVolume(body: Region[], { thickness, layerHeight }: PrintSettings): number {
  const area = body.reduce((s, r) => s + regionArea(r), 0);
  const shell = Math.min(thickness, SHELL_LAYERS * layerHeight);
  const middle = thickness - shell;
  if (middle <= 1e-6) return area * thickness;
  // What is left once the walls are in: that is the part that gets sparse infill.
  const core = cleanAndOffset(regionRings(body), -WALL_WIDTH).reduce((s, r) => s + regionArea(r), 0);
  return area * shell + (area - core) * middle + core * middle * INFILL;
}

export function grams(volumeMm3: number): number {
  return (volumeMm3 * PLA_DENSITY) / 1000;
}

export function formatGrams(g: number): string {
  return `${g < 10 ? g.toFixed(1) : Math.round(g)} g`;
}

/** A grip handle is a column: walls round the outside and sparse infill in the middle. */
export function printedHandleVolume(solidVolume: number, radius: number): number {
  const core = (Math.max(0, radius - WALL_WIDTH) / radius) ** 2;
  return solidVolume * (1 - core * (1 - INFILL));
}
