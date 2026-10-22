#!/usr/bin/env python3
"""Offline, checksum-pinned OurAirports/GeoNames airport catalog generation.

Only an airport identity match AND airport geometry <= 5 km can supply a zone.
No populated-place records, municipal zones, or nearest-airport guesses are used.
"""
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import unicodedata
import zipfile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

COUNTRIES = ('US', 'PR', 'VI', 'GU', 'AS', 'MP')
KINDS = frozenset(('large_airport', 'medium_airport', 'small_airport'))
COMMIT = 'b529623d2a0b09a9be78d37fc7a7a5e1e16e3451'
VERSION = 'ourairports-geonames-2026-10-22-v1'
PINS = {
    'airports.csv': '0499dbd88de2fc735ac5c09f59796ccc3af544e17ffda807f793c0c6fe6c3d75',
    'US.zip': 'cdd03480fdd93b63e1466099e89b33a8d56954d91966428d5534f47f16caafcf',
    'AS.zip': '73d4dff4c3e3e4f6ca853a2203f43a081a158e1043ac52dfc47b73ed1c3aa5e8',
    'GU.zip': '0bdb3cd00b3bf37d1e9e2003d276bb0e5d2bef2e0269fef41d41e696885312ed',
    'MP.zip': 'f5e917bbb1264cec1ead7d3f7c6c71741935756e9e56ecd2cfe617da8a0bf6e0',
    'PR.zip': '0ed1707f2fc16c26d7db3d252ed8fc67294961bc9a0c9b41154a263d7d1d24c2',
    'VI.zip': '61e32549c85498cd3d967f08827bccab40e22ca358cbf7c1f160cd7d16f7a504',
}


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def normalize(value):
    value = ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.category(c).startswith('M'))
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in value.lower()).split())


def coordinates(lat, lon):
    lat, lon = float(lat), float(lon)
    if not math.isfinite(lat) or not math.isfinite(lon) or abs(lat) > 90 or abs(lon) > 180:
        raise ValueError('invalid coordinates')
    return lat, lon


def distance(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, h)))


def source_info(path, allow_unpinned):
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    if not allow_unpinned and PINS.get(path.name) != checksum:
        raise ValueError(f'pinned checksum mismatch: {path.name}; review upstream changes before updating PINS')
    airport = path.name == 'airports.csv'
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': checksum,
            'url': f'https://raw.githubusercontent.com/davidmegginson/ourairports-data/{COMMIT}/airports.csv' if airport else f'https://download.geonames.org/export/dump/{path.name}',
            'license': 'Unlicense (public domain)' if airport else 'CC-BY-4.0',
            'licenseUrl': f'https://github.com/davidmegginson/ourairports-data/blob/{COMMIT}/LICENSE' if airport else 'https://creativecommons.org/licenses/by/4.0/'}


def geonames_lines(path, country):
    if path.suffix == '.zip':
        with zipfile.ZipFile(path) as archive, archive.open(country + '.txt') as stream:
            yield from (line.decode('utf-8') for line in stream)
    else:
        with path.open(encoding='utf-8') as stream:
            yield from stream


