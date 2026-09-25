import { cleanAndOffset, boundsOf, regionArea, type Region, type Vec2 } from "./geometry";
import { rotateQuarter } from "./templates";

/**
 * Plate nesting.
 *
 * Every letter outline is rasterised onto a fine grid (after growing it by half the requested
 * gap, so two neighbours can never come closer than the gap). Letters are then dropped onto
 * plates one at a time, in all four quarter-turn orientations, at the lowest position where
 * they fit. Because we work with the real outline rather than bounding boxes, letters nest
 * into each other ("A" beside an upside-down "V", "L" tucked under "T"...).
 *
 * The greedy pass is repeated with many different orderings (a simple local search) and the
 * arrangement using the fewest plates, and packing the early plates most densely, wins.
 */

export interface NestItem {
  /** Index of the template this item is a copy of. Copies share their raster. */
  shape: number;
  copy: number;
}

export interface NestShape {
  regions: Region[];
}

export interface NestOptions {
  bedWidth: number;
  bedDepth: number;
  /** Keep-out border around the plate edge (mm). */
  margin: number;
  /** Minimum gap between two letters (mm). */
  spacing: number;
  allowRotation: boolean;
  /** Time budget for the search, in milliseconds. */
  timeBudgetMs: number;
  /** Grid resolution (mm). Chosen automatically when omitted. */
  cellSize?: number;
  seed?: number;
}

export interface NestPlacement {
  shape: number;
  copy: number;
  plate: number;
  /** Number of anticlockwise quarter turns applied to the outline. */
  rotation: 0 | 1 | 2 | 3;
  /** Translation (mm) applied to the rotated, origin-aligned outline. */
  x: number;
  y: number;
}

export interface NestResult {
  plateCount: number;
  placements: NestPlacement[];
  /** Items too large for the plate in every orientation. */
  unplaced: NestItem[];
  /** Plates needed if letters could be packed with zero waste; a floor on what is possible. */
  lowerBound: number;
  /** Fraction of each plate's usable area covered by letters. */
  utilisation: number[];
  iterations: number;
  elapsedMs: number;
}

interface Raster {
  cols: number;
  rows: number;
  /** runs[row] = flat list of [start, end) column pairs. */
  runs: Int32Array[];
  cells: number;
  /** Longest single run in each row. */
  longest: Int32Array;
  /** Non-empty rows, widest first: dense rows find collisions soonest. */
  order: Int32Array;
  /** mm offset from raster origin to the outline's origin. */
  pad: number;
}

interface Orientation {
  rotation: 0 | 1 | 2 | 3;
  raster: Raster;
}

/** Scanline fill of regions: cell (i, j) is filled when its centre lies inside. */
function rasterise(regions: Region[], cell: number, pad: number): Raster {
  const b = boundsOf(regions);
  const cols = Math.ceil((b.maxX + pad) / cell) + 1;
  const rows = Math.ceil((b.maxY + pad) / cell) + 1;
  const rings: Vec2[][] = regions.flatMap((r) => [r.outer, ...r.holes]);
  const runs: Int32Array[] = [];
  let cells = 0;
  for (let j = 0; j < rows; j++) {
    const y = -pad + (j + 0.5) * cell;
    const xs: number[] = [];
    for (const ring of rings) {
      for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
        const [x1, y1] = ring[k];
        const [x2, y2] = ring[i];
        if (y1 <= y !== y2 <= y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, c) => a - c);
    const row: number[] = [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Cells whose centre falls between the crossings.
      const start = Math.max(0, Math.ceil((xs[k] + pad) / cell - 0.5));
      const end = Math.min(cols, Math.floor((xs[k + 1] + pad) / cell - 0.5) + 1);
      if (end > start) {
        if (row.length && row[row.length - 1] >= start) row[row.length - 1] = Math.max(row[row.length - 1], end);
        else row.push(start, end);
      }
    }
    for (let k = 0; k < row.length; k += 2) cells += row[k + 1] - row[k];
    runs.push(Int32Array.from(row));
  }
  // Trim empty rows at the top so the raster is as small as possible.
  let last = runs.length;
  while (last > 0 && runs[last - 1].length === 0) last--;
  const width = (row: Int32Array) => {
    let w = 0;
    for (let k = 0; k < row.length; k += 2) w += row[k + 1] - row[k];
    return w;
  };
  const order = Int32Array.from(
    runs
      .slice(0, last)
      .map((row, j) => ({ j, w: width(row) }))
      .filter((r) => r.w > 0)
      .sort((a, b) => b.w - a.w)
      .map((r) => r.j),
  );
  const longest = Int32Array.from(runs.slice(0, last), (row) => {
    let m = 0;
    for (let k = 0; k < row.length; k += 2) m = Math.max(m, row[k + 1] - row[k]);
    return m;
  });
  return { cols, rows: last, runs: runs.slice(0, last), cells, order, longest, pad };
}

