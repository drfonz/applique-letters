import ClipperLib from "clipper-lib";
import type { Font, PathCommand } from "opentype.js";

/** A 2D point in millimetres. */
export type Vec2 = [number, number];

/** A solid region: one outer ring (counter-clockwise) and zero or more holes (clockwise). */
export interface Region {
  outer: Vec2[];
  holes: Vec2[][];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Clipper works in integers, so we scale millimetres up to micrometres. */
const CLIPPER_SCALE = 1000;
/** Pieces smaller than this (mm²) are treated as noise and dropped. */
const MIN_REGION_AREA = 1;

export function signedArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

export function regionArea(region: Region): number {
  return Math.abs(signedArea(region.outer)) - region.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
}

export function boundsOf(regions: Region[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of regions) {
    for (const [x, y] of r.outer) {
      if (x < b.minX) b.minX = x;
      if (y < b.minY) b.minY = y;
      if (x > b.maxX) b.maxX = x;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

export function transformRegions(regions: Region[], fn: (p: Vec2) => Vec2): Region[] {
  const map = (ring: Vec2[]) => ring.map(fn);
  return regions.map((r) => ({ outer: map(r.outer), holes: r.holes.map(map) }));
}

/** Mirror left-to-right about x = 0, keeping ring orientation correct. */
export function mirrorRegions(regions: Region[]): Region[] {
  return regions.map((r) => ({
    outer: r.outer.map(([x, y]): Vec2 => [-x, y]).reverse(),
    holes: r.holes.map((h) => h.map(([x, y]): Vec2 => [-x, y]).reverse()),
  }));
}

/** Move regions so their bounding box starts at the origin. */
export function normaliseRegions(regions: Region[]): Region[] {
  const b = boundsOf(regions);
  return transformRegions(regions, ([x, y]) => [x - b.minX, y - b.minY]);
}

/**
 * Flatten a path made of line, quadratic and cubic segments into closed polygons.
 * Coordinates are multiplied by `scale` and the y axis is flipped so y points up.
 */
export function flattenCommands(commands: PathCommand[], scale: number, toleranceMm = 0.2): Vec2[][] {
  const rings: Vec2[][] = [];
  let ring: Vec2[] = [];
  let cx = 0;
  let cy = 0;
  const push = (x: number, y: number) => ring.push([x * scale, -y * scale]);
  const steps = (len: number) => Math.min(64, Math.max(2, Math.ceil((len * scale) / toleranceMm / 4)));
  const close = () => {
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };

  for (const c of commands) {
    switch (c.type) {
      case "M":
        close();
        cx = c.x;
        cy = c.y;
        push(cx, cy);
        break;
      case "L":
        cx = c.x;
        cy = c.y;
        push(cx, cy);
        break;
      case "Q": {
        const n = steps(Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x - c.x1, c.y - c.y1));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push(u * u * cx + 2 * u * t * c.x1 + t * t * c.x, u * u * cy + 2 * u * t * c.y1 + t * t * c.y);
        }
        cx = c.x;
        cy = c.y;
        break;
      }
      case "C": {
        const n = steps(
          Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2),
        );
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push(
            u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
          );
        }
        cx = c.x;
        cy = c.y;
        break;
      }
      case "Z":
        close();
        break;
    }
  }
  close();
  return rings;
}

type IntPath = ClipperLib.IntPoint[];

function toClipper(rings: Vec2[][]): IntPath[] {
  return rings.map((ring) => ring.map(([x, y]) => ({ X: Math.round(x * CLIPPER_SCALE), Y: Math.round(y * CLIPPER_SCALE) })));
}

function fromClipper(path: IntPath): Vec2[] {
  return path.map((p) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE]);
}

/** Walk a Clipper PolyTree and turn it into outer/hole regions with consistent orientation. */
function treeToRegions(tree: ClipperLib.PolyTree): Region[] {
  const regions: Region[] = [];
  const visit = (node: ClipperLib.PolyNode) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) continue;
      const outer = fromClipper(child.Contour());
      if (signedArea(outer) < 0) outer.reverse();
      const holes: Vec2[][] = [];
      for (const h of child.Childs()) {
        const hole = fromClipper(h.Contour());
        if (signedArea(hole) > 0) hole.reverse();
        if (Math.abs(signedArea(hole)) >= MIN_REGION_AREA / 4) holes.push(hole);
        // Islands inside holes become regions of their own.
        visit(h);
      }
      const region = { outer, holes };
      if (regionArea(region) >= MIN_REGION_AREA) regions.push(region);
    }
  };
  visit(tree);
  return regions;
}

/**
 * Merge overlapping contours (non-zero fill, as fonts expect), optionally grow or shrink the
 * outline by `offsetMm`, and return clean regions ready for extrusion.
 */
export function cleanAndOffset(rings: Vec2[][], offsetMm = 0): Region[] {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(toClipper(rings), ClipperLib.PolyType.ptSubject, true);
  const union: IntPath[] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    union,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );

  const tree = new ClipperLib.PolyTree();
  if (Math.abs(offsetMm) < 1e-6) {
    const c2 = new ClipperLib.Clipper();
    c2.AddPaths(union, ClipperLib.PolyType.ptSubject, true);
    c2.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  } else {
    // ArcTolerance controls how finely round corners are approximated.
    const offset = new ClipperLib.ClipperOffset(2, 0.05 * CLIPPER_SCALE);
    offset.AddPaths(union, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    offset.Execute(tree, offsetMm * CLIPPER_SCALE);
  }
  return treeToRegions(tree);
}

/** Height (font units) that "letter height" is measured against: the capital height. */
export function capHeightUnits(font: Font): number {
  const fromTable = font.tables.os2?.sCapHeight;
  if (fromTable && fromTable > 0) return fromTable;
  const h = font.charToGlyph("H");
  const rings = flattenCommands(h.getPath(0, 0, font.unitsPerEm).commands, 1);
  let maxY = 0;
  for (const r of rings) for (const [, y] of r) maxY = Math.max(maxY, y);
  return maxY > 0 ? maxY : font.unitsPerEm * 0.7;
}

export function fontHasGlyph(font: Font, char: string): boolean {
  const g = font.charToGlyph(char);
  return g.index !== 0;
}

/** Outline of a single character, scaled so capital letters are `capHeightMm` tall. */
export function glyphRings(font: Font, char: string, capHeightMm: number): Vec2[][] {
  const scale = capHeightMm / capHeightUnits(font);
  const path = font.charToGlyph(char).getPath(0, 0, font.unitsPerEm);
  return flattenCommands(path.commands, scale);
}

/** Built-in decorative shapes, handy for banners (hearts between words, stars…). */
export const SYMBOLS: Record<string, { label: string; rings: (size: number) => Vec2[][] }> = {
  "♥": {
    label: "Heart",
    rings: (size) => {
      const pts: Vec2[] = [];
      const n = 160;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([x, y]);
      }
      // The parametric heart spans roughly y ∈ [-17, 12]; scale it to the requested height.
      const s = size / 29;
      return [pts.map(([x, y]): Vec2 => [x * s, (y + 17) * s]).reverse()];
    },
  },
  "★": {
    label: "Star",
    rings: (size) => {
      const pts: Vec2[] = [];
      const outer = size / (1 + Math.cos(Math.PI / 5));
      const inner = outer * 0.45;
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? outer : inner;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return [pts];
    },
  },
  "●": {
    label: "Circle",
    rings: (size) => {
      const pts: Vec2[] = [];
      for (let i = 0; i < 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push([(size / 2) * Math.cos(a), (size / 2) * Math.sin(a)]);
      }
      return [pts];
    },
  },
};
