// opentype.js 2.x ships no typings; the shapes it returns are described in font-types.ts.
declare module "opentype.js" {
  const opentype: { parse(buffer: ArrayBuffer): import("./font-types.js").Font };
  export default opentype;
}