class Plate {
  readonly prefix: Int32Array[];
  /** Longest stretch of free cells in each plate row, for fast rejection. */
  readonly maxFree: Int32Array;
  filledCells = 0;
  /** Real (not dilated) letter area on this plate, mm². */
  area = 0;
  readonly failed = new Set<number>();

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.prefix = Array.from({ length: rows }, () => new Int32Array(cols + 1));
    this.maxFree = new Int32Array(rows).fill(cols);
  }

  /**
   * Returns -1 when the raster fits at (gx, gy). Otherwise returns the next column worth
   * trying on this row: the first blocked cell tells us every shift that still overlaps it.
   */
  collide(r: Raster, gx: number, gy: number): number {
    const order = r.order;
    for (let o = 0; o < order.length; o++) {
      const j = order[o];
      const runs = r.runs[j];
      const pre = this.prefix[gy + j];
      for (let k = 0; k < runs.length; k += 2) {
        const a = runs[k];
        let lo = gx + a;
        let hi = gx + runs[k + 1];
        const base = pre[lo];
        if (pre[hi] === base) continue;
        // Binary search for the first occupied column c in [lo, hi).
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (pre[mid] === base) lo = mid;
          else hi = mid;
        }
        return lo - a + 1;
      }
    }
    return -1;
  }

  place(r: Raster, gx: number, gy: number) {
    for (let j = 0; j < r.rows; j++) {
      const runs = r.runs[j];
      if (runs.length === 0) continue;
      const pre = this.prefix[gy + j];
      // Rebuild this row's prefix sums with the new cells marked.
      const occupied = new Uint8Array(this.cols);
      for (let i = 0; i < this.cols; i++) occupied[i] = pre[i + 1] - pre[i];
      for (let k = 0; k < runs.length; k += 2) occupied.fill(1, gx + runs[k], gx + runs[k + 1]);
      let free = 0;
      let best = 0;
      for (let i = 0; i < this.cols; i++) {
        pre[i + 1] = pre[i] + occupied[i];
        free = occupied[i] ? 0 : free + 1;
        if (free > best) best = free;
      }
      this.maxFree[gy + j] = best;
    }
    this.filledCells += r.cells;
  }

  /**
   * Plates only ever fill up, so a position that was blocked for a raster stays blocked.
   * We remember, per raster, the first position not yet ruled out and resume from there.
   */
  private readonly frontier = new Map<number, number>();

  /** Lowest-then-leftmost position where the raster fits, or null. */
  findPosition(r: Raster, key: number, limitTop: number): { gx: number; gy: number } | null {
    const maxX = this.cols - r.cols;
    const maxY = Math.min(this.rows - r.rows, limitTop - r.rows);
    const order = r.order;
    const start = this.frontier.get(key) ?? 0;
    const width = this.cols + 1;
    let gy = Math.floor(start / width);
    let gx = start % width;
    rows: for (; gy <= maxY; gy++, gx = 0) {
      // Every row of the letter needs a free stretch at least as long as its longest run.
      for (let o = 0; o < order.length; o++) {
        const j = order[o];
        if (this.maxFree[gy + j] < r.longest[j]) continue rows;
      }
      while (gx <= maxX) {
        const next = this.collide(r, gx, gy);
        if (next < 0) {
          this.frontier.set(key, gy * width + gx);
          return { gx, gy };
        }
        gx = Math.max(gx + 1, next);
      }
    }
    this.frontier.set(key, Math.max(start, Math.max(0, gy) * width));
    return null;
  }
}

/** Small deterministic PRNG so results are reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Attempt {
  plates: Plate[];
  placements: NestPlacement[];
  unplaced: NestItem[];
  score: number;
}

/**
 * Grid resolution: fine enough that a letter spans ~110 cells (so the outline is followed
 * closely) and the plate ~280 cells, whichever is coarser, which keeps the search fast.
 */
