# Appliqué Letters

Generate 3D-printable **letter templates for appliqué banners, bunting and quilts**, entirely in your browser.

Type the words for a banner (or pick exactly the letters you need), choose a font from Google Fonts, set the size,
and download print-ready plates for your 3D printer. Trace round each template onto fabric, cut out (pinking shears
work beautifully), and stitch the letters onto your backing fabric.

It is a static site: no server, no account, nothing uploaded anywhere.

## Features

- **Any letters you like.** Type banner words ("HAPPY BIRTHDAY") or pick a subset of A–Z, a–z, 0–9 and symbols.
  Choose one template per distinct letter, or one for every letter in the text, and adjust copies per letter.
- **Built-in shapes.** Hearts, stars and circles to put between words.
- **Fonts.** 20 hand-picked chunky Google Fonts ship with the app (so they work offline), you can search and use any of
  the 1,800+ Google Fonts at any weight, or upload your own TTF, OTF or WOFF file.
- **Sizes that make sense for sewing.** Letter height is the capital height, so every letter in a set matches. Add a
  seam allowance for needle-turn appliqué, or mirror the letters for fusible web.
- **Plate optimiser.** Letters are nested by their real outlines (not bounding boxes) and rotated in quarter turns to
  interlock, then a local search tries hundreds of orderings to **minimise the number of build plates**. It shows the
  theoretical minimum so you know how close it got.
- **Exports**
  - `.3mf` per plate, with each letter as its own named object, laid out on the plate, ready for Bambu Studio,
    OrcaSlicer or PrusaSlicer.
  - `.stl` per plate or per letter.
  - `.zip` with everything, plus 1:1 SVG outlines for cutting machines and laser cutters.
  - **Print on paper**: letters laid out on A4 pages at actual size, with a 50 mm ruler to check the scale.
- Printer presets for Bambu Lab X1, P1, A1, A1 mini and H2D, Prusa and Creality, or any custom bed size.

## How it works

1. **Outlines**: fonts are parsed with [opentype.js](https://github.com/opentypejs/opentype.js); curves are flattened
   into polygons.
2. **Clean-up**: [Clipper](https://github.com/junmer/clipper-lib) merges overlapping contours (common in variable fonts),
   finds holes (the counters in A, B, O…) and grows or shrinks the outline for the seam allowance.
3. **Solid**: each outline is triangulated with [earcut](https://github.com/mapbox/earcut) and extruded into a closed,
   watertight mesh. Tests check every edge is shared by exactly two triangles and the volume is right.
4. **Nesting** (`src/lib/nest.ts`, in a Web Worker):
   - Each letter is grown by half the requested gap and rasterised on a fine grid, in four orientations.
   - Letters are dropped onto plates one by one (first fit), each at the lowest position where it fits, using
     per-row prefix sums for fast collision checks and skipping ahead past blocked cells.
   - A local search reorders the letters (swaps, moves, and pulling letters off the emptiest plate) and keeps any
     arrangement with fewer plates, or with the early plates packed more densely.

## Development

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # start the dev server
npm test           # geometry, mesh and nesting tests
npm run typecheck
npm run build      # static site in dist/
```

The UI is React 19 + TypeScript + Vite, styled with Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com) components
(in `src/components/ui`). The 3D preview uses three.js and is loaded on demand.

### Project layout

```
src/
  lib/
    geometry.ts   glyph flattening, polygon clean-up and offsetting, built-in shapes
    templates.ts  builds a template (outline) for each character
    mesh.ts       watertight extrusion
    nest.ts       plate optimiser (runs in nest.worker.ts)
    export.ts     STL, 3MF, SVG and ZIP writers
    fonts.ts      bundled fonts and the Google Fonts catalogue
    paper.ts      A4 paper templates
  components/     app components; ui/ holds the shadcn components
```

## Deploying

The included GitHub Actions workflow publishes the site to GitHub Pages on every push to `main` once the repository
is public (Settings → Pages → Source: GitHub Actions). Because the build uses relative paths, `dist/` can also be
hosted on Netlify, Vercel, Cloudflare Pages or any static host.

## Contributing

Ideas, bug reports and pull requests are very welcome. Some things on the wish list:

- A small engraved label on each template (useful for telling "b", "d", "p" and "q" apart).
- Optional connecting bridges for letters with separate parts (the dot on an "i").
- More shapes (flowers, bunting flags, leaves).

## Licence

Code: [MIT](LICENSE). The bundled fonts are from [Google Fonts](https://fonts.google.com) via
[Fontsource](https://fontsource.org) and are released under the SIL Open Font License; the fonts' own licences apply
to them.
