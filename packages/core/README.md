# @indigolabs/applique-core

The geometry engine behind [Appliqué Letters](https://github.com/drfonz/applique-letters): it turns letters and shapes
into templates for appliqué, bunting and quilting, and writes them out for 3D printing. It runs in browsers and in
Node.js 22+, with no DOM needed.

- **Outlines** from any TTF, OTF or WOFF font (via opentype.js), sized by capital height, with optional seam allowance
  and mirroring.
- **Built-in shapes**: hearts, stars, circles and seasonal families.
- **Filament saver**: a solid border to trace round, with an open diagonal lattice inside.
- **Grip handles**, placed on solid material near the centre of mass.
- **Printed weight** as a slicer would print it.
- **Plate nesting** by real outlines, in quarter turns, to minimise the number of build plates.
- **Exports**: STL, 3MF (one named object per letter), SVG path data and ZIP.

```ts
import { readFile } from "node:fs/promises";
import { buildTemplates, latticeRegions, parseFont, printedVolume, grams } from "@indigolabs/applique-core";

const file = await readFile("Fredoka-Bold.woff");
const font = parseFont(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const { templates } = buildTemplates(font, [..."HELLO"], {
  letterHeight: 100, // mm, capital height
  outlineOffset: 0,
  layers: 6,
  layerHeight: 0.2,
  mirror: false,
});
for (const t of templates) {
  const body = latticeRegions(t.regions, { enabled: true, border: 4, spacing: 10 });
  console.log(t.char, grams(printedVolume(body, { thickness: 1.2, layerHeight: 0.2 }), 1.24).toFixed(1), "g");
}
```

`BUNDLED_FONTS` lists the fonts the app ships; each one names its file in the matching `@fontsource` package
(`@fontsource/<id>/files/<file>`), which you install and load yourself.

MIT © Indigo Labs Studio and contributors.