export function autoCellSize(options: Pick<NestOptions, "bedWidth" | "bedDepth">, letterSize = 0): number {
  const byBed = Math.max(options.bedWidth, options.bedDepth) / 280;
  return Math.min(2, Math.max(0.5, byBed, letterSize / 110));
}

export function nest(
  shapes: NestShape[],
  items: NestItem[],
  options: NestOptions,
  onProgress?: (best: NestResult) => void,
): NestResult {
  const started = performance.now();
  const typical = shapes.length
    ? shapes.map((sh) => {
        const b = boundsOf(sh.regions);
        return Math.min(b.maxX - b.minX, b.maxY - b.minY);
      }).sort((a, b) => a - b)[Math.floor(shapes.length / 2)]
    : 0;
  const cell = options.cellSize ?? autoCellSize(options, typical);
  const halfGap = options.spacing / 2;
  // Growing by more than half a cell diagonal makes the raster conservative.
  const grow = halfGap + cell * 0.75;
  const pad = Math.ceil(grow / cell) * cell;

  // Plate grid starts half a gap inside the margin, because rasters include half a gap.
  const originX = Math.max(0, options.margin - halfGap);
  const originY = Math.max(0, options.margin - halfGap);
  const cols = Math.floor((options.bedWidth - 2 * originX) / cell);
  const rows = Math.floor((options.bedDepth - 2 * originY) / cell);
  const usableArea = (options.bedWidth - 2 * options.margin) * (options.bedDepth - 2 * options.margin);

  const shapeArea = shapes.map((s) => s.regions.reduce((a, r) => a + regionArea(r), 0));
  const orientations: Orientation[][] = shapes.map((s) => {
    const list: Orientation[] = [];
    let regions = s.regions;
    const turns = options.allowRotation ? 4 : 1;
    for (let k = 0; k < turns; k++) {
      if (k > 0) regions = rotateQuarter(regions);
      const grown = cleanAndOffset(
        regions.flatMap((r) => [r.outer, ...r.holes]),
        grow,
      );
      list.push({ rotation: k as 0 | 1 | 2 | 3, raster: rasterise(grown, cell, pad) });
    }
    return list;
  });

  // Each letter needs at least its outline grown by half the gap.
  const grownArea = shapes.map((s) =>
    cleanAndOffset(s.regions.flatMap((r) => [r.outer, ...r.holes]), halfGap).reduce((a, r) => a + regionArea(r), 0),
  );
  const totalArea = items.reduce((s, it) => s + grownArea[it.shape], 0);
  const lowerBound = Math.max(items.length ? 1 : 0, Math.ceil(totalArea / usableArea - 1e-9));

  /**
   * policy 0: choose the orientation whose top edge ends up lowest (keeps rows flat).
   * policy 1: choose the orientation that sits lowest, then the flattest (fills gaps).
   */
  const run = (order: NestItem[], policy: 0 | 1): Attempt => {
    const plates: Plate[] = [];
    const placements: NestPlacement[] = [];
    const unplaced: NestItem[] = [];
    for (const item of order) {
      const options_ = orientations[item.shape];
      let done = false;
      const tryPlate = (p: number) => {
        const plate = plates[p];
        if (plate.failed.has(item.shape)) return false;
        let best: { o: Orientation; gx: number; gy: number; top: number } | null = null;
        for (const o of options_) {
          if (plate.filledCells + o.raster.cells > cols * rows) continue;
          const limit = policy === 0 && best ? best.top : policy === 1 && best ? best.gy + o.raster.rows + 1 : rows;
          const pos = plate.findPosition(o.raster, item.shape * 4 + o.rotation, limit);
          if (!pos) continue;
          const top = pos.gy + o.raster.rows;
          const better =
            !best ||
            (policy === 0
              ? top < best.top || (top === best.top && pos.gx < best.gx)
              : pos.gy < best.gy || (pos.gy === best.gy && (top < best.top || (top === best.top && pos.gx < best.gx))));
          if (better) best = { o, ...pos, top };
        }
        if (!best) {
          plate.failed.add(item.shape);
          return false;
        }
        plate.place(best.o.raster, best.gx, best.gy);
        plate.area += shapeArea[item.shape];
        placements.push({
          shape: item.shape,
          copy: item.copy,
          plate: p,
          rotation: best.o.rotation,
          x: originX + best.gx * cell + pad,
          y: originY + best.gy * cell + pad,
        });
        return true;
      };
      for (let p = 0; p < plates.length && !done; p++) done = tryPlate(p);
      if (!done) {
        plates.push(new Plate(cols, rows));
        done = tryPlate(plates.length - 1);
        if (!done) {
          plates.pop();
          unplaced.push(item);
        }
      }
    }
    // Fewer plates first; then prefer filling early plates densely (empties the last one).
    const fill = plates.reduce((s, p) => s + (p.area / usableArea) ** 2, 0);
    return { plates, placements, unplaced, score: plates.length * 1000 - fill };
  };

  const toResult = (a: Attempt, iterations: number): NestResult => ({
    plateCount: a.plates.length,
    placements: a.placements,
    unplaced: a.unplaced,
    lowerBound,
    utilisation: a.plates.map((p) => p.area / usableArea),
    iterations,
    elapsedMs: performance.now() - started,
  });

  const size = (it: NestItem) => {
    const r = orientations[it.shape][0].raster;
    return { area: r.cells, h: r.rows, w: r.cols, max: Math.max(r.rows, r.cols) };
  };
  const seeds: NestItem[][] = [
    [...items].sort((a, b) => size(b).area - size(a).area),
    [...items].sort((a, b) => size(b).max - size(a).max || size(b).area - size(a).area),
    [...items].sort((a, b) => size(b).h - size(a).h || size(b).w - size(a).w),
    [...items].sort((a, b) => size(b).w - size(a).w || size(b).h - size(a).h),
  ];

  let best: Attempt | null = null;
  let bestOrder: NestItem[] = seeds[0];
  let bestPolicy: 0 | 1 = 0;
  let iterations = 0;
  const consider = (order: NestItem[], policy: 0 | 1) => {
    const attempt = run(order, policy);
    iterations++;
    if (!best || attempt.score < best.score - 1e-9) {
      best = attempt;
      bestOrder = order;
      bestPolicy = policy;
      onProgress?.(toResult(attempt, iterations));
    }
    return attempt;
  };
  for (const s of seeds) for (const policy of [0, 1] as const) consider(s, policy);

  // Local search on the best ordering. Besides random swaps and moves, the most useful move
  // pulls letters from the emptiest (last) plate to the front, so they are placed while
  // there is still plenty of room and the leftovers are small letters that slot into gaps.
  const rand = mulberry32(options.seed ?? 1);
  const deadline = started + options.timeBudgetMs;
  let stale = 0;
  const same = (a: NestItem, b: NestItem) => a.shape === b.shape && a.copy === b.copy;
  while (items.length > 1 && performance.now() < deadline) {
    const current = best as Attempt | null;
    if (current && current.plates.length <= lowerBound && current.unplaced.length === 0) break;
    let order = [...bestOrder];
    const roll = rand();
    if (current && current.plates.length > 1 && roll < 0.4) {
      const last = current.plates.length - 1;
      const onLast = current.placements.filter((p) => p.plate === last);
      const pick = onLast[Math.floor(rand() * onLast.length)];
      const from = order.findIndex((it) => same(it, pick));
      const to = Math.floor(rand() * rand() * Math.max(1, from));
      order.splice(to, 0, ...order.splice(from, 1));
    } else if (stale > 40 && roll < 0.55) {
      // Stuck: restart from a shuffled copy of the best ordering.
      order = order
        .map((it, i) => ({ it, k: i + rand() * order.length * 0.6 }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.it);
      stale = 0;
    } else {
      const moves = 1 + Math.floor(rand() * 3);
      for (let m = 0; m < moves; m++) {
        const i = Math.floor(rand() * order.length);
        const j = Math.floor(rand() * order.length);
        if (rand() < 0.5) [order[i], order[j]] = [order[j], order[i]];
        else order.splice(j, 0, ...order.splice(i, 1));
      }
    }
    const policy: 0 | 1 = rand() < 0.75 ? bestPolicy : ((1 - bestPolicy) as 0 | 1);
    const before = best;
    consider(order, policy);
    stale = best === before ? stale + 1 : 0;
  }

  return toResult(best!, iterations);
}

/** Outline for a placement, in bed coordinates. */
export function placedRegions(regions: Region[], placement: Pick<NestPlacement, "rotation" | "x" | "y">): Region[] {
  let r = regions;
  for (let k = 0; k < placement.rotation; k++) r = rotateQuarter(r);
  const map = (ring: Vec2[]) => ring.map(([x, y]): Vec2 => [x + placement.x, y + placement.y]);
  return r.map((reg) => ({ outer: map(reg.outer), holes: reg.holes.map(map) }));
}
