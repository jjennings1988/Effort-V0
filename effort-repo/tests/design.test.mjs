/* Design-system guarantees that are easy to lose in a stylesheet edit.

   The rating palette carries meaning on the dial, the heatmap, the tapes and
   the hour cells, often as the only encoding. It must stay readable for the
   one in twelve men with a red-green colour-vision deficiency: every pair of
   neighbouring ratings stays at least ΔE 15 apart (CIE76 in L*a*b*) under
   simulated deuteranopia and protanopia (Machado et al. 2009, severity 1),
   and lightness falls steadily from Ideal to Avoid so the order also survives
   grayscale. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const RATINGS = ["ideal", "good", "adjust", "caution", "high", "avoid"];

const SIM = {
  normal: null,
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
};
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function lab(hex, m = null) {
  let v = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  if (m) v = m.map((row) => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
  const [r, g, b] = v;
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* Every theme's value of a custom property, in source order: light first. */
function themes(name) {
  return [...CSS.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map((m) => m[1].toLowerCase());
}

test("rating fills are defined for light and dark", () => {
  for (const r of [...RATINGS, "storm"]) assert.equal(themes(`rate-${r}`).length, 2, `--rate-${r} needs a light and a dark value`);
});

for (const [theme, at] of [["light", 0], ["dark", 1]]) {
  const pal = Object.fromEntries([...RATINGS, "storm"].map((r) => [r, themes(`rate-${r}`)[at]]));

  test(`${theme}: rating fills get steadily darker from Ideal to Avoid`, () => {
    const L = RATINGS.map((r) => lab(pal[r])[0]);
    for (let i = 1; i < L.length; i++) {
      assert.ok(L[i - 1] - L[i] >= 7, `${RATINGS[i - 1]} → ${RATINGS[i]} lightness step is only ${(L[i - 1] - L[i]).toFixed(1)}`);
    }
  });

  for (const [vision, m] of Object.entries(SIM)) {
    test(`${theme}: neighbouring ratings stay distinct with ${vision}`, () => {
      for (let i = 1; i < RATINGS.length; i++) {
        const d = dE(lab(pal[RATINGS[i - 1]], m), lab(pal[RATINGS[i]], m));
        assert.ok(d >= 15, `${RATINGS[i - 1]} vs ${RATINGS[i]}: ΔE ${d.toFixed(1)} with ${vision}`);
      }
      for (const r of RATINGS) {
        const d = dE(lab(pal.storm, m), lab(pal[r], m));
        assert.ok(d >= 15, `storm vs ${r}: ΔE ${d.toFixed(1)} with ${vision}`);
      }
    });
  }
}

test("the simulation reproduces the review's measurement of the old palette", () => {
  // Adjust (#8c6600) vs Caution (#a6540c) collapsed to ΔE 0.6 for deuteranopes.
  assert.equal(dE(lab("#8c6600", SIM.deuteranopia), lab("#a6540c", SIM.deuteranopia)).toFixed(1), "0.6");
});

test("fills use the rating ramp, and text on a fill stays readable", () => {
  for (const sel of [".wh-cell.tone-", ".hour-cell.tone-", ".inst-legend .t-", ".curve-seg.tone-"]) {
    for (const r of RATINGS) {
      const rule = CSS.slice(CSS.indexOf(`${sel}${r}{`), CSS.indexOf("}", CSS.indexOf(`${sel}${r}{`)));
      assert.match(rule, new RegExp(`var\\(--rate-${r}\\)`), `${sel}${r} should fill from --rate-${r}`);
    }
  }
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [theme, at] of [["light", 0], ["dark", 1]]) {
    for (const r of RATINGS) {
      const fill = themes(`rate-${r}`)[at];
      const on = themes(`on-${r}`)[Math.min(at, themes(`on-${r}`).length - 1)];
      assert.ok(contrast(fill, on) >= 4.5, `${theme} ${r}: text ${on} on ${fill} is ${contrast(fill, on).toFixed(2)}:1`);
    }
  }
});

/* Type: read outdoors, mid-run, in glare. Nothing below an 11px caption,
   12px for anything tappable or numeric, explanations as sentences. */
const NC = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Every rule whose selector list is exactly `sel` (including inside media queries).
const rulesFor = (sel) => [...NC.matchAll(new RegExp(`(^|[}\\s,])${escapeRe(sel)}\\{([^}]*)\\}`, "g"))].map((m) => m[2]);
const sizeOf = (body) => {
  const m = body.match(/font(?:-size)?:\s*([^;]+)/);
  if (!m) return null;
  if (/var\(--fs-label\)/.test(m[1])) return 12;
  if (/var\(--fs-cap\)/.test(m[1])) return 11;
  if (/var\(--fs-note\)/.test(m[1])) return 13;
  if (/var\(--fs-body\)/.test(m[1])) return 14;
  const px = m[1].match(/(\d+(?:\.\d+)?)px/);
  return px ? Number(px[1]) : null;
};

test("no text is set below the 11px caption floor", () => {
  const small = [...NC.matchAll(/font(?:-size)?:\s*([^;}]+)/g)]
    .filter((m) => { const px = m[1].match(/(\d+(?:\.\d+)?)px/); return px && Number(px[1]) < 11; })
    .map((m) => m[0]);
  assert.deepEqual(small, [], "text below 11px");
  assert.match(NC, /small\{font-size:max\(var\(--fs-cap\),\.83em\)\}/, "the browser's `smaller` must not undercut the floor");
});

test("tappable and numeric text is at least 12px", () => {
  for (const sel of [".view-nav button", ".board-times button", ".chip", ".answer-chip", ".bc-cell s,.br-pace s",
    ".bc-cell small", ".hour-cell .hour-rating", ".plan-detail", ".zone-row", ".fit-pred em", ".ledger-row"]) {
    const sizes = rulesFor(sel).map(sizeOf).filter((v) => v != null);
    assert.ok(sizes.length, `${sel}: no font size found`);
    for (const v of sizes) assert.ok(v >= 12, `${sel} is ${v}px`);
  }
});

test("explanations read as sentences, not uppercase mono", () => {
  for (const sel of [".section-title-block p", ".inst-tape p", ".hours-hint", ".inst-foot", ".fit-curve-note", ".curve-help", ".br-name small"]) {
    const rules = rulesFor(sel);
    assert.ok(rules.length, `${sel} missing`);
    for (const r of rules) assert.doesNotMatch(r, /text-transform:uppercase/, `${sel} should not shout`);
    assert.ok(rules.some((r) => /font-family:var\(--sans\)/.test(r)), `${sel} should be set in the sans`);
  }
});
