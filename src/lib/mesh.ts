import earcut from "earcut";
import { signedArea, type Region, type Vec2 } from "./geometry";

/** An indexed triangle mesh in millimetres. */
export interface Mesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Extrude flat regions into a closed, watertight solid of the given thickness.
 * Each ring point is shared between the cap and the wall so the result is manifold.
 */
export function extrudeRegions(regions: Region[], thickness: number, offset: Vec2 = [0, 0]): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const [ox, oy] = offset;

  for (const region of regions) {
    const outer = signedArea(region.outer) >= 0 ? region.outer : [...region.outer].reverse();
    const holes = region.holes.map((h) => (signedArea(h) <= 0 ? h : [...h].reverse()));
    const rings = [outer, ...holes];

    const base = positions.length / 3;
    const count = rings.reduce((s, r) => s + r.length, 0);
    // Vertices: bottom ring points first, then the same points on top.
    for (const z of [0, thickness]) {
      for (const ring of rings) for (const [x, y] of ring) positions.push(x + ox, y + oy, z);
    }

    // Caps.
    const flat = rings.flat();
    const holeStarts: number[] = [];
    let at = outer.length;
    for (const h of holes) {
      holeStarts.push(at);
      at += h.length;
    }
    const tris = earcut(flat.flat(), holeStarts, 2);
    for (let f = 0; f < tris.length; f += 3) {
      const a = tris[f];
      const b = tris[f + 1];
      const c = tris[f + 2];
      const pa = flat[a];
      const pb = flat[b];
      const pc = flat[c];
      const ccw = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0;
      const [i, j, k] = ccw ? [a, b, c] : [a, c, b];
      indices.push(base + count + i, base + count + j, base + count + k); // top faces up
      indices.push(base + i, base + k, base + j); // bottom faces down
    }

    // Walls. Material sits on the left of each ring, so the outward normal points right.
    let start = 0;
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a0 = base + start + i;
        const b0 = base + start + ((i + 1) % n);
        const a1 = a0 + count;
        const b1 = b0 + count;
        indices.push(a0, b0, b1, a0, b1, a1);
      }
      start += n;
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function mergeMeshes(meshes: Mesh[]): Mesh {
  const total = meshes.reduce((s, m) => s + m.positions.length, 0);
  const totalIdx = meshes.reduce((s, m) => s + m.indices.length, 0);
  const positions = new Float32Array(total);
  const indices = new Uint32Array(totalIdx);
  let p = 0;
  let q = 0;
  for (const m of meshes) {
    positions.set(m.positions, p);
    const offset = p / 3;
    for (let i = 0; i < m.indices.length; i++) indices[q + i] = m.indices[i] + offset;
    p += m.positions.length;
    q += m.indices.length;
  }
  return { positions, indices };
}

/** Volume in mm³ (divergence theorem); positive for outward-facing meshes. */
export function meshVolume(mesh: Mesh): number {
  const { positions: v, indices } = mesh;
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    vol +=
      v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) -
      v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) +
      v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return vol / 6;
}
