import ClipperLib from "clipper-lib";
import type { PathCommand } from "./font-types.js";
import {
  boundsOf,
  cleanAndOffset,
  differenceRegions,
  flattenCommands,
  regionRings,
  signedArea,
  unionRegions,
  type Vec2,
} from "./geometry.js";

/**
 * Built-in decorative shapes, keyed by the character that stands for them in banner text.
 * Seasonal shapes use their emoji, so typing 🎃 on a phone keyboard gives a pumpkin.
 *
 * Shapes are drawn in "design units" with y pointing down (as in SVG), roughly 100 units
 * tall, then scaled so they stand as tall as a capital letter (times `heightRatio`).
 */
export type ShapeGroup =
  | "basic"
  | "celebration"
  | "wedding"
  | "baby"
  | "halloween"
  | "christmas"
  | "easter"
  | "diwali"
  | "eid"
  | "hanukkah"
  | "lunar-new-year"
  | "pride";

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

// Festivals set by a lunar or lunisolar calendar (Diwali, Eid, Hanukkah, Lunar New Year) move
// against ours from year to year, so they have no season here.
export const SHAPE_GROUPS: ShapeFamily[] = [
  { id: "basic", label: "Basics" },
  { id: "celebration", label: "Celebrations" },
  { id: "wedding", label: "Weddings & love" },
  { id: "baby", label: "Baby" },
  { id: "halloween", label: "Halloween", season: between([9, 1], [10, 31]) },
  // Runs into the new year, until Twelfth Night.
  { id: "christmas", label: "Christmas", season: between([11, 1], [1, 6]) },
  { id: "easter", label: "Easter", season: aroundEaster },
  { id: "diwali", label: "Diwali" },
  { id: "eid", label: "Eid & Ramadan" },
  { id: "hanukkah", label: "Hanukkah" },
  { id: "lunar-new-year", label: "Lunar New Year" },
  // Pride Month.
  { id: "pride", label: "Pride", season: between([6, 1], [6, 30]) },
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

/** Round off corners tighter than radius `r` and drop anything thinner than 2r, so nothing is spindly. */
function softened(rings: Vec2[][], r: number): Vec2[][] {
  return regionRings(cleanAndOffset(regionRings(cleanAndOffset(rings, -r)), r));
}

/** A candle flame: a teardrop with its tip at (cx, top) and its round end at `bottom`. */
function flame(cx: number, top: number, bottom: number, halfWidth: number): Vec2[] {
  const at = (dx: number, t: number) => `${cx + dx * halfWidth} ${top + t * (bottom - top)}`;
  return path(
    `M ${at(0, 0)} C ${at(0.35, 0.35)} ${at(1, 0.45)} ${at(1, 0.7)} C ${at(1, 0.87)} ${at(0.55, 1)} ${at(0, 1)} ` +
      `C ${at(-0.55, 1)} ${at(-1, 0.87)} ${at(-1, 0.7)} C ${at(-1, 0.45)} ${at(-0.35, 0.35)} ${at(0, 0)} Z`,
  )[0];
}

/** A petal pointed at both ends, `length` long, from the origin straight up. */
function petal(length: number, halfWidth: number): Vec2[] {
  const [l, w] = [length, halfWidth];
  return path(`M 0 0 C ${w} ${-0.25 * l} ${w} ${-0.7 * l} 0 ${-l} C ${-w} ${-0.7 * l} ${-w} ${-0.25 * l} 0 0 Z`)[0];
}

/** `n` copies of a ring turned evenly round the centre of the shape. */
function around(ring: Vec2[], n: number): Vec2[][] {
  return Array.from({ length: n }, (_, i) => wound(turned(ring, (i * 360) / n)));
}

function balloon(): Vec2[][] {
  // Narrowing a little towards a chunky knot, with a highlight to show it is round.
  const body = path("M 50 2 C 78 2 90 24 88 42 C 86 60 66 76 50 78 C 34 76 14 60 12 42 C 10 24 22 2 50 2 Z");
  const knot = path("M 44 70 L 56 70 L 61 90 Q 50 95 39 90 Z");
  return minus(union(...body, ...knot), [ellipse(31, 28, 4.5, 11, 30)]);
}

function cake(): Vec2[][] {
  // Two tiers, each with a wavy line of icing, and three candles.
  const wave = (x0: number, x1: number, y: number) =>
    stroke(
      Array.from({ length: (x1 - x0) / 8 + 1 }, (_, i): Vec2 => [x0 + i * 8, y + (i % 2 ? -3 : 3)]),
      6,
    );
  const tiers = union(roundedRect(8, 64, 84, 36, 3), roundedRect(20, 36, 60, 30, 3));
  const candles = [30, 50, 70].flatMap((x) => [roundedRect(x - 5, 18, 10, 22, 1.5), flame(x, 0, 24, 6.5)]);
  return union(...minus(tiers, [...wave(22, 78, 81), ...wave(34, 66, 54)]), ...candles);
}

function partyHat(): Vec2[][] {
  // A spotty cone with a pompom on top and a frilled trim round the bottom.
  const cone = polygon([50, 10], [80, 88], [20, 88]);
  const trim = Array.from({ length: 6 }, (_, i) => circle(22 + i * 11.2, 90, 7));
  const spots = [circle(50, 48, 4.5), circle(39, 70, 4.5), circle(61, 70, 4.5)];
  return minus(union(cone, ...trim, circle(50, 11, 11)), spots);
}

function buntingFlag(): Vec2[][] {
  // A pennant hanging from the band that folds over the string.
  const pennant = path("M 12 14 L 88 14 L 56 92 Q 50 104 44 92 Z");
  return union(...pennant, roundedRect(6, 2, 88, 18, 3));
}

function weddingRings(): Vec2[][] {
  // Two bands linked together, the right one set with a stone; one piece, with three holes.
  const band = (cx: number) => minus([circle(cx, 60, 26)], [circle(cx, 60, 17)]);
  const stone = polygon([54, 18], [72, 18], [78, 26], [68, 38], [58, 38], [48, 26]);
  return union(...band(37), ...band(63), stone);
}

function dove(): Vec2[][] {
  // Flying to the right with its wing raised and its tail fanned.
  const body = ellipse(52, 62, 30, 14, -8);
  const tail = polygon([30, 57], [3, 46], [10, 61], [4, 77], [30, 70]);
  // The wing's trailing edge ends in three rounded feather tips.
  const wing = path("M 36 58 Q 22 54 27 44 Q 13 41 19 31 Q 5 27 8 14 Q 6 8 14 9 C 38 10 58 26 66 54 Z");
  const beak = polygon([88, 40], [98, 47], [88, 54]);
  // Softened, so the wing tip and the corners of the tail are not left as slivers.
  return minus(softened(union(body, tail, ...wing, circle(79, 46, 13), beak), 3), [circle(80.5, 44, 3.2)]);
}

function babyGrow(): Vec2[][] {
  // A short-sleeved bodysuit with a heart on the front.
  const suit = path(
    "M 36 6 Q 50 22 64 6 L 80 10 Q 88 14 96 26 L 84 40 L 76 34 L 76 70 Q 76 84 60 88 L 60 98 " +
      "L 40 98 L 40 88 Q 24 84 24 70 L 24 34 L 16 40 L 4 26 Q 12 14 20 10 Z",
  );
  const small = heart()[0].map(([x, y]): Vec2 => [50 + x * 0.5, 52 + y * 0.5]);
  return minus(suit, [small]);
}

function rubberDuck(): Vec2[][] {
  // A bath duck facing right, tail cocked, with its wing picked out.
  const body = path("M 4 42 Q 16 58 34 58 L 62 58 Q 94 58 94 78 Q 94 100 62 100 L 34 100 Q 4 100 4 70 Z");
  const beak = ellipse(88, 46, 12, 6.5, 12);
  const wing = path("M 24 70 Q 42 64 62 70 Q 58 86 42 86 Q 28 84 24 70 Z");
  return minus(softened(union(...body, circle(63, 39, 21), beak), 3), [...wing, circle(69, 33, 3.2)]);
}

function pram(): Vec2[][] {
  // A carriage pram: deep body, hood up at the back, a handle and two big wheels.
  const body = path("M 8 42 L 84 42 Q 84 76 52 78 L 40 78 Q 8 76 8 42 Z");
  const hood = path("M 8 44 Q 8 8 46 6 L 46 44 Z");
  const handle = stroke(
    [
      [80, 46],
      [92, 22],
      [99, 22],
    ],
    8,
  );
  const wheel = (x: number) => minus([circle(x, 86, 13)], [circle(x, 86, 4.5)]);
  return union(...body, ...hood, ...handle, ...wheel(28), ...wheel(66));
}

function rattle(): Vec2[][] {
  // A round head with a star cut out, on a short handle ending in a ring.
  const ring = minus([circle(50, 88, 12)], [circle(50, 88, 4)]);
  const head = union(circle(50, 30, 28), roundedRect(38, 54, 24, 8, 3), roundedRect(44, 58, 12, 26, 3), ...ring);
  return minus(head, [star(50, 31, 14, 7)]);
}

function diya(): Vec2[][] {
  // A clay oil lamp: a shallow bowl on a foot, with a flame burning above its rim.
  const bowl = path("M 6 56 L 94 56 Q 90 88 50 90 Q 10 88 6 56 Z");
  const rim = ellipse(50, 56, 45, 6);
  const fire = minus([flame(50, 2, 56, 17)], [flame(50, 26, 50, 6)]);
  const dots = [circle(31, 71, 3.5), circle(50, 74, 3.5), circle(69, 71, 3.5)];
  return minus(union(...bowl, rim, roundedRect(38, 86, 24, 12, 3), ...fire), dots);
}

function lotus(): Vec2[][] {
  // Five pointed petals fanning out from the base, over a shallow cup.
  const fan = [
    [0, 84, 20],
    [34, 72, 18],
    [-34, 72, 18],
    [66, 54, 15],
    [-66, 54, 15],
  ].map(([deg, length, width]) => wound(turned(petal(length, width), deg, 0, 0, 50, 92)));
  return union(...fan, ellipse(50, 90, 30, 9));
}

function rangoliFlower(): Vec2[][] {
  // Eight rounded petals round a ring, each with a seed-shaped cut-out, as drawn in rangoli.
  const petals = around(ellipse(50, 22, 13, 21), 8);
  const seeds = around(ellipse(50, 17, 3.5, 7), 8);
  return minus(union(circle(50, 50, 22), ...petals), [circle(50, 50, 8), ...seeds]);
}

/** A crescent opening to the right and tilted `tilt` degrees, its horns rounded off. */
function crescent(tilt: number): Vec2[][] {
  const bite = wound(turned(circle(68, 50, 40), tilt));
  return softened(minus([circle(50, 50, 48)], [bite]), 4);
}

function moonAndStar(): Vec2[][] {
  // The star sits in the crescent's opening as a piece of its own.
  return [...crescent(0), star(76, 50, 18, 8.5)];
}

function fanous(): Vec2[][] {
  // A Ramadan lantern: hanging ring, pointed dome, a body with arched windows and a tapered foot.
  const ring = minus([circle(50, 12, 11.5)], [circle(50, 12, 3.5)]);
  const dome = path("M 24 38 Q 26 22 50 16 Q 74 22 76 38 Z");
  const body = polygon([20, 42], [80, 42], [84, 69], [70, 86], [30, 86], [16, 69]);
  const foot = path("M 36 84 L 64 84 L 56 100 L 44 100 Z");
  // The middle window stands taller; level sills would sit on one line, which trips up the triangulation.
  const window = (x: number, sill: number) =>
    path(
      `M ${x - 5} ${sill} L ${x - 5} ${sill - 18} Q ${x} ${sill - 27} ${x + 5} ${sill - 18} L ${x + 5} ${sill} Z`,
    )[0];
  const windows = [window(32, 72), window(50, 76), window(68, 72)];
  return minus(union(...ring, ...dome, roundedRect(16, 34, 68, 9, 3), body, ...foot), windows);
}

function menorah(): Vec2[][] {
  // Nine branches on one bar, the shamash (the helper candle) raised in the middle. Drawn wide
  // and short so each branch is still thick enough to cut round.
  const xs = Array.from({ length: 9 }, (_, i) => 50 + (i - 4) * 19);
  const branches = xs.flatMap((x, i) => {
    const top = i === 4 ? 20 : 32;
    return [roundedRect(x - 5.5, top, 11, 56 - top, 2), flame(x, top - 20, top + 2, 6)];
  });
  const bar = roundedRect(xs[0] - 5.5, 50, xs[8] - xs[0] + 11, 12, 5);
  const base = path("M 28 84 L 72 84 L 62 72 L 38 72 Z");
  return union(...branches, bar, roundedRect(44, 56, 12, 20, 2), ...base);
}

function dreidel(): Vec2[][] {
  // A spinning top: handle, square body with a fold between two faces, and a point.
  const point = path("M 16 64 L 84 64 L 56 96 Q 50 102 44 96 Z");
  const body = union(roundedRect(42, 0, 16, 24, 3), roundedRect(16, 20, 68, 50, 6), ...point);
  return minus(body, [roundedRect(59, 28, 6, 36, 3)]);
}

function starOfDavid(): Vec2[][] {
  const triangle = (deg: number) => polygon(...arc(50, 50, 50, deg, deg + 240, 2));
  return minus(union(triangle(-90), triangle(90)), [polygon(...arc(50, 50, 17, 0, 300, 5))]);
}

function paperLantern(): Vec2[][] {
  // A round paper lantern between two caps, its ribs picked out, with a thick tassel below.
  const body = union(
    ellipse(50, 48, 44, 32),
    roundedRect(32, 10, 36, 10, 2),
    roundedRect(32, 76, 36, 10, 2),
    roundedRect(45, 2, 10, 10, 2),
    ...path("M 45 84 L 55 84 L 55 88 L 62 104 L 38 104 L 45 88 Z"),
  );
  return minus(body, minus([ellipse(50, 48, 27, 22)], [ellipse(50, 48, 19, 26)]));
}

function firecracker(): Vec2[][] {
  // A banded tube with a diamond on it and a lit fuse.
  const fuse = stroke(
    [
      [50, 30],
      [50, 22],
      [58, 14],
    ],
    10,
  );
  const tube = union(
    roundedRect(30, 30, 40, 64, 3),
    roundedRect(26, 28, 48, 10, 3),
    roundedRect(26, 88, 48, 10, 3),
    ...fuse,
    star(62, 10, 15, 8.5),
  );
  return minus(tube, [polygon([50, 49], [60, 63], [50, 77], [40, 63])]);
}

function fan(): Vec2[][] {
  // A folding fan open across the top, with a scalloped edge and slits between the folds.
  const [cx, cy, r] = [50, 88, 80];
  const at = (deg: number, d: number): Vec2 => [
    cx + d * Math.cos((deg * Math.PI) / 180),
    cy + d * Math.sin((deg * Math.PI) / 180),
  ];
  const folds = 6;
  const angle = (i: number) => -155 + (i * 130) / folds;
  const leaf = polygon([cx, cy], ...arc(cx, cy, r, -155, -25));
  const scallops = Array.from({ length: folds }, (_, i) => circle(...at(angle(i + 0.5), r), 13));
  const slits = Array.from({ length: folds - 1 }, (_, i) => stroke([at(angle(i + 1), 46), at(angle(i + 1), 66)], 8));
  return minus(union(leaf, ...scallops, circle(cx, cy, 11)), slits.flat());
}

function blossom(): Vec2[][] {
  // A plum blossom: five round petals round an open centre.
  return minus(union(circle(50, 50, 20), ...around(circle(50, 26, 22), 5)), [circle(50, 50, 8)]);
}

function rainbow(): Vec2[][] {
  // Three bands standing on two clouds. The gaps between the bands stop at the clouds, so it is one piece.
  const [cx, cy] = [50, 70];
  const arch = polygon(...arc(cx, cy, 62, -180, 0), ...arc(cx, cy, 18, 0, -180));
  const gaps = [31.5, 48.5].flatMap((r) => stroke(arc(cx, cy, r, -172, -8), 7));
  const cloud = (x: number) => [circle(x - 12, cy + 4, 11), circle(x + 1, cy - 4, 14), circle(x + 14, cy + 4, 11)];
  return union(...minus([arch], gaps), ...cloud(11), ...cloud(89));
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
  "🎈": { label: "Balloon", group: "celebration", draw: balloon },
  "🎂": { label: "Birthday cake", group: "celebration", draw: cake },
  // No emoji for a party hat on its own; the partying face wears one.
  "🥳": { label: "Party hat", group: "celebration", draw: partyHat },
  // Nor for bunting: a triangular flag is the nearest thing to one of its pennants.
  "🚩": { label: "Bunting flag", group: "celebration", draw: buntingFlag },
  "💍": { label: "Rings", group: "wedding", heightRatio: 0.8, draw: weddingRings },
  "🕊": { label: "Dove", group: "wedding", heightRatio: 0.8, draw: dove },
  // No emoji for baby clothes either, so the baby stands in for its baby grow.
  "👶": { label: "Baby grow", group: "baby", draw: babyGrow },
  "🦆": { label: "Rubber duck", group: "baby", draw: rubberDuck },
  // No pram emoji; the baby symbol from changing-room signs is the closest.
  "🚼": { label: "Pram", group: "baby", draw: pram },
  // Maracas are rattles for grown-ups.
  "🪇": { label: "Rattle", group: "baby", draw: rattle },
  "🪔": { label: "Diya (oil lamp)", group: "diwali", draw: diya },
  "🪷": { label: "Lotus", group: "diwali", heightRatio: 0.9, draw: lotus },
  // The rosette is the nearest emoji to a rangoli flower.
  "🏵": { label: "Rangoli flower", group: "diwali", draw: rangoliFlower },
  "🌙": { label: "Crescent moon", group: "eid", draw: () => crescent(-30) },
  "☪": { label: "Moon and star", group: "eid", draw: moonAndStar },
  // No emoji for a Ramadan lantern (🏮 is the Lunar New Year one); the candle that lights it stands in.
  "🕯": { label: "Lantern (fanous)", group: "eid", draw: fanous },
  "🕎": { label: "Menorah", group: "hanukkah", heightRatio: 0.8, draw: menorah },
  // No dreidel emoji; a dreidel is a spinning die, so the die stands in.
  "🎲": { label: "Dreidel", group: "hanukkah", draw: dreidel },
  "✡": { label: "Star of David", group: "hanukkah", draw: starOfDavid },
  "🏮": { label: "Lantern", group: "lunar-new-year", draw: paperLantern },
  "🧨": { label: "Firecracker", group: "lunar-new-year", draw: firecracker },
  "🪭": { label: "Fan", group: "lunar-new-year", heightRatio: 0.85, draw: fan },
  "🌸": { label: "Blossom", group: "lunar-new-year", draw: blossom },
  "🌈": { label: "Rainbow", group: "pride", heightRatio: 0.75, draw: rainbow },
};

/** A shape's outline in millimetres, `size` × its height ratio tall, with y pointing up. */
export function shapeRings(shape: Shape, size: number): Vec2[][] {
  const rings = shape.draw();
  const b = boundsOf(rings.map((outer) => ({ outer, holes: [] })));
  const s = (size * (shape.heightRatio ?? 1)) / (b.maxY - b.minY);
  return rings.map((ring) => ring.map(([x, y]): Vec2 => [(x - b.minX) * s, (b.maxY - y) * s]));
}
