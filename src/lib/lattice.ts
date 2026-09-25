import {
  boundsOf,
  cleanAndOffset,
  differenceRegions,
  regionRings,
  signedArea,
  type Region,
  type Vec2,
} from "./geometry";

/**
 * Filament saver: a template only needs a solid border to trace round. Inside that border
 * the letter is printed as an open diagonal lattice, which keeps it flat and stiff for a
 * fraction of the material. Parts too thin for a lattice stay solid.
 */
export interface LatticeSettings {
  enabled: boolean;
  /** Width of the solid border (mm). */
  border: number;
  /** Distance between neighbouring ribs (mm). */
  spacing: number;
}

/** Four 0.4 mm lines: wide enough to print cleanly and stiff enough to hold the letter flat. */
export const RIB_WIDTH = 1.6;
/** Openings narrower than this are filled in rather than printed as slivers. */
const MIN_OPENING = 1.2;
/** Solid material kept round each grip handle's foot (mm). */
const HANDLE_PAD = 2;

/** A disc to keep solid, such as the spot under a grip handle. */
export interface SolidSpot {
  x: number;
  y: number;
  radius: number;
}

const ccw = (ring: Vec2[]) => (signedArea(ring) >= 0 ? ring : [...ring].reverse());

function circle({ x, y, radius }: SolidSpot, segments = 32): Vec2[] {
  return Array.from({ length: segments }, (_, i): Vec2 => {
    const a = (i / segments) * Math.PI * 2;
    return [x + radius * Math.cos(a), y + radius * Math.sin(a)];
  });
}

/** Diagonal ribs at ±45°, covering the regions' bounding box. */
function ribs(regions: Region[], spacing: number): Vec2[][] {
  const b = boundsOf(regions);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const reach = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + spacing;
  const count = Math.ceil(reach / spacing);
  const half = RIB_WIDTH / 2;
  const strips: Vec2[][] = [];
  for (const dir of [1, -1]) {
    const u: Vec2 = [Math.SQRT1_2, dir * Math.SQRT1_2];
    const n: Vec2 = [-dir * Math.SQRT1_2, Math.SQRT1_2];
    for (let k = -count; k <= count; k++) {
      const at = (along: number, across: number): Vec2 => [
        cx + u[0] * along + n[0] * (k * spacing + across),
        cy + u[1] * along + n[1] * (k * spacing + across),
      ];
      strips.push(ccw([at(-reach, -half), at(reach, -half), at(reach, half), at(-reach, half)]));
    }
  }
  return strips;
}

/**
 * Drop vertices that sit on the straight line between their neighbours. Clipper leaves some
 * along the ribs, and the triangulation turns them into zero-area triangles.
 */
function dropCollinear(ring: Vec2[]): Vec2[] {
  const out = [...ring];
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const [ax, ay] = out[(i + out.length - 1) % out.length];
      const [bx, by] = out[i];
      const [cx, cy] = out[(i + 1) % out.length];
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const len = Math.hypot(cx - ax, cy - ay);
      if (Math.abs(cross) <= 1e-4 * Math.max(len, 1e-9)) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}

/** The outline as it is printed: solid border, lattice inside, solid pads under `solid` spots. */
export function latticeRegions(regions: Region[], settings: LatticeSettings, solid: SolidSpot[] = []): Region[] {
  if (!settings.enabled || regions.length === 0) return regions;
  const inner = cleanAndOffset(regionRings(regions), -settings.border);
  if (inner.length === 0) return regions;
  const keep = [
    ...ribs(regions, settings.spacing),
    ...solid.map((s) => ccw(circle({ ...s, radius: s.radius + HANDLE_PAD }))),
  ];
  const cut = differenceRegions(regionRings(inner), keep);
  // Shrink then regrow the openings: slivers vanish and the rib junctions get rounded fillets.
  const openings = cleanAndOffset(regionRings(cleanAndOffset(regionRings(cut), -MIN_OPENING / 2)), MIN_OPENING / 2);
  if (openings.length === 0) return regions;
  return differenceRegions(regionRings(regions), regionRings(openings)).map((r) => ({
    outer: dropCollinear(r.outer),
    holes: r.holes.map(dropCollinear),
  }));
}
