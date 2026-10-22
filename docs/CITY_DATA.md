# City catalog

The app uses a versioned, offline GeoNames inhabited-place catalog. Version `geonames-2026-10-22-v1` contains **171,671 places** across all 50 US states, Washington DC, Puerto Rico, the US Virgin Islands, Guam, American Samoa, and the Northern Mariana Islands. The catalog label/generation instant is `2026-10-22T00:00:00Z`. It identifies this checked-in snapshot; it does not mean every place was surveyed or updated at that instant. Upstream daily archives can change, so use the checksums below to identify the exact source inputs.

## Attribution and source

Contains information from [GeoNames](https://www.geonames.org/), licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). The data was downloaded from [GeoNames country extracts](https://download.geonames.org/export/dump/); the upstream [readme](https://download.geonames.org/export/dump/readme.txt) documents fields, licensing, and its accuracy/completeness limitations. No account, API key, paid service, or runtime download is required. This project filters, validates, normalizes names, bounds aliases, and encodes those records as described below. Preserve this attribution in distributions using this catalog.

GeoNames IDs are represented as `geonames:<positive integer>`. Place latitude/longitude use WGS84 decimal degrees. Time zones come from GeoNames IANA zone IDs and are validated with Python `zoneinfo` during generation. The checked-in integrity test also validates every distinct zone through JavaScript `Intl`.

## Coverage and transformations

The generator reads all features from the `US`, `PR`, `VI`, `GU`, `AS`, and `MP` archives, rather than using the population-filtered `cities500` dataset. It accepts feature class `P` and codes `PPL`, `PPLA`, `PPLA2`, `PPLA3`, `PPLA4`, `PPLA5`, `PPLC`, `PPLG`, `PPLL`, `PPLR`, and `PPLF`: current populated places, administrative seats, villages, and inhabited settlements. There is no minimum population. Monowi, Nebraska, for example, remains searchable.

Historical (`PPLH`), abandoned (`PPLQ`), destroyed (`PPLW`), neighborhood/section (`PPLX`), and other feature classes/codes are excluded. These are source classifications, not a claim that every retained record has recently verified occupancy. The catalog includes unincorporated communities and other populated settlements, and is not restricted to incorporated municipal governments.

| Country/territory | Retained places |
| --- | ---: |
| AS | 127 |
| GU | 26 |
| MP | 40 |
| PR | 2,471 |
| US | 168,785 |
| VI | 222 |

Of **2,254,704 input records**, 2,083,018 were excluded by feature classification and 15 had an unsupported/missing US state code; 171,671 remained. No other rejection category occurred in this snapshot. The generator explicitly counts malformed rows, invalid IDs, duplicate IDs, invalid countries/states/coordinates/time zones, and missing names when encountered. The complete rejection report is in the generated JSON. Coordinates must be finite and within latitude/longitude bounds; missing or invalid time zones are excluded rather than guessed. County names may be null when upstream administrative metadata does not resolve them.

US state codes/names and counties resolve through the administrative files. For territories the public state code/name is the territory itself (`PR`, `VI`, `GU`, `AS`, or `MP`); county names use the source's second-level division, falling back to its first-level division when available. Those are county equivalents, not necessarily US-style counties.

For internal search the generator normalizes the ASCII name and source alternate names, removes the primary-name duplicate, and retains at most 12 aliases of at most 80 source characters. Short ASCII aliases are preferred to keep common abbreviations such as NYC while bounding storage. Generation and query normalization both apply NFKD, remove every Unicode Mark category, and lowercase (not casefold), preserving consistent Cherokee and Greek final-sigma aliases. Search also normalizes primary names, ignores accents/punctuation, and matches word prefixes with state names/codes and county names for disambiguation. Bounded aliases mean some upstream alternate spellings/languages are unavailable. Results rank exact names/aliases first, then full primary names, then primary-name prefixes, using source population and ID as deterministic tie breakers. Population influences ranking only; it does not exclude small places.

This is broad national coverage, **not an exhaustive or authoritative guarantee of every US city or settlement**. Source omissions, errors, stale classifications, aliases, deleted IDs, duplicate real-world places under different IDs, and missing administrative metadata can remain. A place center is an estimate for travel planning, not a street address, station, airport, legal boundary, or proof of route availability. Server code must resolve the selected ID to catalog data rather than trusting caller-provided coordinates or zones.

## Packaging and API

`city-types.ts` exports the dependency-free `City` interface. Browser code should import it with `import type` and dynamically import `city-catalog.ts` only when search is needed. That module exports `searchCities(query, limit = 8)`, `findCity(id)`, and `catalogInfo`. Search requires 2–200 input characters after the documented checks, returns no results for blank/overlong input or invalid limits, and caps output at 20. Debounce browser input by at least 150 ms; this is a full local scan, not an instant remote index. A worker may be appropriate if slower-device profiling shows main-thread delays.

The full generated JSON has **14,043,063 bytes** (**4,953,610 bytes gzip**, Python gzip with `mtime=0`). Dictionary-encoded state/county/zone strings and ID-sorted compact rows avoid a global expanded `City[]`, ID map, or second per-place search-key index. Binary lookup expands only the selected record. Aliases and population never appear on public `City` objects.

Edge/server consumers should import `findCity` from **`city-resolver.ts`**. Its separate generated TypeScript source is **3,901,472 bytes**, including an embedded gzip/base64 payload. The payload inflates to 9,146,113 bytes of compact resolver JSON (2,926,021 gzip bytes) and contains only authoritative City fields, dictionaries, and version metadata. It omits aliases and population entirely. Standard `DecompressionStream('gzip')` runs once during server module initialization using top-level await; the exported lookup is synchronous after module import. The browser module remains independent and does not load this resolver or use top-level await.

Both data sources are embedded code/module imports, not runtime `static_files` or filesystem reads. The smaller resolver provides deployment headroom, but these source sizes do not establish final SDK-inclusive Edge bundle size or runtime memory. Verify those with the actual Supabase bundler/runtime before deployment.

One local Node 24 measurement with explicit GC before/after import: browser catalog cold import 119 ms, retained heap +44.1 MB, RSS +132 MB; six searches took 96–106 ms each and 100,000 binary lookups took 15.1 ms. The isolated server resolver imported in 183 ms, retained heap +45.3 MB, RSS +181 MB, and 100,000 lookups took 15.1 ms. RSS includes Node TypeScript loading and transient allocations. These are development-machine observations, not browser/Edge limits, peak-memory guarantees, or performance budgets. The Edge SDK must be measured together with the resolver.

## Rebuild and validate

Use Python 3 with system IANA time-zone data. Download all six country archives plus `admin1CodesASCII.txt`, `admin2Codes.txt`, and `readme.txt` from the upstream directory into a temporary source directory. Keep original source archives outside the repository. The generator is offline and supports extracted `XX.txt` fixtures as an alternative to zipped country data.

```sh
python3 scripts/build_city_catalog.py \
  --source-dir /tmp/travel-city-geonames \
  --generated-at 2026-10-22T00:00:00Z \
  --output supabase/functions/_shared/domain/city-data.generated.json \
  --resolver-output supabase/functions/_shared/domain/city-resolver.generated.ts
npm test -- tests/domain/city-catalog.test.ts
npm run typecheck
```

Regenerate both assets together. A fixed generation instant, identical inputs, and the same Python/zlib environment reproduce identical output bytes. The fixture test verifies filtering, duplicate rejection, finite coordinates, valid zones, zero-population retention, source hashes, Unicode spacing-mark removal, and deterministic generation of both assets. Real-catalog tests cover Portland state ambiguity, Springfield county/state disambiguation, small communities, accents/aliases, stable-ID round trips, limits/invalid IDs, supported jurisdictions, every record's coordinates, every zone, Cherokee/Greek alias normalization, and server/browser resolution parity for all 171,671 records plus exact catalog metadata.

| Original input | Bytes | SHA-256 |
| --- | ---: | --- |
| `AS.zip` | 35,222 | `73d4dff4c3e3e4f6ca853a2203f43a081a158e1043ac52dfc47b73ed1c3aa5e8` |
| `GU.zip` | 52,953 | `0bdb3cd00b3bf37d1e9e2003d276bb0e5d2bef2e0269fef41d41e696885312ed` |
| `MP.zip` | 46,681 | `f5e917bbb1264cec1ead7d3f7c6c71741935756e9e56ecd2cfe617da8a0bf6e0` |
| `PR.zip` | 280,474 | `0ed1707f2fc16c26d7db3d252ed8fc67294961bc9a0c9b41154a263d7d1d24c2` |
| `US.zip` | 71,108,487 | `cdd03480fdd93b63e1466099e89b33a8d56954d91966428d5534f47f16caafcf` |
| `VI.zip` | 72,412 | `61e32549c85498cd3d967f08827bccab40e22ca358cbf7c1f160cd7d16f7a504` |
| `admin1CodesASCII.txt` | 151,583 | `b577baa3476bbe94f0454545e517e1835401d79c5b1105c8e02cf1d4a505e8ec` |
| `admin2Codes.txt` | 2,366,358 | `9a02d20e82cbfd1713d13546ac73c8756c0b09096f7c7900a8d6fa6a0763c93d` |
| `readme.txt` | 8,843 | `b1957379b6c1242c700c98ac9a8aa0a09f56c3c0a50ee72175527005f48ef2c5` |
