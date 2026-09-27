import ClipperLib from "clipper-lib";
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
export type ShapeGroup = "basic" | "halloween" | "christmas" | "easter";

export interface Shape {
  label: string;
  group: ShapeGroup;
  /** Height relative to a capital letter; wide shapes are shorter so they don't dwarf the text. */
  heightRatio?: number;
  /** Outline in design units: outers and holes, wound opposite ways. */
  draw: () => Vec2[][];
}

export interface ShapeFamily {
  id: ShapeGroup;
  label: string;
  /** Whether the family is "in season" (and listed first) on a given day. */
  season?: (today: Date) => boolean;
}

/** Between two [month, day] dates inclusive, wrapping over the new year if need be. */
function between(from: [number, number], to: [number, number]) {
  const key = ([m, d]: [number, number]) => m * 100 + d;
  return (today: Date) => {
    const now = key([today.getMonth() + 1, today.getDate()]);
    return key(from) <= key(to) ? now >= key(from) && now <= key(to) : now >= key(from) || now <= key(to);
  };
}

/** Easter Sunday in the Gregorian calendar (the anonymous "Meeus/Jones/Butcher" method). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Three weeks before Easter Sunday until a week after it. */
function aroundEaster(today: Date): boolean {
  const day = 24 * 60 * 60 * 1000;
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((midnight.getTime() - easterSunday(today.getFullYear()).getTime()) / day);
  return days >= -21 && days <= 7;
}

export const SHAPE_GROUPS: ShapeFamily[] = [
  { id: "basic", label: "Basics" },
  { id: "halloween", label: "Halloween", season: between([9, 1], [10, 31]) },
  // Runs into the new year, until Twelfth Night.
  { id: "christmas", label: "Christmas", season: between([11, 1], [1, 6]) },
  { id: "easter", label: "Easter", season: aroundEaster },
];

export function inSeason(family: ShapeFamily, today = new Date()): boolean {
  return family.season?.(today) ?? false;
}

/** Families in picker order: whatever is in season, then the basics, then the rest. */
export function familiesInOrder(today = new Date()): (ShapeFamily & { inSeason: boolean })[] {
  const rank = (f: ShapeFamily) => (inSeason(f, today) ? 0 : f.id === "basic" ? 1 : 2);
  return SHAPE_GROUPS.map((f) => ({ ...f, inSeason: inSeason(f, today) })).sort((a, b) => rank(a) - rank(b));
}

/** The characters of every shape in a family, in the order they are defined. */
export function shapesIn(group: ShapeGroup): string[] {
  return Object.keys(SHAPES).filter((c) => SHAPES[c].group === group);
}

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

/** A thick line with round ends and joins through `points`, `width` design units wide. */
function stroke(points: Vec2[], width: number): Vec2[][] {
  const scale = 100;
  const offset = new ClipperLib.ClipperOffset(2, 0.05 * scale);
  offset.AddPath(
    points.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) })),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etOpenRound,
  );
  const out: ClipperLib.IntPoint[][] = [];
  offset.Execute(out, (width / 2) * scale);
  return out.map((ring) => wound(ring.map((p): Vec2 => [p.X / scale, p.Y / scale])));
}

