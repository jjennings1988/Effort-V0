/* Display units.

   The engine is imperial internally — every calibration constant in MODEL.md is
   anchored in °F, mph and minutes per mile, and rewriting them for metric would
   mean re-deriving the whole model. So the forecast is always fetched imperial
   and converted here, at the last possible moment before it hits the screen.

   Three INDEPENDENT settings, not one imperial/metric switch. A British runner
   wants °C and kilograms but very often still runs in miles and min/mile,
   because British road racing is run in miles. Coupling them would have forced
   that athlete into min/km to get Celsius. Body weight in particular has nothing
   to do with pace or the forecast, so tying it to either is arbitrary. */

import { fmtPace, parsePace } from "../engine.js";
import { S } from "./state.js";

export const MILES_PER_KM = 0.621371;
export const KM_PER_MILE = 1.609344;

export const UNIT_FIELDS = {
  temperature: { imperial: "f", metric: "c" },
  distance: { imperial: "mi", metric: "km" },
  weight: { imperial: "lb", metric: "kg" },
};

/* Everywhere except the US, Liberia and Myanmar is metric — except that the UK
   and Ireland keep miles for road distance while using °C and kg. Kept out of
   state.js so that module stays free of browser dependencies. */
export function defaultUnits() {
  let region = "US";
  try {
    region = new Intl.Locale(navigator.language).maximize().region || "US";
  } catch { /* fall through to US */ }

  if (["US", "LR", "MM"].includes(region)) {
    return { temperature: "f", distance: "mi", weight: "lb" };
  }
  if (["GB", "IE"].includes(region)) {
    return { temperature: "c", distance: "mi", weight: "kg" };
  }
  return { temperature: "c", distance: "km", weight: "kg" };
}

export function unit(field) {
  return S.profile.units?.[field] ?? defaultUnits()[field];
}
export const metricTemp = () => unit("temperature") === "c";
export const metricDistance = () => unit("distance") === "km";
export const metricWeight = () => unit("weight") === "kg";

/* ---------- temperature ---------- */
export function temp(f, { unit: withUnit = false } = {}) {
  const v = metricTemp() ? Math.round((f - 32) * 5 / 9) : Math.round(f);
  return withUnit ? `${v}°${metricTemp() ? "C" : "F"}` : `${v}°`;
}
export function tempUnit() { return metricTemp() ? "°C" : "°F"; }

/* A temperature *difference* has no 32° offset. */
export function tempDelta(f) {
  return metricTemp() ? Math.round(f * 5 / 9) : Math.round(f);
}

/* ---------- wind ----------
   Follows the distance setting: if you think in miles you think in mph. */
export function wind(mph) {
  return metricDistance() ? Math.round(mph * 1.609344) : Math.round(mph);
}
export function windUnit() { return metricDistance() ? "KM/H" : "MPH"; }

/* ---------- pace ----------
   Stored canonically as seconds per mile. Displayed per mile or per km. */
export function paceLabel(secPerMile) {
  if (!secPerMile) return "—";
  return fmtPace(metricDistance() ? secPerMile * MILES_PER_KM : secPerMile);
}
export function paceUnit() { return metricDistance() ? "MIN / KM" : "MIN / MI"; }
export function paceUnitShort() { return metricDistance() ? "/km" : "/mi"; }

/* Parse what the athlete typed, in whatever unit they are shown, back to the
   canonical seconds per mile. */
export function parsePaceInput(text) {
  const seconds = parsePace(text);
  if (seconds == null) return null;
  return metricDistance() ? Math.round(seconds * KM_PER_MILE) : seconds;
}
/* And the inverse, for prefilling an input. */
export function paceInputValue(secPerMile) {
  if (!secPerMile) return "";
  return fmtPace(metricDistance() ? secPerMile * MILES_PER_KM : secPerMile);
}

/* ---------- distance ---------- */
export function distance(miles) {
  return metricDistance() ? `${(miles * KM_PER_MILE).toFixed(1)} km` : `${miles.toFixed(1)} mi`;
}

/* ---------- elevation ---------- */
export function elevation(feet) {
  return metricDistance()
    ? `${Math.round(feet * 0.3048).toLocaleString()} m`
    : `${Math.round(feet).toLocaleString()} ft`;
}

/* ---------- body mass ----------
   Stored canonically in kilograms; the drag model works in SI. */
export function massValue(kg) {
  return metricWeight() ? Math.round(kg) : Math.round(kg * 2.20462);
}
export function massUnit() { return metricWeight() ? "KG" : "LB"; }
export function massToKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return metricWeight() ? n : n / 2.20462;
}
