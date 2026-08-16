#!/usr/bin/env python3
"""Attach review-approved 2023 marathon editions to hourly historical weather."""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
JOIN_QUEUE = ROOT / "data" / "reports" / "marathon-weather-join-queue.csv"
RACES = ROOT / "data" / "normalized" / "marathon_races.csv"
OUTPUT = ROOT / "data" / "normalized" / "marathon_weather.csv"
CACHE = ROOT / "data" / "raw" / "weather-cache"
API_URL = "https://archive-api.open-meteo.com/v1/archive"
HOURLY_VARIABLES = [
    "temperature_2m",
    "dew_point_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "precipitation",
    "cloud_cover",
    "shortwave_radiation",
]
REQUIRED_REVIEW_FIELDS = (
    "race_id",
    "race_date",
    "latitude",
    "longitude",
    "timezone",
    "start_time_local",
    "location_source",
)


def clean(value: Any) -> str:
    return "" if value is None else str(value).strip()


def number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def rounded(value: float | None, digits: int = 3) -> float | None:
    return round(value, digits) if value is not None else None


def mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"missing {path.relative_to(ROOT)}; run tools/ingest-race-data.py")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def validate_approved(row: dict[str, str]) -> None:
    missing = [field for field in REQUIRED_REVIEW_FIELDS if not clean(row.get(field))]
    if missing:
        raise ValueError(f"approved race {row.get('race_id')} is missing {', '.join(missing)}")
    latitude = number(row.get("latitude"))
    longitude = number(row.get("longitude"))
    if latitude is None or not -90 <= latitude <= 90:
        raise ValueError(f"approved race {row.get('race_id')} has invalid latitude")
    if longitude is None or not -180 <= longitude <= 180:
        raise ValueError(f"approved race {row.get('race_id')} has invalid longitude")
    datetime.fromisoformat(f"{row['race_date']}T{row['start_time_local']}")


def weather_url(row: dict[str, str]) -> str:
    query = urllib.parse.urlencode({
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "start_date": row["race_date"],
        "end_date": row["race_date"],
        "hourly": ",".join(HOURLY_VARIABLES),
        "models": "era5_seamless",
        "timezone": row["timezone"],
        "temperature_unit": "celsius",
        "wind_speed_unit": "ms",
        "precipitation_unit": "mm",
    })
    return f"{API_URL}?{query}"


