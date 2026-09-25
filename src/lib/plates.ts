import { boundsOf, type Region, type Vec2 } from "./geometry";
import { placedRegions, type NestPlacement, type NestResult } from "./nest";
import type { LetterTemplate } from "./templates";

export interface PlacedLetter {
  template: LetterTemplate;
  copy: number;
  rotation: number;
  /** Quarter turns applied to the template outline before `offset`. */
  turns: 0 | 1 | 2 | 3;
  /** Translation (mm) from the rotated template to the bed. */
  offset: Vec2;
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
    const letters: PlacedLetter[] = placements.map((p) => ({
      template: templates[p.shape],
      copy: p.copy,
      rotation: p.rotation * 90,
      turns: p.rotation,
      offset: [p.x, p.y],
      regions: placedRegions(templates[p.shape].regions, p),
    }));
    if (centre) {
      const b = boundsOf(letters.flatMap((l) => l.regions));
      const dx = (bed.width - (b.maxX - b.minX)) / 2 - b.minX;
      const dy = (bed.depth - (b.maxY - b.minY)) / 2 - b.minY;
      for (const l of letters) {
        l.offset = [l.offset[0] + dx, l.offset[1] + dy];
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

/**
 * Turn a point on a template outline by quarter turns the same way the outline is turned
 * (anticlockwise, then moved back so its bounding box starts at the origin).
 */
function turnPoint([x, y]: Vec2, width: number, height: number, turns: number): Vec2 {
  let w = width;
  let h = height;
  for (let k = 0; k < turns; k++) {
    [x, y] = [h - y, x];
    [w, h] = [h, w];
  }
  return [x, y];
}

/** A point on the letter's template, in bed coordinates. */
export function templateToBed(letter: PlacedLetter, p: Vec2): Vec2 {
  const [x, y] = turnPoint(p, letter.template.width, letter.template.height, letter.turns);
  return [x + letter.offset[0], y + letter.offset[1]];
}

/** A bed point, in the coordinates of the letter's template. */
export function bedToTemplate(letter: PlacedLetter, [x, y]: Vec2): Vec2 {
  const turned =
    letter.turns % 2
      ? [letter.template.height, letter.template.width]
      : [letter.template.width, letter.template.height];
  // Four turns bring the outline back to where it started, so undo k turns with 4 - k more.
  return turnPoint([x - letter.offset[0], y - letter.offset[1]], turned[0], turned[1], (4 - letter.turns) % 4);
}
