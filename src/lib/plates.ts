import { boundsOf, type Region } from "./geometry";
import { placedRegions, type NestPlacement, type NestResult } from "./nest";
import type { LetterTemplate } from "./templates";

export interface PlacedLetter {
  template: LetterTemplate;
  copy: number;
  rotation: number;
  /** Outline in bed coordinates (mm, origin front-left). */
  regions: Region[];
}

export interface PlateLayout {
  index: number;
  letters: PlacedLetter[];
  utilisation: number;
}

/**
 * Turn nesting output into per-plate outlines. Plates are centred on the bed as slicers expect,
 * unless areas were kept clear, since moving the letters could push them into those areas.
 */
export function buildPlates(
  templates: LetterTemplate[],
  result: NestResult,
  bed: { width: number; depth: number },
  centre = true,
): PlateLayout[] {
  const plates: PlateLayout[] = Array.from({ length: result.plateCount }, (_, index) => ({
    index,
    letters: [],
    utilisation: result.utilisation[index] ?? 0,
  }));
  const byPlate = new Map<number, NestPlacement[]>();
  for (const p of result.placements) {
    if (!templates[p.shape]) continue;
    byPlate.set(p.plate, [...(byPlate.get(p.plate) ?? []), p]);
  }
  for (const [index, placements] of byPlate) {
    const letters = placements.map((p) => ({
      template: templates[p.shape],
      copy: p.copy,
      rotation: p.rotation * 90,
      regions: placedRegions(templates[p.shape].regions, p),
    }));
    if (centre) {
      const b = boundsOf(letters.flatMap((l) => l.regions));
      const dx = (bed.width - (b.maxX - b.minX)) / 2 - b.minX;
      const dy = (bed.depth - (b.maxY - b.minY)) / 2 - b.minY;
      for (const l of letters) {
        l.regions = l.regions.map((r) => ({
          outer: r.outer.map(([x, y]) => [x + dx, y + dy]),
          holes: r.holes.map((h) => h.map(([x, y]) => [x + dx, y + dy])),
        }));
      }
    }
    // Reading order: back row first, left to right.
    letters.sort((a, b) => {
      const ba = boundsOf(a.regions);
      const bb = boundsOf(b.regions);
      return Math.round((bb.maxY - ba.maxY) / 20) || ba.minX - bb.minX;
    });
    if (plates[index]) plates[index].letters = letters;
  }
  return plates;
}
