/* Integrity checks for the small, versioned outputs of the race-data pipeline.
   Raw inputs and row-level normalized outputs are deliberately ignored. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";


const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function csv(path) {
  const lines = read(path).trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift());
  return lines.map((line) => Object.fromEntries(
    parseCsvLine(line).map((value, index) => [header[index], value]),
  ));
}

test("committed ingestion report is validated and privacy-safe", () => {
  const summary = json("data/reports/ingestion-summary.json");
  assert.equal(summary.schema_version, 1);
  assert.equal(summary.validation.passed, true);
  assert.equal(summary.marathon_2023.pii_name_exported, false);
  assert.equal(summary.marathon_2023.valid_results, 429266);
  assert.equal(summary.marathon_2023.race_editions, 641);
  assert.equal(summary.endurance_weather.event_rows, 1258);
  assert.equal(summary.endurance_weather.performance_rows, 7869);
});

test("source ledger pins every input and records commercial-use status", () => {
  const manifest = json("data/sources.json");
  assert.equal(manifest.schema_version, 1);
  assert.ok(manifest.sources.length >= 2);
  for (const source of manifest.sources) {
    assert.match(source.id, /\S/);
    assert.match(source.page_url, /^https:\/\//);
    assert.match(source.download_url, /^https:\/\//);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.match(source.license, /\S/);
    assert.match(source.commercial_status, /\S/);
  }
});

test("approved weather joins cannot omit reviewed provenance", () => {
  const rows = csv("data/reports/marathon-weather-join-queue.csv");
  assert.equal(rows.length, 641);
  const required = [
    "race_id", "race_date", "latitude", "longitude", "timezone",
    "start_time_local", "location_source",
  ];
  for (const row of rows.filter((item) => item.review_status === "approved")) {
    for (const field of required) {
      assert.ok(row[field]?.trim(), `${row.race_id || "approved race"} is missing ${field}`);
    }
    assert.ok(Number.isFinite(Number(row.latitude)) && Math.abs(Number(row.latitude)) <= 90);
    assert.ok(Number.isFinite(Number(row.longitude)) && Math.abs(Number(row.longitude)) <= 180);
  }
});

test("raw and row-level normalized data cannot enter Git", () => {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--", "data/raw", "data/normalized"],
    { encoding: "utf8" },
  ).trim();
  assert.equal(tracked, "");
  const ignore = read(".gitignore");
  assert.match(ignore, /^data\/raw\/$/m);
  assert.match(ignore, /^data\/normalized\/$/m);
});
