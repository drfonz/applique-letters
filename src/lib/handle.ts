import { regionArea, type Region, type Vec2 } from "./geometry";
import { extrudeRegions, mergeMeshes, type Mesh } from "./mesh";

/**
 * Optional grip handle: a post standing up from the template so it can be held flat
 * against the fabric with a single fingertip. It prints upright without supports: a
 * flared foot (45° or steeper), a straight post and a domed top to press on.
 */
export interface HandleSettings {
  enabled: boolean;
  /** Post diameter (mm). Shrunk automatically on letters too narrow to hold it. */
  diameter: number;
  /** Height above the template's top face (mm). */
  height: number;
}

export interface HandlePlacement {
  x: number;
  y: number;
  /** Post radius actually used (mm). */
  radius: number;
  /** Radius of the flared foot where it meets the template (mm). */
  footRadius: number;
  /** True when the letter was too narrow for the requested diameter. */
  reduced: boolean;
}

/** Keep the handle at least this far inside the outline so it never touches the tracing edge. */
const EDGE_CLEARANCE = 1;
const MIN_RADIUS = 2.5;
const FLARE = 2.5;

function pointInRegion([px, py]: Vec2, region: Region): boolean {
  let inside = false;
  for (const ring of [region.outer, ...region.holes]) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to the nearest edge of the region (outer boundary or holes). */
function edgeDistance([px, py]: Vec2, region: Region): number {
  let best = Infinity;
  for (const ring of [region.outer, ...region.holes]) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
      const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function centroid(region: Region): Vec2 {
  let cx = 0;
  let cy = 0;
  let total = 0;
  for (const ring of [region.outer, ...region.holes]) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j];
      const [x1, y1] = ring[i];
      const f = x0 * y1 - x1 * y0;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
      total += f;
    }
  }
  return total ? [cx / (3 * total), cy / (3 * total)] : region.outer[0];
}

/** Post and foot sizes for a handle at `p`, given how much material surrounds it. */
function sized(p: Vec2, d: number, settings: HandleSettings): HandlePlacement {
  const room = d - EDGE_CLEARANCE;
  const radius = Math.max(MIN_RADIUS, Math.min(settings.diameter / 2, room - FLARE));
  const footRadius = Math.max(radius, Math.min(radius + FLARE, room));
  return { x: p[0], y: p[1], radius, footRadius, reduced: radius < settings.diameter / 2 - 0.05 };
}

/**
 * Whether the handle may be moved to `p`: it must sit on material with at least as much room
 * as the full-size handle needs, or, on letters too narrow for that anywhere, as much room as
 * the automatic spot has.
 */
export function canPlaceHandle(
  regions: Region[],
  settings: HandleSettings,
  p: Vec2,
  auto: HandlePlacement | null,
): boolean {
  const region = regions.find((r) => pointInRegion(p, r));
  if (!region) return false;
  const wanted = settings.diameter / 2 + FLARE + EDGE_CLEARANCE;
  const need = auto ? Math.min(wanted, auto.footRadius + EDGE_CLEARANCE) : wanted;
  return edgeDistance(p, region) >= need - 1e-6;
}

/**
 * Where to put the handle: on the largest piece of the letter, as close to its centre of
 * mass as possible (so a single press holds the whole letter flat) while still sitting on
 * material wide enough for the post. If nowhere is wide enough, the widest spot is used and
 * the post is made thinner. Passing `at` puts it exactly there instead, if that is on the letter.
 */
