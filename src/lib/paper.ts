import { nest } from "./nest";
import { buildPlates } from "./plates";
import { regionsToPathData } from "./export";
import { boundsOf } from "./geometry";
import type { LetterTemplate } from "./templates";

const A4 = { width: 210, depth: 297 };

/**
 * Lay the letter outlines out on A4 pages at 1:1 scale and open the browser's print dialog.
 * Useful for cutting paper or freezer-paper templates, or checking sizes before printing in 3D.
 */
export function printPaperTemplates(templates: LetterTemplate[], copies: number[], title: string) {
  const items = templates.flatMap((_, shape) => Array.from({ length: copies[shape] ?? 1 }, (_, i) => ({ shape, copy: i + 1 })));
  const result = nest(templates, items, {
    bedWidth: A4.width,
    bedDepth: A4.depth,
    margin: 12,
    spacing: 6,
    allowRotation: false,
    timeBudgetMs: 400,
  });
  const pages = buildPlates(templates, result, A4);

  const svgPages = pages.map((page, i) => {
    const paths = page.letters
      .map((l) => {
        const b = boundsOf(l.regions);
        const d = regionsToPathData(l.regions, A4.depth);
        const name = l.template.char;
        return (
          `<path d="${d}" fill="#fdf2f4" fill-rule="evenodd" stroke="#222" stroke-width="0.35"/>` +
          `<text x="${(b.minX + b.maxX) / 2}" y="${A4.depth - b.minY + 4}" font-size="3" text-anchor="middle" fill="#888">${escape(name)}</text>`
        );
      })
      .join("");
    return `<section class="page"><svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">
      ${paths}
      <g font-family="sans-serif" fill="#666" font-size="3">
        <text x="12" y="8">${escape(title)} · page ${i + 1} of ${pages.length}</text>
        <line x1="12" y1="290" x2="62" y2="290" stroke="#222" stroke-width="0.4"/>
        <line x1="12" y1="288" x2="12" y2="292" stroke="#222" stroke-width="0.4"/>
        <line x1="62" y1="288" x2="62" y2="292" stroke="#222" stroke-width="0.4"/>
        <text x="66" y="291">50 mm. Measure this line to check you printed at 100% (actual size).</text>
      </g></svg></section>`;
  });

  const tooBig = result.unplaced.length
    ? `<p class="warn">Some letters are larger than an A4 page and were left out.</p>`
    : "";
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escape(title)}</title>
    <style>
      @page { size: A4 portrait; margin: 0; }
      html, body { margin: 0; padding: 0; background: #eee; }
      .page { width: 210mm; height: 297mm; background: #fff; margin: 8mm auto; box-shadow: 0 1px 6px rgba(0,0,0,.2); page-break-after: always; overflow: hidden; }
      .page:last-child { page-break-after: auto; }
      svg { display: block; }
      .warn { font: 14px sans-serif; text-align: center; color: #a00; }
      @media print { html, body { background: none; } .page { margin: 0; box-shadow: none; } .warn { display: none; } }
    </style></head><body>${tooBig}${svgPages.join("")}
    <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));</script></body></html>`;

  const win = window.open("", "_blank");
  if (!win) throw new Error("Please allow pop-ups to print paper templates.");
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function escape(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}
