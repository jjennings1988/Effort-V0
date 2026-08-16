#!/usr/bin/env python3
"""Normalize the pinned marathon and endurance-weather datasets for EffortCast."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable

try:
    import openpyxl
except ModuleNotFoundError:
    print("openpyxl is required: python -m pip install -r requirements-data.txt", file=sys.stderr)
    raise SystemExit(2)


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
NORMALIZED = ROOT / "data" / "normalized"
REPORTS = ROOT / "data" / "reports"
MANIFEST = ROOT / "data" / "sources.json"
MARATHON_SOURCE = "marathon-us-2023-v5"
WEATHER_SOURCE = "mantzios-weather-14753565-v1"


def clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\u00a0", " ").strip()


def number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def integer(value: Any) -> int | None:
    parsed = number(value)
    return int(parsed) if parsed is not None else None


def seconds(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        value = value.time()
    if isinstance(value, time):
        return value.hour * 3600 + value.minute * 60 + value.second + value.microsecond / 1_000_000
    if isinstance(value, timedelta):
        return value.total_seconds()
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed * 86400 if 0 <= parsed <= 1 else parsed
    text = clean(value)
    match = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)", text)
    if not match:
        return None
    hours = int(match.group(1) or 0)
    return hours * 3600 + int(match.group(2)) * 60 + float(match.group(3))


def iso_date(month: Any, day: Any, year: Any) -> str:
    try:
        return date(int(year), int(month), int(day)).isoformat()
    except (TypeError, ValueError):
        return ""


def parse_us_date(value: str) -> str:
    for pattern in ("%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            pass
    return ""


def sex_code(value: Any) -> str:
    token = clean(value).lower()
    if token in {"m", "male", "men", "man"}:
        return "M"
    if token in {"f", "female", "women", "woman"}:
        return "F"
    if token in {"x", "nb", "non-binary", "nonbinary"}:
        return "X"
    return "U"


def stable_id(prefix: str, *parts: Any) -> str:
    payload = "|".join(clean(part).lower() for part in parts)
    return f"{prefix}_{hashlib.sha1(payload.encode('utf-8')).hexdigest()[:12]}"


def percentile(values: Iterable[float], p: float) -> float | None:
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * p
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def rounded(value: float | None, digits: int = 3) -> float | None:
    return round(value, digits) if value is not None else None


def mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_csv(path: Path, fieldnames: list[str], rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: "" if value is None else value for key, value in row.items()})
            count += 1
    return count


def verify_sources() -> dict[str, dict[str, Any]]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sources = {item["id"]: item for item in manifest["sources"]}
    for source in sources.values():
        path = ROOT / source["raw_file"]
        if not path.exists():
            raise FileNotFoundError(f"missing {path.relative_to(ROOT)}; run tools/fetch-race-data.py")
        actual = sha256(path)
        if actual != source["sha256"]:
            raise ValueError(f"checksum mismatch for {path.relative_to(ROOT)}")
    return sources


def ingest_marathons() -> dict[str, Any]:
    races_path = RAW / "marathon-2023" / "Races.csv"
    results_path = RAW / "marathon-2023" / "Results.csv"
    if not races_path.exists() or not results_path.exists():
        raise FileNotFoundError("marathon CSV files are missing; run tools/fetch-race-data.py")

    races: dict[tuple[str, int], dict[str, Any]] = {}
    with races_path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            race_name = clean(row.get("Race"))
            year = integer(row.get("Year")) or 0
            race_date = parse_us_date(clean(row.get("Date")))
            races[(race_name, year)] = {
                "source_id": MARATHON_SOURCE,
                "race_id": stable_id("m23r", race_name, year, race_date),
                "race_name": race_name,
                "race_date": race_date,
                "year": year,
                "reported_finishers": integer(row.get("Finishers")),
                "finishes": [],
                "sex": Counter(),
                "age_known": 0,
                "result_rows": 0,
                "rejected_rows": 0,
            }

    results_output = NORMALIZED / "marathon_results.csv"
    result_fields = [
        "source_id", "result_id", "race_id", "gender", "age", "age_bracket",
        "finish_seconds", "finish_hours", "age_quality",
    ]
    rejected = 0
    missing_race = 0
    valid_results = 0
    with results_path.open(newline="", encoding="utf-8-sig") as source, results_output.open(
        "w", newline="", encoding="utf-8"
    ) as destination:
        reader = csv.DictReader(source)
        if "Name" not in (reader.fieldnames or []):
            raise ValueError("unexpected marathon result schema")
        writer = csv.DictWriter(destination, fieldnames=result_fields)
        writer.writeheader()
        for source_row, row in enumerate(reader, start=2):
            race_name = clean(row.get("Race"))
            year = integer(row.get("Year")) or 0
            race = races.get((race_name, year))
            if race is None:
                missing_race += 1
                continue
            race["result_rows"] += 1
            finish = number(row.get("Finish"))
            if finish is None or not 5400 <= finish <= 86400:
                race["rejected_rows"] += 1
                rejected += 1
                continue
            age = integer(row.get("Age"))
            age_quality = "known" if age is not None and 10 <= age <= 100 else "missing_or_implausible"
            if age_quality != "known":
                age = None
            else:
                race["age_known"] += 1
            gender = sex_code(row.get("Gender"))
            race["sex"][gender] += 1
            race["finishes"].append(finish)
            valid_results += 1
            # The source Name field is intentionally neither exported nor hashed.
            writer.writerow({
                "source_id": MARATHON_SOURCE,
                "result_id": f"m23_{source_row - 1:07d}",
                "race_id": race["race_id"],
                "gender": gender,
                "age": "" if age is None else age,
                "age_bracket": clean(row.get("Age Bracket")),
                "finish_seconds": int(round(finish)),
                "finish_hours": round(finish / 3600, 5),
                "age_quality": age_quality,
            })

    join_path = REPORTS / "marathon-weather-join-queue.csv"
    existing_joins: dict[str, dict[str, str]] = {}
    if join_path.exists():
        with join_path.open(newline="", encoding="utf-8-sig") as handle:
            existing_joins = {
                clean(row.get("race_id")): row
                for row in csv.DictReader(handle)
                if clean(row.get("race_id"))
            }

    race_rows = []
    mismatched_finishers = 0
    for race in races.values():
        finishes = race.pop("finishes")
        sex_counts = race.pop("sex")
        valid = len(finishes)
        reported = race["reported_finishers"]
        if reported is not None and reported != valid:
            mismatched_finishers += 1
        race_rows.append({
            **race,
            "valid_results": valid,
            "finisher_count_matches": reported == valid,
            "gender_m": sex_counts["M"],
            "gender_f": sex_counts["F"],
            "gender_x": sex_counts["X"],
            "gender_unknown": sex_counts["U"],
            "finish_min_seconds": rounded(min(finishes), 1) if finishes else None,
            "finish_p10_seconds": rounded(percentile(finishes, 0.10), 1),
            "finish_p25_seconds": rounded(percentile(finishes, 0.25), 1),
            "finish_median_seconds": rounded(percentile(finishes, 0.50), 1),
            "finish_p75_seconds": rounded(percentile(finishes, 0.75), 1),
            "finish_p90_seconds": rounded(percentile(finishes, 0.90), 1),
            "finish_max_seconds": rounded(max(finishes), 1) if finishes else None,
            "weather_join_status": clean(existing_joins.get(race["race_id"], {}).get("review_status")) or "unresolved",
        })
    race_rows.sort(key=lambda row: (row["race_date"], row["race_name"]))
    race_fields = [
        "source_id", "race_id", "race_name", "race_date", "year", "reported_finishers",
        "result_rows", "valid_results", "rejected_rows", "finisher_count_matches",
        "gender_m", "gender_f", "gender_x", "gender_unknown", "age_known",
        "finish_min_seconds", "finish_p10_seconds", "finish_p25_seconds",
        "finish_median_seconds", "finish_p75_seconds", "finish_p90_seconds",
        "finish_max_seconds", "weather_join_status",
    ]
    write_csv(NORMALIZED / "marathon_races.csv", race_fields, race_rows)
    mismatch_fields = ["race_id", "race_name", "race_date", "reported_finishers", "valid_results", "delta"]
    mismatch_rows = [
        {
            **{key: row[key] for key in mismatch_fields if key != "delta"},
            "delta": row["valid_results"] - row["reported_finishers"],
        }
        for row in race_rows
        if row["reported_finishers"] is not None and row["reported_finishers"] != row["valid_results"]
    ]
    write_csv(REPORTS / "marathon-finisher-mismatches.csv", mismatch_fields, mismatch_rows)
    join_fields = [
        "race_id", "race_name", "race_date", "reported_finishers", "latitude", "longitude",
        "timezone", "start_time_local", "location_source", "review_status",
    ]
    join_rows = []
    for row in sorted(race_rows, key=lambda item: (-int(item["reported_finishers"] or 0), item["race_name"])):
        existing = existing_joins.get(row["race_id"], {})
        join_rows.append({
            "race_id": row["race_id"], "race_name": row["race_name"], "race_date": row["race_date"],
            "reported_finishers": row["reported_finishers"],
            "latitude": clean(existing.get("latitude")), "longitude": clean(existing.get("longitude")),
            "timezone": clean(existing.get("timezone")), "start_time_local": clean(existing.get("start_time_local")),
            "location_source": clean(existing.get("location_source")),
            "review_status": clean(existing.get("review_status")) or "unresolved",
        })
    write_csv(join_path, join_fields, join_rows)
    return {
        "race_editions": len(race_rows),
        "source_result_rows": valid_results + rejected + missing_race,
        "valid_results": valid_results,
        "rejected_finish_times": rejected,
        "missing_race_keys": missing_race,
        "race_finisher_count_mismatches": mismatched_finishers,
        "weather_join_unresolved_races": sum(row["review_status"] != "approved" for row in join_rows),
        "age_known_results": sum(row["age_known"] for row in race_rows),
        "pii_name_exported": False,
    }


def canonical_race_type(value: Any) -> str:
    token = re.sub(r"[^a-z0-9]+", "", clean(value).lower())
    aliases = {
        "marathon": "marathon", "10k": "10k", "10000m": "10k",
        "5000m": "5k", "5k": "5k", "3000msteeplechase": "3k-steeple",
        "20kmracewalk": "20k-walk", "20kracewalk": "20k-walk",
        "50kmracewalk": "50k-walk", "50kracewalk": "50k-walk",
    }
    return aliases.get(token, token or "unknown")


def ingest_weather_benchmark() -> dict[str, Any]:
    workbook_path = RAW / "endurance-weather-14753565-v1.xlsx"
    workbook = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    worksheet = workbook["Final Database"]
    rows = worksheet.iter_rows(values_only=True)
    header = next(rows)
    if clean(header[0]) != "Competition" or clean(header[14]) != "Air Temperature (C)":
        raise ValueError("unexpected Figshare workbook schema")

    event_rows: list[dict[str, Any]] = []
    performance_rows: list[dict[str, Any]] = []
    group_events: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    group_slowdowns: dict[tuple[str, str], list[float]] = defaultdict(list)
    rank_columns = [(rank, 27 + rank) for rank in range(1, 11)] + [(25, 38), (50, 39), (100, 40), (300, 41)]

    for source_row, values in enumerate(rows, start=2):
        competition = clean(values[0])
        if not competition:
            continue
        race_type = canonical_race_type(values[1])
        gender = sex_code(values[2])
        event_date = iso_date(values[6], values[5], values[7])
        event_id = stable_id("mwe", competition, race_type, gender, event_date, values[3])
        standing = seconds(values[27])
        environment = {
            "air_temp_c": number(values[14]),
            "dew_point_c": number(values[15]),
            "wind_speed_mps": number(values[16]),
            "adjusted_wind_speed_mps": number(values[17]),
            "relative_humidity_pct": number(values[18]),
            "cloud_okta": number(values[19]),
            "solar_radiation_w_m2": number(values[22]),
            "heat_index_c": number(values[23]),
            "simplified_wbgt_c": number(values[24]),
            "wbgt_outdoor_c": number(values[25]),
        }
        available = 0
        for rank, column in rank_columns:
            finish = seconds(values[column])
            if finish is None or finish <= 0:
                continue
            available += 1
            slowdown = ((finish / standing) - 1) * 100 if standing and standing > 0 else None
            performance_rows.append({
                "source_id": WEATHER_SOURCE,
                "event_id": event_id,
                "rank": rank,
                "finish_seconds": rounded(finish, 3),
                "standing_record_seconds": rounded(standing, 3),
                "slowdown_vs_standing_pct": rounded(slowdown, 5),
            })
            if slowdown is not None:
                group_slowdowns[(race_type, gender)].append(slowdown)

        event = {
            "source_id": WEATHER_SOURCE,
            "event_id": event_id,
            "competition": competition,
            "race_type": race_type,
            "gender": gender,
            "host_city": clean(values[3]),
            "country": clean(values[4]),
            "event_date": event_date,
            "start_time_local": clean(values[8]),
            "latitude": number(values[9]),
            "longitude": number(values[10]),
            "noaa_station_id": clean(values[11]),
            "station_location": clean(values[12]),
            "station_distance_km": number(values[13]),
            **environment,
            "observation_time_delta_min": number(values[20]),
            "timezone_utc_offset_hours": number(values[21]),
            "world_record_seconds": rounded(seconds(values[26]), 3),
            "standing_record_seconds": rounded(standing, 3),
            "ranked_performances_available": available,
            "weather_complete": all(environment[key] is not None for key in (
                "air_temp_c", "dew_point_c", "adjusted_wind_speed_mps", "solar_radiation_w_m2", "wbgt_outdoor_c"
            )),
        }
        event_rows.append(event)
        group_events[(race_type, gender)].append(event)

    event_fields = [
        "source_id", "event_id", "competition", "race_type", "gender", "host_city", "country",
        "event_date", "start_time_local", "latitude", "longitude", "noaa_station_id", "station_location",
        "station_distance_km", "air_temp_c", "dew_point_c", "wind_speed_mps", "adjusted_wind_speed_mps",
        "relative_humidity_pct", "cloud_okta", "solar_radiation_w_m2", "heat_index_c", "simplified_wbgt_c",
        "wbgt_outdoor_c", "observation_time_delta_min", "timezone_utc_offset_hours", "world_record_seconds",
        "standing_record_seconds", "ranked_performances_available", "weather_complete",
    ]
    performance_fields = [
        "source_id", "event_id", "rank", "finish_seconds", "standing_record_seconds", "slowdown_vs_standing_pct",
    ]
    event_rows.sort(key=lambda row: (row["event_date"], row["race_type"], row["gender"], row["competition"]))
    performance_rows.sort(key=lambda row: (row["event_id"], row["rank"]))
    write_csv(NORMALIZED / "endurance_weather_events.csv", event_fields, event_rows)
    write_csv(NORMALIZED / "endurance_weather_performances.csv", performance_fields, performance_rows)

    summary_rows = []
    for key in sorted(group_events):
        events = group_events[key]
        years = [int(row["event_date"][:4]) for row in events if row["event_date"]]
        temperatures = [row["air_temp_c"] for row in events if row["air_temp_c"] is not None]
        dew_points = [row["dew_point_c"] for row in events if row["dew_point_c"] is not None]
        wbgts = [row["wbgt_outdoor_c"] for row in events if row["wbgt_outdoor_c"] is not None]
        solar = [row["solar_radiation_w_m2"] for row in events if row["solar_radiation_w_m2"] is not None]
        slowdowns = group_slowdowns[key]
        summary_rows.append({
            "race_type": key[0], "gender": key[1], "event_count": len(events),
            "performance_count": len(slowdowns), "year_min": min(years) if years else None,
            "year_max": max(years) if years else None, "air_temp_min_c": rounded(min(temperatures), 2) if temperatures else None,
            "air_temp_mean_c": rounded(mean(temperatures), 2), "air_temp_max_c": rounded(max(temperatures), 2) if temperatures else None,
            "dew_point_mean_c": rounded(mean(dew_points), 2), "wbgt_mean_c": rounded(mean(wbgts), 2),
            "solar_mean_w_m2": rounded(mean(solar), 2), "slowdown_median_pct": rounded(percentile(slowdowns, 0.5), 3),
            "weather_complete_events": sum(bool(row["weather_complete"]) for row in events),
        })
    summary_fields = [
        "race_type", "gender", "event_count", "performance_count", "year_min", "year_max",
        "air_temp_min_c", "air_temp_mean_c", "air_temp_max_c", "dew_point_mean_c", "wbgt_mean_c",
        "solar_mean_w_m2", "slowdown_median_pct", "weather_complete_events",
    ]
    write_csv(REPORTS / "weather-benchmark-summary.csv", summary_fields, summary_rows)
    workbook.close()
    return {
        "event_rows": len(event_rows),
        "performance_rows": len(performance_rows),
        "weather_complete_events": sum(bool(row["weather_complete"]) for row in event_rows),
        "event_date_min": min((row["event_date"] for row in event_rows if row["event_date"]), default=None),
        "event_date_max": max((row["event_date"] for row in event_rows if row["event_date"]), default=None),
        "race_types": dict(sorted(Counter(row["race_type"] for row in event_rows).items())),
        "gender_counts": dict(sorted(Counter(row["gender"] for row in event_rows).items())),
    }


def main() -> int:
    NORMALIZED.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    sources = verify_sources()
    print("ingest marathon cohort")
    marathon = ingest_marathons()
    print("ingest endurance-weather benchmark")
    weather = ingest_weather_benchmark()

    outputs = {}
    for path in sorted(NORMALIZED.glob("*.csv")):
        outputs[str(path.relative_to(ROOT)).replace("\\", "/")] = {
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
    report = {
        "schema_version": 1,
        "source_versions": {
            source_id: {
                "sha256": source["sha256"],
                "license": source["license"],
                "commercial_status": source["commercial_status"],
            }
            for source_id, source in sources.items()
        },
        "marathon_2023": marathon,
        "endurance_weather": weather,
        "normalized_outputs": outputs,
        "validation": {
            "passed": (
                marathon["race_editions"] == 641
                and marathon["valid_results"] >= 400_000
                and marathon["missing_race_keys"] == 0
                and weather["event_rows"] == 1258
                and weather["weather_complete_events"] >= 1200
            ),
            "weather_independence_note": "Marathon finishers are nested within race editions; weather n equals race editions, not athletes.",
            "privacy_note": "Runner names are present only in ignored raw input and are never exported or hashed.",
        },
    }
    report_path = REPORTS / "ingestion-summary.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "marathon_races": marathon["race_editions"],
        "marathon_results": marathon["valid_results"],
        "weather_events": weather["event_rows"],
        "weather_performances": weather["performance_rows"],
        "validation_passed": report["validation"]["passed"],
    }, indent=2))
    return 0 if report["validation"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
