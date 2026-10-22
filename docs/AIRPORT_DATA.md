# Airport metadata

The checked-in `ourairports-geonames-2026-10-22-v1` catalog contains **642 scheduled airports** with an IATA code, airport name, WGS84 airport coordinates, verified airport-specific IANA time zone, jurisdiction, and source record IDs. It uses a separate **102,720-byte** module asset; importing airport metadata does not load the national city catalog.

## Sources, attribution, and snapshot identity

Airport identity, location, municipality, region, type, IATA code, and scheduled-service classification come from [OurAirports](https://ourairports.com/data/). The [official repository README](https://github.com/davidmegginson/ourairports-data/blob/b529623d2a0b09a9be78d37fc7a7a5e1e16e3451/README.md) identifies its official daily download and documents upstream maintenance. The exact airport snapshot is pinned to commit `b529623d2a0b09a9be78d37fc7a7a5e1e16e3451`; its [LICENSE](https://github.com/davidmegginson/ourairports-data/blob/b529623d2a0b09a9be78d37fc7a7a5e1e16e3451/LICENSE) dedicates the data to the public domain under the Unlicense. OurAirports is a community-maintained source, not an aviation regulator or a guarantee of current commercial service.

Time zones come from actual `S`/`AIRP` records in [GeoNames country extracts](https://download.geonames.org/export/dump/), **not populated places**. Contains information from [GeoNames](https://www.geonames.org/), licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Preserve that attribution in distributions using this derived catalog. Its [readme](https://download.geonames.org/export/dump/readme.txt) documents the tab-separated fields and source limitations. This project filters and joins records, validates coordinates and IANA time zones, and encodes the resulting airport metadata.

The GeoNames archives are the same source files downloaded on 2026-10-21 UTC for the existing city catalog. The `2026-10-22` version labels this project snapshot; it is not a claim that each record was surveyed that day. GeoNames daily URLs are mutable: **the SHA-256 checksums identify the immutable inputs**, and regeneration rejects changed inputs by default. Keep the exact downloaded archives to reproduce this version. A fresh daily download may need a separately reviewed source/pin/version update.

| Original source | Bytes | SHA-256 |
| --- | ---: | --- |
| `airports.csv` | 12,748,669 | `0499dbd88de2fc735ac5c09f59796ccc3af544e17ffda807f793c0c6fe6c3d75` |
| `AS.zip` | 35,222 | `73d4dff4c3e3e4f6ca853a2203f43a081a158e1043ac52dfc47b73ed1c3aa5e8` |
| `GU.zip` | 52,953 | `0bdb3cd00b3bf37d1e9e2003d276bb0e5d2bef2e0269fef41d41e696885312ed` |
| `MP.zip` | 46,681 | `f5e917bbb1264cec1ead7d3f7c6c71741935756e9e56ecd2cfe617da8a0bf6e0` |
| `PR.zip` | 280,474 | `0ed1707f2fc16c26d7db3d252ed8fc67294961bc9a0c9b41154a263d7d1d24c2` |
| `US.zip` | 71,108,487 | `cdd03480fdd93b63e1466099e89b33a8d56954d91966428d5534f47f16caafcf` |
| `VI.zip` | 72,412 | `61e32549c85498cd3d967f08827bccab40e22ca358cbf7c1f160cd7d16f7a504` |

The official airport file is available at the [immutable raw GitHub URL](https://raw.githubusercontent.com/davidmegginson/ourairports-data/b529623d2a0b09a9be78d37fc7a7a5e1e16e3451/airports.csv). The generated JSON contains each source URL, license URL, byte size, and checksum. The complete generated asset SHA-256 is `2650db92c0f7f34933c415964e549a06192573bfa557fe0ef76f3e067622fd8b`; its compact rows payload SHA-256 is `8c5c72fd5905daeb96e5b8eb78561492121b0a650a41f61efb1dc96db9b64f58`.

## Acceptance and omissions

The generator accepts OurAirports records in `US`, `PR`, `VI`, `GU`, `AS`, and `MP` with `scheduled_service=yes`, a nonempty three-letter IATA code, and type `large_airport`, `medium_airport`, or `small_airport`. It excludes closed airports, heliports, seaplane bases, and unscheduled facilities. Coordinates must be finite and in range. Duplicate eligible IATA codes are rejected entirely rather than choosing one arbitrarily.

A time zone requires both:

1. An exact normalized match between the OurAirports IATA/ICAO/GPS/ident code or complete airport name and a GeoNames airport name or alternate name, in the same country.
2. Airport-to-airport coordinates no more than **5 km** apart, measured with a great-circle distance.

Normalization removes Unicode marks, ignores punctuation, lowercases, and collapses spaces. A nearby airport alone is insufficient. All matched GeoNames airport records must agree on one nonempty valid IANA zone; conflicting, missing, and invalid zones reject the airport. Python `zoneinfo` validates the zone during generation, and the integrity test validates every zone with JavaScript `Intl`.

The join uses neither a nearest populated city's zone nor the trip's endpoint city zone. A timezone-boundary airport can have a different zone from the city it serves; flight normalization must resolve **every flight segment's airport**, including intermediate airports. Unknown or omitted codes remain unavailable, so callers can reject unsupported schedules explicitly. A code is not inferred from a municipality or a metropolitan code such as `NYC`.

Of 651 eligible scheduled records, 642 are retained:

| Country/territory | Retained airports |
| --- | ---: |
| US | 625 |
| PR | 8 |
| VI | 2 |
| GU | 1 |
| AS | 3 |
| MP | 3 |

The nine omitted IATA codes are **IKO, INL, KMO, KQA, MGC, MRI, SGU, WWT, XWA**. In this snapshot each omission is `no_airport_identity_within_5km`. These may reflect source naming/alias, classification, geometry, or source coverage gaps, including relocated airports; no guessed zone is substituted. Every omission and its reason is recorded in `info.omissions`. This source-based catalog does not establish live route, seat, fare, opening-hours, or booking availability.

## API and provenance

`airport-metadata.ts` exports the dependency-free type `AirportMetadata` with exactly `iata`, `name`, `latitude`, `longitude`, `timeZone`, `metadataSource`, `countryCode`, `stateCode`, `municipality`, and `kind` fields. Use a type-only import when only the type is needed. Territories use their country code as `stateCode`; U.S. records use the region suffix (for example `CA`). `municipality` is the source string and can be empty.

`metadataSource` identifies the exact matched records as `OurAirports:<numeric id>;GeoNames:<numeric id>[,<numeric id>...]`. IDs can be inspected at `https://ourairports.com/airports/<ident>/` using the pinned CSV's ID-to-ident mapping, and `https://www.geonames.org/<numeric id>/`. The generated asset's source manifest establishes which snapshot these IDs refer to.

`findAirport(iata)` trims whitespace and accepts case-insensitive three-letter airport codes, returns a fresh exact-shape DTO, and returns `undefined` for unknown/invalid codes. It never guesses an airport or zone.

`nearestAirports({ latitude, longitude }, { limit?, radiusKm? })` returns `{ airport, distanceKm }` entries ordered by increasing great-circle distance, with IATA as a stable tie breaker. Defaults are three airports within 200 km. Radius zero is allowed; invalid coordinates, nonfinite/negative radii, and nonfinite/less-than-one limits return an empty list. Fractional positive limits are rounded down. A returned airport's zone always comes from its own verified airport record. Proximity is only an airport-discovery aid; it does not verify a ground transfer, connection, or scheduled flight.

## Offline rebuild and checks

The generator uses only Python's standard library and system IANA data. It performs no network calls, reads no account/API credentials, and makes no paid provider requests. Supply the exact pinned airport CSV and six GeoNames ZIP files outside the repository:

```sh
python3 scripts/generate-airport-catalog.py \
  --ourairports-csv /tmp/travel-airport-ourairports/airports.csv \
  --geonames-dir /tmp/travel-city-geonames \
  --output supabase/functions/_shared/domain/airport-data.generated.json
npm test -- tests/domain/airport-metadata.test.ts
deno check supabase/functions/_shared/domain/airport-metadata.ts
npm run typecheck
```

The same inputs produce identical output bytes; there is no current-time value in generation. `--allow-unpinned-inputs` is for synthetic fixture data or an explicit source review, labels output `pinnedInputs=false`, and must not be used to silently replace a production snapshot. Fixture tests also accept extracted country `XX.txt` files, allowing duplicates, missing airport identities, conflicting/missing/invalid zones, wrong countries and non-airport features to be exercised without downloading data.
