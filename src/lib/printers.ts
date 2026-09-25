import type { KeepOut } from "./nest";

export interface PrinterPreset {
  id: string;
  name: string;
  width: number;
  depth: number;
  /**
   * Bambu Studio adds a prime tower when the AMS, smooth timelapse or nozzle-wrapping detection
   * needs one, and places it by frame type: CoreXY printers at x = 165 mm, bed-slingers
   * ("i3") at the left, both against the back edge.
   */
  primeTower?: "corexy" | "i3";
  /** Corner at the front-left that the printer never prints on (mm), e.g. the X1's purge area. */
  excludeFrontLeft?: { width: number; depth: number };
}

// Bambu Studio's bed_exclude_area for the X1 and P1 series.
const X1_EXCLUDE = { width: 18, depth: 28 };

/** Build plate sizes (mm). */
export const PRINTERS: PrinterPreset[] = [
  {
    id: "bambu-x1",
    name: "Bambu Lab X1 Carbon / X1E",
    width: 256,
    depth: 256,
    primeTower: "corexy",
    excludeFrontLeft: X1_EXCLUDE,
  },
  {
    id: "bambu-p1",
    name: "Bambu Lab P1S / P1P",
    width: 256,
    depth: 256,
    primeTower: "corexy",
    excludeFrontLeft: X1_EXCLUDE,
  },
  { id: "bambu-a1", name: "Bambu Lab A1", width: 256, depth: 256, primeTower: "i3" },
  { id: "bambu-a1-mini", name: "Bambu Lab A1 mini", width: 180, depth: 180, primeTower: "i3" },
  { id: "bambu-h2d", name: "Bambu Lab H2D (single nozzle)", width: 325, depth: 320, primeTower: "corexy" },
  { id: "prusa-mk4", name: "Prusa MK4 / MK3S+", width: 250, depth: 210 },
  { id: "prusa-mini", name: "Prusa MINI", width: 180, depth: 180 },
  { id: "ender-3", name: "Creality Ender-3 (V2/V3)", width: 220, depth: 220 },
  { id: "custom", name: "Custom size", width: 200, depth: 200 },
];

// Bambu Studio's defaults (PartPlate.cpp, PrintConfig.cpp): the tower's front-left corner starts
// at (165, 250), or (0, 250) on i3 printers, then is pulled 15 mm inside the plate edges. A
// single-colour tower for thin templates is at most 35 mm across, plus an automatic brim.
const TOWER_DEFAULT_X = { corexy: 165, i3: 0 };
const TOWER_EDGE_MARGIN = 15;
const TOWER_SIZE = 35;
const TOWER_BRIM = 5;
const TOWER_CLEARANCE = 3;

/** Area to keep clear so Bambu Studio's prime tower does not land on a letter. */
export function primeTowerZone(printer: PrinterPreset, bed: { width: number; depth: number }): KeepOut | null {
  if (!printer.primeTower) return null;
  const x = Math.max(
    TOWER_EDGE_MARGIN,
    Math.min(TOWER_DEFAULT_X[printer.primeTower], bed.width - TOWER_SIZE - TOWER_EDGE_MARGIN),
  );
  const pad = TOWER_BRIM + TOWER_CLEARANCE;
  const left = Math.max(0, x - pad);
  const right = Math.min(bed.width, x + TOWER_SIZE + pad);
  const front = Math.max(0, bed.depth - TOWER_EDGE_MARGIN - TOWER_SIZE - pad);
  return { x: left, y: front, width: right - left, depth: bed.depth - front, kind: "prime-tower" };
}

/** Areas of the bed the nesting must leave empty for this printer. */
export function keepOutAreas(
  printer: PrinterPreset,
  bed: { width: number; depth: number },
  primeTower: boolean,
): KeepOut[] {
  const areas: KeepOut[] = [];
  if (printer.excludeFrontLeft) {
    const { width, depth } = printer.excludeFrontLeft;
    areas.push({ x: 0, y: 0, width: width + TOWER_CLEARANCE, depth: depth + TOWER_CLEARANCE, kind: "excluded" });
  }
  const tower = primeTower ? primeTowerZone(printer, bed) : null;
  if (tower) areas.push(tower);
  return areas;
}