def fetch_weather(row: dict[str, str], force: bool) -> dict[str, Any]:
    cache_path = CACHE / f"{row['race_id']}.json"
    if cache_path.exists() and not force:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    request = urllib.request.Request(
        weather_url(row),
        headers={"User-Agent": "EffortCast-research-weather-enrichment/1.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.load(response)
    if payload.get("error"):
        raise RuntimeError(payload.get("reason", "weather provider returned an error"))
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def exposure_indices(hourly: dict[str, list[Any]], start: datetime, duration_seconds: float) -> list[int]:
    timestamps = [datetime.fromisoformat(value) for value in hourly.get("time", [])]
    if not timestamps:
        raise ValueError("weather response contains no hourly timestamps")
    end = start + timedelta(seconds=max(3600, duration_seconds))
    start_index = min(range(len(timestamps)), key=lambda index: abs(timestamps[index] - start))
    indices = [
        index
        for index, timestamp in enumerate(timestamps)
        if index >= start_index and timestamp <= end
    ]
    if not indices:
        indices = [start_index]
    return indices


def values(hourly: dict[str, list[Any]], variable: str, indices: list[int]) -> list[float]:
    series = hourly.get(variable, [])
    parsed = [number(series[index]) for index in indices if index < len(series)]
    return [value for value in parsed if value is not None]


def summarize(row: dict[str, str], race: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    hourly = payload.get("hourly", {})
    start = datetime.fromisoformat(f"{row['race_date']}T{row['start_time_local']}")
    duration_seconds = number(race.get("finish_median_seconds")) or 14400
    indices = exposure_indices(hourly, start, duration_seconds)
    first = indices[0]

    def start_value(variable: str) -> float | None:
        series = hourly.get(variable, [])
        return number(series[first]) if first < len(series) else None

    temperature = values(hourly, "temperature_2m", indices)
    dew_point = values(hourly, "dew_point_2m", indices)
    humidity = values(hourly, "relative_humidity_2m", indices)
    wind = values(hourly, "wind_speed_10m", indices)
    precipitation = values(hourly, "precipitation", indices)
    cloud = values(hourly, "cloud_cover", indices)
    solar = values(hourly, "shortwave_radiation", indices)
    return {
        "race_id": row["race_id"],
        "race_name": row["race_name"],
        "race_date": row["race_date"],
        "weather_source": "Open-Meteo Historical Weather API / ERA5-Seamless",
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "timezone": row["timezone"],
        "start_time_local": row["start_time_local"],
        "location_source": row["location_source"],
        "exposure_hours": rounded(duration_seconds / 3600, 3),
        "hourly_samples": len(indices),
        "temp_start_c": rounded(start_value("temperature_2m")),
        "temp_mean_c": rounded(mean(temperature)),
        "temp_max_c": rounded(max(temperature) if temperature else None),
        "dew_start_c": rounded(start_value("dew_point_2m")),
        "dew_mean_c": rounded(mean(dew_point)),
        "rh_start_pct": rounded(start_value("relative_humidity_2m")),
        "rh_mean_pct": rounded(mean(humidity)),
        "wind_start_mps": rounded(start_value("wind_speed_10m")),
        "wind_mean_mps": rounded(mean(wind)),
        "precip_total_mm": rounded(sum(precipitation) if precipitation else None),
        "cloud_mean_pct": rounded(mean(cloud)),
        "solar_start_w_m2": rounded(start_value("shortwave_radiation")),
        "solar_mean_w_m2": rounded(mean(solar)),
        "solar_max_w_m2": rounded(max(solar) if solar else None),
        "provider_grid_latitude": payload.get("latitude"),
        "provider_grid_longitude": payload.get("longitude"),
        "provider_elevation_m": payload.get("elevation"),
    }


def write_output(rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "race_id", "race_name", "race_date", "weather_source", "latitude", "longitude", "timezone",
        "start_time_local", "location_source", "exposure_hours", "hourly_samples", "temp_start_c",
        "temp_mean_c", "temp_max_c", "dew_start_c", "dew_mean_c", "rh_start_pct", "rh_mean_pct",
        "wind_start_mps", "wind_mean_mps", "precip_total_mm", "cloud_mean_pct", "solar_start_w_m2",
        "solar_mean_w_m2", "solar_max_w_m2", "provider_grid_latitude", "provider_grid_longitude",
        "provider_elevation_m",
    ]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="validate approvals without making API calls")
    parser.add_argument("--force", action="store_true", help="refresh ignored cached provider responses")
    parser.add_argument("--limit", type=int, help="process only the first N approved races")
    args = parser.parse_args()

    queue = load_csv(JOIN_QUEUE)
    races = {row["race_id"]: row for row in load_csv(RACES)}
    approved = [row for row in queue if clean(row.get("review_status")).lower() == "approved"]
    for row in approved:
        validate_approved(row)
        if row["race_id"] not in races:
            raise ValueError(f"approved race {row['race_id']} is missing from normalized race data")
    if args.limit is not None:
        if args.limit < 1:
            raise ValueError("--limit must be positive")
        approved = approved[: args.limit]

    summary = {
        "queue_rows": len(queue),
        "approved_rows": len(approved),
        "unresolved_rows": sum(clean(row.get("review_status")).lower() != "approved" for row in queue),
        "mode": "dry-run" if args.dry_run else "enrich",
    }
    print(json.dumps(summary, indent=2))
    if args.dry_run:
        return 0
    if not approved:
        print("No approved rows. Review the join queue first; no weather request was made.")
        return 0

    enriched = []
    for index, row in enumerate(approved, start=1):
        print(f"weather {index}/{len(approved)}  {row['race_name']}  {row['race_date']}")
        enriched.append(summarize(row, races[row["race_id"]], fetch_weather(row, args.force)))
    write_output(enriched)
    print(f"wrote {len(enriched)} rows to {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
