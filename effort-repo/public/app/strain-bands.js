/* Thermal-load bands shared by every tape, ledger and dial. Boundaries follow
   strainLabel() in the engine; "near capacity" (3.5) is where a tape cell goes
   hollow and the athlete is told to ease off. */
export const STRAIN_BANDS = [
  { max: 1, key: "free", tone: "ideal", label: "FREE COOLING" },
  { max: 2, key: "mild", tone: "good", label: "MILD LOAD" },
  { max: 3.5, key: "working", tone: "adjust", label: "WORKING TO COOL" },
  { max: 5, key: "near", tone: "caution", label: "NEAR CAPACITY" },
  { max: Infinity, key: "outrun", tone: "avoid", label: "COOLING OUTRUN" },
];
export const EASE_OFF_STRAIN = 3.5;
export const strainBand = (s) => STRAIN_BANDS.findIndex((b) => s < b.max);
/* Radial length for a load index on a dial: square-root so ordinary days
   are legible, saturating at 8 ("cooling overwhelmed" territory). */
export const strainV = (s) => 0.1 + 0.9 * Math.sqrt(Math.max(0, Math.min(1, s / 8)));
