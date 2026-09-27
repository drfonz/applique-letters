# Appliqué Letters

Generate 3D-printable **letter templates for appliqué banners, bunting and quilts**, entirely in your browser.

Type the words for a banner (or pick exactly the letters you need), choose a font from Google Fonts, set the size,
and download print-ready plates for your 3D printer. Trace round each template onto fabric, cut out (pinking shears
work beautifully), and stitch the letters onto your backing fabric.

It is a static site: no server, no account, nothing uploaded anywhere.

Made by [Indigo Labs Studio](https://indigolabs.studio).

## Features

- **Any letters you like.** Type banner words ("HAPPY BIRTHDAY") or pick a subset of A–Z, a–z, 0–9 and symbols.
  Choose one template per distinct letter, or one for every letter in the text, and adjust copies per letter.
- **Built-in shapes.** Hearts, stars and circles to put between words, plus seasonal families: ghosts, pumpkins, bats, spiders and witches’ hats for Halloween; trees, gifts, baubles, snowflakes, snowmen, holly and candy canes for Christmas; eggs, bunnies and chicks for Easter. There are balloons, birthday cakes, party hats and bunting flags for celebrations; rings and doves for weddings; baby grows, rubber ducks, prams and rattles for babies; diyas, lotuses and rangoli flowers for Diwali; crescent moons, a moon and star and a fanous lantern for Eid and Ramadan; a menorah, dreidel and Star of David for Hanukkah; lanterns, firecrackers, fans and blossom for Lunar New Year; and a rainbow for Pride. Every shape is kept chunky enough to trace and cut out of fabric. “Add shape” opens a searchable picker with whichever family is in season listed first. Shapes show as tokens in the text box (click one to remove it), and typing the emoji (👻 🎃 🎄 ❄ 🐰 🎂 🪔 🌙 🕎 🏮 …) works too.
- **Fonts.** 20 hand-picked chunky Google Fonts ship with the app (so they work offline), you can search and use any of
  the 1,800+ Google Fonts at any weight, or upload your own TTF, OTF or WOFF file.
- **Sizes that make sense for sewing.** Letter height is the capital height, so every letter in a set matches. Add a
  seam allowance for needle-turn appliqué, or mirror the letters for fusible web.
- **Filament saver (on by default).** Each template is printed as a solid border to trace round, with an open
  diagonal lattice inside to keep it flat and stiff. That uses roughly half the filament of a solid template; parts
  too thin for a lattice stay solid, and so does the spot under a grip handle.
- **Filament estimates that match the slicer.** Weights follow how slicers print (solid top and bottom layers, walls
  and sparse infill between), for the whole set and for each plate. Pick your filament, or type the density from your
  slicer's filament settings.
- **Grip handle (optional).** A knob near the middle of each letter lets the template be held flat with a single
  fingertip while tracing, which helps anyone who finds spreading their fingers difficult. It is placed on solid
  material close to the letter's centre of mass, never overhangs the outline, prints upright without supports, and
  is made thinner automatically on narrow letters.
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

Requires Node.js 22 or later. The repository is an npm workspace: the web app lives at the root and the geometry
engine is published separately as [`@indigolabs/applique-core`](packages/core), so other projects can build the same
templates.

```bash
npm install
npm run dev        # start the dev server
npm test           # geometry, mesh and nesting tests (in packages/core)
npm run typecheck  # app and core
npm run build      # static site in dist/
npm run build:core # compile the core package to packages/core/dist
```

The UI is React 19 + TypeScript + Vite, styled with Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com) components
(in `src/components/ui`). The 3D preview uses three.js and is loaded on demand. In development the app compiles the
core package straight from its source, so there is no build step between editing the two.

### Project layout

```
packages/core/src/   @indigolabs/applique-core: runs in browsers and in Node
  geometry.ts        glyph flattening, polygon clean-up and offsetting
  templates.ts       builds a template (outline) for each character
  shapes.ts          built-in shapes (hearts, stars, celebrations, festivals)
  lattice.ts         filament saver: solid border with an open lattice inside
  filament.ts        printed volume and weight, as a slicer prints it
  mesh.ts            watertight extrusion
  handle.ts          optional grip handle: placement and solid
  nest.ts            plate optimiser
  plates.ts          nesting output as per-plate layouts
  printers.ts        printer presets and keep-out areas
  export.ts          STL, 3MF, SVG and ZIP writers
  fonts.ts           bundled font list, Google Fonts catalogue, font parsing
src/
  lib/               app-only code: bundled font files, Web Worker, paper printing, downloads
  components/        app components; ui/ holds the shadcn components
```

### Releasing the core package

Bump `version` in `packages/core/package.json`, then push a tag such as `core-v0.2.0`. The release workflow builds,
tests and publishes the package to npm with provenance.

## Deploying

The included GitHub Actions workflow publishes the site to GitHub Pages on every push to `main`. Pages has to be
switched on once by hand (the workflow's token is not allowed to do it): in the repository go to
**Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. On the free plan the repository
must be public; the deploy job is skipped while it is private. Because the build uses relative paths, `dist/` can also be
hosted on Netlify, Vercel, Cloudflare Pages or any static host.

## Contributing

Ideas, bug reports and pull requests are very welcome. Some things on the wish list:

- A small engraved label on each template (useful for telling "b", "d", "p" and "q" apart).
- Optional connecting bridges for letters with separate parts (the dot on an "i").
- More shapes (leaves, animals, sports), and more festivals: suggestions welcome.

## Licence

Code: [MIT](LICENSE), © 2026 [Indigo Labs Studio](https://indigolabs.studio) and contributors. The bundled fonts are
from [Google Fonts](https://fonts.google.com) via [Fontsource](https://fontsource.org) and are released under the SIL
Open Font License; the fonts' own licences apply to them.
