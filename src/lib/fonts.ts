import { BUNDLED_FONTS as CORE_FONTS, fontFamilyName, parseFont, type FontChoice } from "@indigolabsltd/applique-core";

import fredoka from "@fontfiles/fredoka/files/fredoka-latin-700-normal.woff?url";
import luckiestGuy from "@fontfiles/luckiest-guy/files/luckiest-guy-latin-400-normal.woff?url";
import titanOne from "@fontfiles/titan-one/files/titan-one-latin-400-normal.woff?url";
import lilitaOne from "@fontfiles/lilita-one/files/lilita-one-latin-400-normal.woff?url";
import chewy from "@fontfiles/chewy/files/chewy-latin-400-normal.woff?url";
import sniglet from "@fontfiles/sniglet/files/sniglet-latin-800-normal.woff?url";
import baloo2 from "@fontfiles/baloo-2/files/baloo-2-latin-800-normal.woff?url";
import rubik from "@fontfiles/rubik/files/rubik-latin-800-normal.woff?url";
import poppins from "@fontfiles/poppins/files/poppins-latin-800-normal.woff?url";
import archivoBlack from "@fontfiles/archivo-black/files/archivo-black-latin-400-normal.woff?url";
import anton from "@fontfiles/anton/files/anton-latin-400-normal.woff?url";
import bebasNeue from "@fontfiles/bebas-neue/files/bebas-neue-latin-400-normal.woff?url";
import passionOne from "@fontfiles/passion-one/files/passion-one-latin-700-normal.woff?url";
import bungee from "@fontfiles/bungee/files/bungee-latin-400-normal.woff?url";
import righteous from "@fontfiles/righteous/files/righteous-latin-400-normal.woff?url";
import alfaSlabOne from "@fontfiles/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff?url";
import abrilFatface from "@fontfiles/abril-fatface/files/abril-fatface-latin-400-normal.woff?url";
import shrikhand from "@fontfiles/shrikhand/files/shrikhand-latin-400-normal.woff?url";
import lobster from "@fontfiles/lobster/files/lobster-latin-400-normal.woff?url";
import pacifico from "@fontfiles/pacifico/files/pacifico-latin-400-normal.woff?url";

export {
  defaultWeight,
  googleFontChoice,
  loadFont,
  loadGoogleCatalogue,
  type CatalogueFont,
  type FontCategory,
  type FontChoice,
} from "@indigolabsltd/applique-core";

/** URLs of the bundled font files, which Vite copies into the build. */
const FILES: Record<string, string> = {
  fredoka: fredoka,
  "luckiest-guy": luckiestGuy,
  "titan-one": titanOne,
  "lilita-one": lilitaOne,
  chewy: chewy,
  sniglet: sniglet,
  "baloo-2": baloo2,
  rubik: rubik,
  poppins: poppins,
  "archivo-black": archivoBlack,
  anton: anton,
  "bebas-neue": bebasNeue,
  "passion-one": passionOne,
  bungee: bungee,
  righteous: righteous,
  "alfa-slab-one": alfaSlabOne,
  "abril-fatface": abrilFatface,
  shrikhand: shrikhand,
  lobster: lobster,
  pacifico: pacifico,
};

/** The bundled fonts, pointing at the copies that ship with the app so they work offline. */
export const BUNDLED_FONTS: FontChoice[] = CORE_FONTS.map((f) => ({ ...f, url: FILES[f.fontsource!.id] }));

const faces = new Set<string>();

/** CSS font-family name used to preview a choice in the UI. */
export function cssFamily(choice: FontChoice): string {
  return `al-${choice.key.replace(/[^a-z0-9]+/gi, "-")}`;
}

/** Register a FontFace so the font name can be previewed in its own typeface. */
export function registerPreviewFace(choice: FontChoice) {
  if (faces.has(choice.key) || typeof document === "undefined") return;
  faces.add(choice.key);
  const source = choice.buffer ?? `url(${JSON.stringify(choice.url)})`;
  const face = new FontFace(cssFamily(choice), source as string | ArrayBuffer, { weight: "100 900" });
  document.fonts.add(face);
  face.load().catch(() => faces.delete(choice.key));
}

export async function uploadedFontChoice(file: File): Promise<FontChoice> {
  const buffer = await file.arrayBuffer();
  const family = fontFamilyName(parseFont(buffer, file.name)) ?? file.name.replace(/\.[^.]+$/, "");
  return { key: `upload:${file.name}:${file.size}`, family, weight: 400, source: "upload", buffer };
}
