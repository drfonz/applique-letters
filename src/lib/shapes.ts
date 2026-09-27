import type { PathCommand } from "opentype.js";
import {
  boundsOf,
  differenceRegions,
  flattenCommands,
  regionRings,
  signedArea,
  unionRegions,
  type Vec2,
} from "./geometry";

/**
 * Built-in decorative shapes, keyed by the character that stands for them in banner text.
 * Seasonal shapes use their emoji, so typing 🎃 on a phone keyboard gives a pumpkin.
 *
 * Shapes are drawn in "design units" with y pointing down (as in SVG), roughly 100 units
 * tall, then scaled so they stand as tall as a capital letter (times `heightRatio`).
 */
export type ShapeGroup = "basic" | "halloween" | "christmas";

export interface Shape {
  label: string;
  group: ShapeGroup;
  /** Height relative to a capital letter; wide shapes are shorter so they don't dwarf the text. */
  heightRatio?: number;
  /** Outline in design units: outers and holes, wound opposite ways. */
  draw: () => Vec2[][];
}

export const SHAPE_GROUPS: { id: ShapeGroup; label: string }[] = [
  { id: "basic", label: "Shapes" },
  { id: "halloween", label: "Halloween" },
  { id: "christmas", label: "Christmas" },
];

/** Wind every primitive the same way so non-zero unions never cancel out. */
function wound(ring: Vec2[]): Vec2[] {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, angleDeg = 0, n = 96): Vec2[] {
  const a = (angleDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  return wound(
    Array.from({ length: n }, (_, i): Vec2 => {
      const t = (i / n) * Math.PI * 2;
      const [x, y] = [rx * Math.cos(t), ry * Math.sin(t)];
      return [cx + x * cos - y * sin, cy + x * sin + y * cos];
    }),
  );
}

const circle = (cx: number, cy: number, r: number) => ellipse(cx, cy, r, r);

function polygon(...pts: Vec2[]): Vec2[] {
  return wound(pts);
}

function star(cx: number, cy: number, outer: number, inner: number): Vec2[] {
  return polygon(
    ...Array.from({ length: 10 }, (_, i): Vec2 => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? outer : inner;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
  );
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): Vec2[] {
  const pts: Vec2[] = [];
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -90],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
    [x + r, y + r, 180],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = ((start + (i / 8) * 90) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return wound(pts);
}

/** A tiny SVG path reader: absolute M, L, Q, C and Z only, which is all the shapes below use. */
function path(d: string): Vec2[][] {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+/g) ?? [];
  const commands: PathCommand[] = [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const type = tokens[i++];
    if (type === "M" || type === "L") commands.push({ type, x: num(), y: num() });
    else if (type === "Q") commands.push({ type, x1: num(), y1: num(), x: num(), y: num() });
    else if (type === "C") commands.push({ type, x1: num(), y1: num(), x2: num(), y2: num(), x: num(), y: num() });
    else if (type === "Z") commands.push({ type });
    else throw new Error(`Unsupported path command "${type}"`);
  }
  // flattenCommands flips y for fonts; flip it back so we stay in SVG-style coordinates.
  return flattenCommands(commands, 1).map((ring) => wound(ring.map(([x, y]): Vec2 => [x, -y])));
}

/** Everything in `add`, less everything in `cut`. */
function minus(add: Vec2[][], cut: Vec2[][]): Vec2[][] {
  return regionRings(differenceRegions(add, cut));
}

function union(...parts: Vec2[][]): Vec2[][] {
  return regionRings(unionRegions(parts, []));
}

/** The mirror image of a ring about x = 50, the centre line of every shape. */
function mirrored(ring: Vec2[]): Vec2[] {
  return wound(ring.map(([x, y]): Vec2 => [100 - x, y]));
}

function heart(): Vec2[][] {
  const pts = Array.from({ length: 160 }, (_, i): Vec2 => {
    const t = (i / 160) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [x, -y];
  });
  return [wound(pts)];
}

function ghost(): Vec2[][] {
  // Domed head, straight sides and a hem of four rounded scallops.
  const body = path(
    "M 12 86 L 12 44 C 12 18 30 4 50 4 C 70 4 88 18 88 44 L 88 86 " +
      "C 88 100 69 100 69 86 C 69 100 50 100 50 86 C 50 100 31 100 31 86 C 31 100 12 100 12 86 Z",
  );
  const face = [ellipse(37, 42, 5.5, 7.5), ellipse(63, 42, 5.5, 7.5), ellipse(50, 61, 4.5, 5.5)];
  return minus(body, face);
}

function pumpkin(): Vec2[][] {
  const body = [ellipse(31, 62, 25, 31), ellipse(69, 62, 25, 31), ellipse(50, 61, 22, 33)];
  const stem = path("M 45 34 L 45.5 16 Q 46 8 53 7 L 60 6 Q 62 11 57 13 Q 54 14 54 18 L 55 34 Z");
  // Eyes slant inwards; level bases would also sit on one line, which trips up the triangulation.
  const eye = polygon([26, 53], [42, 57], [35, 43]);
  const eyes = [eye, mirrored(eye)];
  const nose = polygon([45.5, 66], [54.5, 66], [50, 59]);
  // A grin, with two teeth that meet the upper lip.
  const grin = path("M 24 70 Q 50 82 76 70 Q 50 102 24 70 Z");
  const teeth = [roundedRect(36, 66, 8, 11, 1), roundedRect(56, 66, 8, 11, 1)];
  return minus(union(...body, ...stem), [...eyes, nose, ...minus(grin, teeth)]);
}

function bat(): Vec2[][] {
  // Leading edge sweeps up to the wing tip; the trailing edge has three scallops back to the body.
  const wing = path("M 53 40 C 62 29 80 19 98 20 Q 87 30 87 45 Q 78 37 72 50 Q 63 44 57 59 L 53 58 Z")[0];
  const ear = polygon([43, 32], [44, 18], [50, 28]);
  return union(ellipse(50, 49, 7.5, 14), circle(50, 34, 8), ear, mirrored(ear), wing, mirrored(wing));
}

function christmasTree(): Vec2[][] {
  const tier = (top: number, base: number, halfWidth: number) =>
    path(`M 50 ${top} L ${50 + halfWidth} ${base} Q 50 ${base + 6} ${50 - halfWidth} ${base} Z`)[0];
  return union(
    star(50, 11, 11, 4.8),
    tier(9, 40, 21), // its tip hides inside the star, giving the star a sturdy neck
    tier(29, 63, 30),
    tier(46, 87, 40),
    roundedRect(42, 84, 16, 16, 1.5),
  );
}

function gift(): Vec2[][] {
  const box = roundedRect(15, 44, 70, 56, 2);
  const lid = roundedRect(9, 33, 82, 14, 2);
  const loop = ellipse(35, 20, 15, 9, 25);
  const loopHole = ellipse(35.5, 20, 7, 3.4, 25);
  const bow = minus([loop, mirrored(loop)], [loopHole, mirrored(loopHole)]);
  return union(box, lid, ...bow, circle(50, 30, 6.5));
}

function bauble(): Vec2[][] {
  const ball = circle(50, 60, 38);
  const cap = roundedRect(40, 14, 20, 12, 2);
  // A chunky loop, so it survives a negative outline offset.
  const hanger = minus([circle(50, 9, 8.5)], [circle(50, 9, 3)]);
  return union(ball, cap, ...hanger);
}

export const SHAPES: Record<string, Shape> = {
  "♥": { label: "Heart", group: "basic", draw: heart },
  "★": { label: "Star", group: "basic", draw: () => [star(50, 50, 50, 22.5)] },
  "●": { label: "Circle", group: "basic", draw: () => [circle(50, 50, 50)] },
  "👻": { label: "Ghost", group: "halloween", draw: ghost },
  "🎃": { label: "Pumpkin", group: "halloween", draw: pumpkin },
  "🦇": { label: "Bat", group: "halloween", heightRatio: 0.6, draw: bat },
  "🎄": { label: "Tree", group: "christmas", draw: christmasTree },
  "🎁": { label: "Gift", group: "christmas", draw: gift },
  // There is no bauble emoji; the mirror ball is the nearest thing that hangs from a loop.
  "🪩": { label: "Bauble", group: "christmas", draw: bauble },
};

/** A shape's outline in millimetres, `size` × its height ratio tall, with y pointing up. */
export function shapeRings(shape: Shape, size: number): Vec2[][] {
  const rings = shape.draw();
  const b = boundsOf(rings.map((outer) => ({ outer, holes: [] })));
  const s = (size * (shape.heightRatio ?? 1)) / (b.maxY - b.minY);
  return rings.map((ring) => ring.map(([x, y]): Vec2 => [(x - b.minX) * s, (b.maxY - y) * s]));
}
