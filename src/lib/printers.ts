export interface PrinterPreset {
  id: string;
  name: string;
  width: number;
  depth: number;
}

/** Build plate sizes (mm). */
export const PRINTERS: PrinterPreset[] = [
  { id: "bambu-x1", name: "Bambu Lab X1 Carbon / X1E", width: 256, depth: 256 },
  { id: "bambu-p1", name: "Bambu Lab P1S / P1P", width: 256, depth: 256 },
  { id: "bambu-a1", name: "Bambu Lab A1", width: 256, depth: 256 },
  { id: "bambu-a1-mini", name: "Bambu Lab A1 mini", width: 180, depth: 180 },
  { id: "bambu-h2d", name: "Bambu Lab H2D (single nozzle)", width: 325, depth: 320 },
  { id: "prusa-mk4", name: "Prusa MK4 / MK3S+", width: 250, depth: 210 },
  { id: "prusa-mini", name: "Prusa MINI", width: 180, depth: 180 },
  { id: "ender-3", name: "Creality Ender-3 (V2/V3)", width: 220, depth: 220 },
  { id: "custom", name: "Custom size", width: 200, depth: 200 },
];
