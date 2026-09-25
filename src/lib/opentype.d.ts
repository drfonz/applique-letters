// Minimal typings for the parts of opentype.js 2.x that this project uses.
declare module "opentype.js" {
  export type PathCommand =
    | { type: "M"; x: number; y: number }
    | { type: "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" };

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    index: number;
    name: string | null;
    unicode?: number;
    advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: Record<string, Record<string, string> | undefined>;
    tables: {
      os2?: { sCapHeight?: number; sxHeight?: number };
      [key: string]: unknown;
    };
    charToGlyph(char: string): Glyph;
    hasChar(char: string): boolean;
  }

  export function parse(buffer: ArrayBuffer): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