export function placeHandle(regions: Region[], settings: HandleSettings, at?: Vec2 | null): HandlePlacement | null {
  if (!settings.enabled || regions.length === 0) return null;
  if (at) {
    const chosen = regions.find((r) => pointInRegion(at, r));
    if (chosen) return sized(at, edgeDistance(at, chosen), settings);
  }
  const region = regions.reduce((a, b) => (regionArea(b) > regionArea(a) ? b : a));
  const target = centroid(region);
  const wanted = settings.diameter / 2 + FLARE + EDGE_CLEARANCE;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of region.outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  // Coarse grid search, then refine around the best candidate.
  type Candidate = { p: Vec2; d: number; score: number };
  const score = (p: Vec2, d: number) => {
    const off = Math.hypot(p[0] - target[0], p[1] - target[1]);
    // Anywhere wide enough is fine, so prefer the spot nearest the centre of mass.
    return d >= wanted ? off : 1e6 - d * 1000 + off;
  };
  let best: Candidate | null = null;
  const consider = (p: Vec2) => {
    if (!pointInRegion(p, region)) return;
    const d = edgeDistance(p, region);
    const s = score(p, d);
    if (!best || s < best.score) best = { p, d, score: s };
  };
  const steps = 36;
  let step = Math.max(maxX - minX, maxY - minY) / steps;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) consider([minX + (i * (maxX - minX)) / steps, minY + (j * (maxY - minY)) / steps]);
  }
  consider(target);
  if (!best) return null;
  for (let round = 0; round < 4; round++) {
    const c: Vec2 = (best as Candidate).p;
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) consider([c[0] + (i * step) / 3, c[1] + (j * step) / 3]);
    step /= 3;
  }

  const { p, d } = best as Candidate;
  return sized(p, d, settings);
}

/**
 * Handle solid as a closed mesh. It starts slightly below the template's top face so the two
 * bodies overlap (slicers merge overlapping shells), then rises through the flared foot,
 * the post and a domed cap.
 */
export function handleMesh(h: HandlePlacement, thickness: number, height: number, segments = 48): Mesh {
  const base = Math.max(0, thickness - 0.4);
  const flare = h.footRadius - h.radius;
  const domeHeight = Math.min(h.radius * 0.7, height * 0.35);
  const top = thickness + height;
  // Profile as [radius, z] from bottom to top.
  const profile: Vec2[] = [
    [h.footRadius, base],
    [h.footRadius, thickness],
    [h.radius, thickness + flare],
  ];
  const domeStart = top - domeHeight;
  if (domeStart > thickness + flare) profile.push([h.radius, domeStart]);
  const domeSteps = 8;
  for (let i = 1; i < domeSteps; i++) {
    const a = (i / domeSteps) * (Math.PI / 2);
    profile.push([h.radius * Math.cos(a), domeStart + domeHeight * Math.sin(a)]);
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const rings = profile.length;
  for (const [r, z] of profile) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(h.x + r * Math.cos(a), h.y + r * Math.sin(a), z);
    }
  }
  const bottomCentre = positions.length / 3;
  positions.push(h.x, h.y, base);
  const topCentre = positions.length / 3;
  positions.push(h.x, h.y, top);

  for (let k = 0; k < rings - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const a0 = k * segments + s;
      const b0 = k * segments + ((s + 1) % segments);
      const a1 = a0 + segments;
      const b1 = b0 + segments;
      indices.push(a0, b0, b1, a0, b1, a1);
    }
  }
  const last = (rings - 1) * segments;
  for (let s = 0; s < segments; s++) {
    const n = (s + 1) % segments;
    indices.push(bottomCentre, n, s);
    indices.push(topCentre, last + s, last + n);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** Handle volume in mm³ (above the template's top face), for filament estimates. */
export function handleVolume(h: HandlePlacement, height: number): number {
  const flare = h.footRadius - h.radius;
  const cone = (Math.PI * flare * (h.footRadius ** 2 + h.footRadius * h.radius + h.radius ** 2)) / 3;
  return cone + Math.PI * h.radius ** 2 * Math.max(0, height - flare);
}

/**
 * A template as a printable solid: the flat letter plus, optionally, its handle. The handle
 * goes where `placement` says, or is placed automatically when it is left out.
 */
export function templateSolid(
  regions: Region[],
  thickness: number,
  handle: HandleSettings,
  placement?: HandlePlacement | null,
): Mesh {
  const slab = extrudeRegions(regions, thickness);
  const h = handle.enabled ? (placement === undefined ? placeHandle(regions, handle) : placement) : null;
  return h ? mergeMeshes([slab, handleMesh(h, thickness, handle.height)]) : slab;
}
