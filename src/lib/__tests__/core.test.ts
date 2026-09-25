import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import opentype from "opentype.js";
import { buildTemplates, countCharacters, thicknessOf, type TemplateSettings } from "../templates";
import { extrudeRegions, meshVolume, mergeMeshes } from "../mesh";
import { meshToStl, meshesTo3mf } from "../export";
import { nest, placedRegions } from "../nest";
import { boundsOf, regionArea } from "../geometry";

function loadFont(file: string) {
  const buf = readFileSync(resolve(__dirname, "../../../node_modules/@fontsource", file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const fredoka = loadFont("fredoka/files/fredoka-latin-700-normal.woff");
const ALPHABET = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
const chars = (s: string) => Array.from(s);
const base: TemplateSettings = {
  letterHeight: 100,
  outlineOffset: 0,
  layers: 5,
  layerHeight: 0.2,
  mirror: false,
};

/** Every edge of a closed manifold mesh is shared by exactly two triangles, in opposite directions. */
function isWatertight(indices: Uint32Array) {
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e];
      const b = indices[t + ((e + 1) % 3)];
      const key = `${a}>${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of edges) {
    const [a, b] = key.split(">");
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}

describe("templates", () => {
  it("builds every capital at the requested height", () => {
    const { templates, missing } = buildTemplates(fredoka, ALPHABET, base);
    expect(missing).toEqual([]);
    expect(templates).toHaveLength(26);
    const h = templates.find((t) => t.char === "H")!;
    expect(h.height).toBeGreaterThan(99);
    expect(h.height).toBeLessThan(101);
    expect(templates.find((t) => t.char === "O")!.regions[0].holes).toHaveLength(1);
    expect(templates.find((t) => t.char === "A")!.regions[0].holes).toHaveLength(1);
    // Fredoka draws "8" with five overlapping contours; they must merge into one piece with two holes.
    const eight = buildTemplates(fredoka, ["8"], base).templates[0];
    expect(eight.pieces).toBe(1);
    expect(eight.regions[0].holes).toHaveLength(2);
  });

  it("counts repeated letters and reports missing glyphs", () => {
    expect(countCharacters("HAPPY day").get("P")).toBe(2);
    expect(countCharacters("HAPPY day").has(" ")).toBe(false);
    const { templates, missing } = buildTemplates(fredoka, chars("HAPPYΩday♥"), base);
    expect(templates.filter((t) => t.char === "P")).toHaveLength(1);
    expect(templates.some((t) => t.char === "♥")).toBe(true);
    expect(missing).toEqual(["Ω"]);
    expect(templates.find((t) => t.char === "a")!.slug).toBe("a-lower");
  });

  it("grows the outline by the offset", () => {
    const plain = buildTemplates(fredoka, ["I"], base).templates[0];
    const grown = buildTemplates(fredoka, ["I"], { ...base, outlineOffset: 5 }).templates[0];
    expect(grown.height).toBeCloseTo(plain.height + 10, 0);
  });
});

describe("mesh", () => {
  it("extrudes watertight solids with the right volume", () => {
    const { templates } = buildTemplates(fredoka, chars("ABOR♥i★8"), base);
    const t = thicknessOf(base);
    for (const tpl of templates) {
      const mesh = extrudeRegions(tpl.regions, t);
      expect(isWatertight(mesh.indices), tpl.char).toBe(true);
      expect(meshVolume(mesh)).toBeCloseTo(tpl.area * t, 0);
    }
  });

  it("writes STL and 3MF", () => {
    const { templates } = buildTemplates(fredoka, chars("AB"), base);
    const meshes = templates.map((tpl) => extrudeRegions(tpl.regions, 1));
    const stl = meshToStl(mergeMeshes(meshes));
    expect(stl.byteLength).toBe(84 + (mergeMeshes(meshes).indices.length / 3) * 50);
    const zip = meshesTo3mf(templates.map((tpl, i) => ({ name: tpl.char, mesh: meshes[i] })));
    expect(zip[0]).toBe(0x50); // "PK"
  });
});

describe("nesting", () => {
  const bed = { bedWidth: 256, bedDepth: 256, margin: 5, spacing: 4, allowRotation: true };

  it("packs a full alphabet without overlaps, respecting the gap and plate edges", () => {
    const { templates } = buildTemplates(fredoka, ALPHABET, { ...base, letterHeight: 80 });
    const items = templates.map((_, i) => ({ shape: i, copy: 1 }));
    const result = nest(templates, items, { ...bed, timeBudgetMs: 1500 });
    expect(result.unplaced).toEqual([]);
    expect(result.placements).toHaveLength(26);
    expect(result.plateCount).toBeGreaterThanOrEqual(result.lowerBound);

    for (let p = 0; p < result.plateCount; p++) {
      const onPlate = result.placements.filter((pl) => pl.plate === p);
      const outlines = onPlate.map((pl) => placedRegions(templates[pl.shape].regions, pl));
      for (const o of outlines) {
        const b = boundsOf(o);
        expect(b.minX).toBeGreaterThanOrEqual(bed.margin - 1e-6);
        expect(b.minY).toBeGreaterThanOrEqual(bed.margin - 1e-6);
        expect(b.maxX).toBeLessThanOrEqual(bed.bedWidth - bed.margin + 1e-6);
        expect(b.maxY).toBeLessThanOrEqual(bed.bedDepth - bed.margin + 1e-6);
      }
      // No two letters may come closer than the gap: grow each by just under half and check.
      for (let i = 0; i < outlines.length; i++) {
        for (let j = i + 1; j < outlines.length; j++) {
          const overlap = intersectionArea(outlines[i], outlines[j], bed.spacing / 2 - 0.05);
          expect(overlap).toBe(0);
        }
      }
    }
    console.log(
      `alphabet @80mm: ${result.plateCount} plates (lower bound ${result.lowerBound}), ` +
        `${result.iterations} iterations in ${Math.round(result.elapsedMs)} ms, ` +
        `utilisation ${result.utilisation.map((u) => Math.round(u * 100) + "%").join(", ")}`,
    );
  });

  it("reports letters that cannot fit", () => {
    const { templates } = buildTemplates(fredoka, ["W"], { ...base, letterHeight: 300 });
    const result = nest(templates, [{ shape: 0, copy: 1 }], { ...bed, timeBudgetMs: 100 });
    expect(result.unplaced).toHaveLength(1);
    expect(result.plateCount).toBe(0);
  });
});

import ClipperLib from "clipper-lib";
import { cleanAndOffset, type Region } from "../geometry";

function intersectionArea(a: Region[], b: Region[], grow: number): number {
  const ga = cleanAndOffset(a.flatMap((r) => [r.outer, ...r.holes]), grow);
  const gb = cleanAndOffset(b.flatMap((r) => [r.outer, ...r.holes]), grow);
  const toPaths = (rs: Region[]) =>
    rs.flatMap((r) => [r.outer, ...r.holes]).map((ring) => ring.map(([x, y]) => ({ X: Math.round(x * 1000), Y: Math.round(y * 1000) })));
  const c = new ClipperLib.Clipper();
  c.AddPaths(toPaths(ga), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(toPaths(gb), ClipperLib.PolyType.ptClip, true);
  const out: ClipperLib.IntPoint[][] = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const regions: Region[] = out.map((p) => ({ outer: p.map((q) => [q.X / 1000, q.Y / 1000] as [number, number]), holes: [] }));
  return regions.reduce((s, r) => s + Math.abs(regionArea(r)), 0) > 0.5 ? 1 : 0;
}

import { handleMesh, placeHandle, templateSolid } from "../handle";

describe("grip handle", () => {
  const settings = { enabled: true, diameter: 12, height: 15 };

  it("sits on solid material, clear of every edge, for every capital", () => {
    const { templates } = buildTemplates(fredoka, ALPHABET, base);
    for (const t of templates) {
      const h = placeHandle(t.regions, settings)!;
      expect(h, t.char).not.toBeNull();
      // Sample the foot circle: every point must be inside the letter and not in a hole.
      const main = t.regions.reduce((a, b) => (regionArea(b) > regionArea(a) ? b : a));
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const p: [number, number] = [h.x + h.footRadius * Math.cos(a), h.y + h.footRadius * Math.sin(a)];
        expect(insideRegion(p, main), `${t.char} foot point ${k}`).toBe(true);
      }
    }
  });

  it("avoids the counter of an O and shrinks on narrow strokes", () => {
    const o = buildTemplates(fredoka, ["O"], base).templates[0];
    const h = placeHandle(o.regions, settings)!;
    const hole = o.regions[0].holes[0];
    expect(insideRegion([h.x, h.y], { outer: hole, holes: [] })).toBe(false);

    const thin = buildTemplates(fredoka, ["I"], { ...base, letterHeight: 40 }).templates[0];
    const small = placeHandle(thin.regions, settings)!;
    expect(small.reduced).toBe(true);
    expect(small.radius).toBeLessThan(6);
  });

  it("produces closed solids that stand on the template", () => {
    const t = buildTemplates(fredoka, ["A"], base).templates[0];
    const h = placeHandle(t.regions, settings)!;
    const post = handleMesh(h, 1.2, 15);
    expect(isWatertight(post.indices)).toBe(true);
    expect(meshVolume(post)).toBeGreaterThan(0);
    let top = 0;
    for (let i = 2; i < post.positions.length; i += 3) top = Math.max(top, post.positions[i]);
    expect(top).toBeCloseTo(16.2, 3);

    const solid = templateSolid(t.regions, 1.2, settings);
    expect(isWatertight(solid.indices)).toBe(true);
    expect(templateSolid(t.regions, 1.2, { ...settings, enabled: false }).indices.length).toBeLessThan(solid.indices.length);
  });
});

function insideRegion([px, py]: [number, number], region: Region): boolean {
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
