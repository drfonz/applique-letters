import { strToU8, zipSync } from "fflate";
import type { Mesh } from "./mesh";
import type { Region } from "./geometry";

/** Binary STL. */
export function meshToStl(mesh: Mesh, name = "template"): Uint8Array<ArrayBuffer> {
  const { positions: v, indices } = mesh;
  const triangles = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  const header = strToU8(`Applique Letters: ${name}`.slice(0, 79));
  new Uint8Array(buffer).set(header, 0);
  view.setUint32(80, triangles, true);
  let o = 84;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ux = v[b] - v[a];
    const uy = v[b + 1] - v[a + 1];
    const uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a];
    const wy = v[c + 1] - v[a + 1];
    const wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const f of [nx, ny, nz, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]]) {
      view.setFloat32(o, f, true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buffer);
}

export interface NamedMesh {
  name: string;
  mesh: Mesh;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

/**
 * 3MF package with one object per template, so Bambu Studio / Orca / PrusaSlicer treat every
 * letter as its own object that can be moved, rotated or removed independently.
 */
export function meshesTo3mf(objects: NamedMesh[], title = "Applique letters"): Uint8Array {
  const parts: string[] = [];
  parts.push(
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<model unit="millimeter" xml:lang="en-GB" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
    `<metadata name="Title">${escapeXml(title)}</metadata>\n`,
    '<metadata name="Application">Applique Letters</metadata>\n',
    "<resources>\n",
  );
  objects.forEach(({ name, mesh }, i) => {
    parts.push(`<object id="${i + 1}" type="model" name="${escapeXml(name)}"><mesh><vertices>`);
    const v = mesh.positions;
    for (let p = 0; p < v.length; p += 3) parts.push(`<vertex x="${fmt(v[p])}" y="${fmt(v[p + 1])}" z="${fmt(v[p + 2])}"/>`);
    parts.push("</vertices><triangles>");
    const idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) parts.push(`<triangle v1="${idx[t]}" v2="${idx[t + 1]}" v3="${idx[t + 2]}"/>`);
    parts.push("</triangles></mesh></object>\n");
  });
  parts.push("</resources>\n<build>\n");
  objects.forEach((_, i) => parts.push(`<item objectid="${i + 1}"/>\n`));
  parts.push("</build>\n</model>\n");

  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      "3D/3dmodel.model": strToU8(parts.join("")),
    },
    { level: 6 },
  );
}

/** SVG path data for regions, flipping y so the drawing is the right way up on screen/paper. */
export function regionsToPathData(regions: Region[], height: number, dx = 0, dy = 0): string {
  const ring = (r: [number, number][]) =>
    "M" + r.map(([x, y]) => `${fmt(x + dx)} ${fmt(height - y + dy)}`).join("L") + "Z";
  return regions.map((r) => [r.outer, ...r.holes].map(ring).join("")).join("");
}

export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6 });
}

export function downloadBlob(data: Uint8Array | string, filename: string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