def build(airport_csv, root, countries, allow_unpinned):
    sources = [source_info(airport_csv, allow_unpinned)]
    # Index only actual AIRP features by exact normalized names and aliases.
    identity = defaultdict(list)
    for country in countries:
        source = root / (country + '.zip')
        if not source.exists():
            source = root / (country + '.txt')
        sources.append(source_info(source, allow_unpinned))
        for line in geonames_lines(source, country):
            f = line.rstrip('\r\n').split('\t')
            if len(f) != 19 or f[6] != 'S' or f[7] != 'AIRP' or f[8] != country or not f[0].isdigit():
                continue
            try:
                point = coordinates(f[4], f[5])
            except ValueError:
                continue
            feature = (int(f[0]), point, f[17])
            for alias in {normalize(v) for v in [f[1], f[2], *f[3].split(',')] if v.strip()}:
                identity[(country, alias)].append(feature)
    with airport_csv.open(encoding='utf-8', newline='') as stream:
        candidates = [r for r in csv.DictReader(stream) if r['iso_country'] in countries and r['scheduled_service'] == 'yes' and r['type'] in KINDS and r['iata_code'].strip()]
    iata_count = Counter(r['iata_code'].strip().upper() for r in candidates)
    omissions, rows = [], []
    seen_omissions = set()
    for airport in sorted(candidates, key=lambda r: (r['iata_code'], r['id'])):
        iata, country = airport['iata_code'].strip().upper(), airport['iso_country']
        reason = None
        matches = {}
        if iata_count[iata] != 1:
            reason = 'duplicate_iata'
        elif not re.fullmatch('[A-Z]{3}', iata):
            reason = 'invalid_iata'
        else:
            try:
                point = coordinates(airport['latitude_deg'], airport['longitude_deg'])
                if not airport['name'].strip() or not airport['id'].isdigit() or not airport['iso_region'].startswith(country + '-'):
                    raise ValueError('invalid metadata')
            except ValueError:
                reason = 'invalid_metadata'
            if reason is None:
                # Strong identifiers or the complete airport name, never a city name.
                aliases = [iata, airport['ident'], airport.get('icao_code', ''), airport.get('gps_code', ''), airport['name']]
                for alias in {normalize(v) for v in aliases if v}:
                    for feature in identity.get((country, alias), []):
                        if distance(point, feature[1]) <= 5:
                            matches[feature[0]] = feature
                if not matches:
                    reason = 'no_airport_identity_within_5km'
                else:
                    zones = {f[2] for f in matches.values()}
                    if len(zones) != 1:
                        reason = 'ambiguous_airport_timezone'
                    else:
                        zone = next(iter(zones))
                        try:
                            if not zone or '/' not in zone:
                                raise ValueError('missing timezone')
                            ZoneInfo(zone)
                        except (ValueError, ZoneInfoNotFoundError):
                            reason = 'missing_or_invalid_airport_timezone'
        if reason:
            if iata not in seen_omissions:
                omissions.append({'iata': iata, 'reason': reason})
                seen_omissions.add(iata)
            continue
        provenance = f'OurAirports:{airport["id"]};GeoNames:' + ','.join(str(i) for i in sorted(matches))
        state = airport['iso_region'][len(country)+1:] if country == 'US' else country
        rows.append([iata, airport['name'].strip(), point[0], point[1], zone, provenance, country, state, airport['municipality'].strip(), airport['type']])
    info = {'version': VERSION, 'ourAirportsCommit': COMMIT, 'pinnedInputs': not allow_unpinned,
            'sourceSnapshot': '2026-10-22 (GeoNames archives downloaded 2026-10-21 UTC)',
            'maxMatchDistanceKm': 5, 'scheduledAirportCount': len(candidates), 'airportCount': len(rows),
            'countries': dict(sorted(Counter(r[6] for r in rows).items())),
            'rowsSha256': hashlib.sha256(compact(rows).encode()).hexdigest(), 'sources': sources, 'omissions': omissions}
    return {'info': info, 'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ourairports-csv', type=Path, required=True)
    parser.add_argument('--geonames-dir', type=Path, required=True)
    parser.add_argument('--countries', nargs='+', choices=COUNTRIES, default=list(COUNTRIES))
    parser.add_argument('--allow-unpinned-inputs', action='store_true', help='Only for synthetic fixtures or explicit source review; labels output unpinned')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = build(args.ourairports_csv, args.geonames_dir, tuple(sorted(set(args.countries))), args.allow_unpinned_inputs)
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')
    args.output.write_text(compact(result) + '\n', encoding='utf-8')
    print(f'{len(result["rows"])} airports; {len(result["info"]["omissions"])} omitted IATA codes; {args.output.stat().st_size} bytes')


if __name__ == '__main__':
    main()