/** Points along a circular arc, angles in degrees (clockwise on screen, as y points down). */
function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, n = 32): Vec2[] {
  return Array.from({ length: n + 1 }, (_, i): Vec2 => {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / n) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** Turn a ring `deg` degrees about (cx, cy) and move it by (dx, dy). */
function turned(ring: Vec2[], deg: number, cx = 50, cy = 50, dx = 0, dy = 0): Vec2[] {
  const a = (deg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  return ring.map(([x, y]): Vec2 => [
    cx + dx + (x - cx) * cos - (y - cy) * sin,
    cy + dy + (x - cx) * sin + (y - cy) * cos,
  ]);
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

function spider(): Vec2[][] {
  // Four legs a side, each bending up at the knee and down to the foot.
  const legs: Vec2[][] = [
    [
      [55, 52],
      [74, 30],
      [92, 38],
    ],
    [
      [57, 56],
      [82, 44],
      [98, 58],
    ],
    [
      [57, 62],
      [82, 62],
      [96, 80],
    ],
    [
      [55, 68],
      [74, 78],
      [84, 98],
    ],
  ];
  const right = legs.flatMap((leg) => stroke(leg, 5.5));
  const body = union(circle(50, 62, 15), circle(50, 42, 11.5), ...right, ...right.map(mirrored));
  return minus(body, [circle(46.2, 41, 2.2), circle(53.8, 41, 2.2)]);
}

function witchHat(): Vec2[][] {
  // A crooked cone on a wide brim, with a square buckle on the band.
  const cone = path("M 24 86 Q 34 58 44 34 Q 52 14 74 4 Q 64 20 62 36 Q 68 60 76 86 Z");
  return minus(union(ellipse(50, 86, 49, 9), ...cone), [roundedRect(43, 69, 14, 12, 1.5)]);
}

function snowflake(): Vec2[][] {
  // One arm with two pairs of branches, turned six times round a hexagonal centre.
  const arm = [
    ...stroke(
      [
        [50, 50],
        [50, 4],
      ],
      7,
    ),
    ...stroke(
      [
        [40, 20],
        [50, 30],
        [60, 20],
      ],
      5.5,
    ),
    ...stroke(
      [
        [43.5, 10.5],
        [50, 17],
        [56.5, 10.5],
      ],
      5,
    ),
  ];
  const hexagon = (r: number) => polygon(...arc(50, 50, r, 30, 330, 5));
  const arms = [0, 60, 120, 180, 240, 300].flatMap((deg) => arm.map((ring) => wound(turned(ring, deg))));
  return minus(union(hexagon(12), ...arms), [hexagon(5)]);
}

function snowman(): Vec2[][] {
  const arm = [
    ...stroke(
      [
        [30, 62],
        [7, 43],
      ],
      5,
    ),
    ...stroke(
      [
        [13, 48],
        [4, 50],
      ],
      4,
    ),
  ];
  const figure = union(
    circle(50, 72, 26),
    circle(50, 37, 17),
    roundedRect(31, 19, 38, 5, 1.5), // hat brim
    roundedRect(38, 1, 24, 20, 1.5), // hat crown
    ...arm,
    ...arm.map(mirrored),
  );
  const eyes = [circle(44, 33, 2.6), circle(56, 33, 2.6)];
  const nose = polygon([49, 38.5], [49, 43], [60, 41.5]);
  const buttons = [62, 74, 86].map((y) => circle(50, y, 3.2));
  return minus(figure, [...eyes, nose, ...buttons]);
}

function holly(): Vec2[][] {
  // A spiky leaf along +x from the origin: points on each side with scooped edges between them.
  const length = 52;
  const halfWidth = 14;
  const spikes = [0.14, 0.36, 0.59, 0.81].map((t): Vec2 => [t * length, halfWidth * Math.sin(Math.PI * t) ** 0.5]);
  const side = [[0, 0] as Vec2, ...spikes, [length, 0] as Vec2];
  const scoop = (a: Vec2, b: Vec2, sign: number) =>
    `Q ${(a[0] + b[0]) / 2} ${(sign * (a[1] + b[1]) * 0.15) / 2} ${b[0]} ${sign * b[1]}`;
  let d = "M 0 0";
  for (let i = 1; i < side.length; i++) d += ` ${scoop(side[i - 1], side[i], -1)}`;
  for (let i = side.length - 1; i > 0; i--) d += ` ${scoop(side[i], side[i - 1], 1)}`;
  const leaf = path(`${d} Z`)[0];
  // Leaves fan up and out in a V from a cluster of three berries, like a pudding topper.
  const left = wound(turned(leaf, -140, 0, 0, 44, 58));
  const right = wound(turned(leaf, -40, 0, 0, 56, 58));
  return union(left, right, circle(50, 58, 9), circle(42, 66, 9), circle(58, 66, 9));
}

function candyCane(): Vec2[][] {
  const hook: Vec2[] = [[62, 98], [62, 32], ...arc(44, 32, 18, 0, -180), [26, 44]];
  return union(...stroke(hook, 15));
}

function egg(): Vec2[][] {
  // Painted-egg decoration: a zigzag band between two rows of dots.
  const shell = path("M 50 2 C 76 2 92 44 92 63 C 92 86 73 100 50 100 C 27 100 8 86 8 63 C 8 44 24 2 50 2 Z");
  const zigzag = stroke(
    Array.from({ length: 9 }, (_, i): Vec2 => [18 + i * 8, i % 2 ? 53 : 63]),
    4,
  );
  const dots = [36, 50, 64].flatMap((x) => [circle(x, 38, 3.5), circle(x, 79, 3.5)]);
  return minus(shell, [...zigzag, ...dots]);
}

function bunny(): Vec2[][] {
  const head = ellipse(50, 68, 31, 27);
  const ear = ellipse(37, 29, 9.5, 26, -12);
  const face = [circle(39, 63, 3.3), mirrored(circle(39, 63, 3.3)), polygon([45, 73], [55, 73], [50, 79])];
  return minus(union(head, ear, mirrored(ear)), face);
}

function chick(): Vec2[][] {
  // A chick peeping out of the bottom half of its shell, which has a jagged, broken rim.
  const rim = Array.from({ length: 9 }, (_, i): Vec2 => [12 + i * 9.5, i % 2 ? 50 : 58]);
  const shell = polygon(...rim, ...arc(50, 60, 38, 0, 180).map(([x, y]): Vec2 => [x, y]));
  const beak = polygon([72, 36], [86, 41], [72, 46]);
  const tuft = [ellipse(45, 13, 3.5, 7, -25), ellipse(53, 12, 3.5, 7, 20)];
  return minus(union(circle(50, 40, 25), shell, beak, ...tuft), [circle(58, 34, 3.4)]);
}

export const SHAPES: Record<string, Shape> = {
  "♥": { label: "Heart", group: "basic", draw: heart },
  "★": { label: "Star", group: "basic", draw: () => [star(50, 50, 50, 22.5)] },
  "●": { label: "Circle", group: "basic", draw: () => [circle(50, 50, 50)] },
  "👻": { label: "Ghost", group: "halloween", draw: ghost },
  "🎃": { label: "Pumpkin", group: "halloween", draw: pumpkin },
  "🦇": { label: "Bat", group: "halloween", heightRatio: 0.6, draw: bat },
  "🕷": { label: "Spider", group: "halloween", heightRatio: 0.8, draw: spider },
  // No emoji for a witch's hat on its own, so the witch (who always wears one) stands in.
  "🧙": { label: "Witch’s hat", group: "halloween", draw: witchHat },
  "🎄": { label: "Tree", group: "christmas", draw: christmasTree },
  "🎁": { label: "Gift", group: "christmas", draw: gift },
  // There is no bauble emoji; the mirror ball is the nearest thing that hangs from a loop.
  "🪩": { label: "Bauble", group: "christmas", draw: bauble },
  "❄": { label: "Snowflake", group: "christmas", draw: snowflake },
  "⛄": { label: "Snowman", group: "christmas", draw: snowman },
  // Nor for holly or a candy cane: a sprig of leaves and a sweet on a stick are the nearest.
  "🌿": { label: "Holly", group: "christmas", heightRatio: 0.75, draw: holly },
  "🍭": { label: "Candy cane", group: "christmas", draw: candyCane },
  "🥚": { label: "Egg", group: "easter", draw: egg },
  "🐰": { label: "Bunny", group: "easter", draw: bunny },
  "🐣": { label: "Chick", group: "easter", draw: chick },
};

/** A shape's outline in millimetres, `size` × its height ratio tall, with y pointing up. */
export function shapeRings(shape: Shape, size: number): Vec2[][] {
  const rings = shape.draw();
  const b = boundsOf(rings.map((outer) => ({ outer, holes: [] })));
  const s = (size * (shape.heightRatio ?? 1)) / (b.maxY - b.minY);
  return rings.map((ring) => ring.map(([x, y]): Vec2 => [(x - b.minX) * s, (b.maxY - y) * s]));
}
