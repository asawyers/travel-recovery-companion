#!/usr/bin/env python3
"""Build an offline GeoNames inhabited-place catalog using only Python's standard library.

Supply downloaded XX.zip archives (or extracted XX.txt fixtures), admin1CodesASCII.txt,
admin2Codes.txt, and optionally readme.txt. Never fetches data at generation/runtime.
"""
import argparse
import base64
import gzip
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import unicodedata
import zipfile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

COUNTRIES = ('US', 'PR', 'VI', 'GU', 'AS', 'MP')
TERRITORIES = {'PR': 'Puerto Rico', 'VI': 'U.S. Virgin Islands', 'GU': 'Guam',
               'AS': 'American Samoa', 'MP': 'Northern Mariana Islands'}
US_STATES = frozenset('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())
# Current populated places, administrative seats, villages, and inhabited settlements.
# Deliberately excludes PPLX sections, PPLH historical, PPLQ abandoned, PPLW destroyed.
FEATURES = frozenset(('PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLG', 'PPLL', 'PPLR', 'PPLF'))
MAX_ALIASES = 12
MAX_ALIAS_LENGTH = 80


def normalize(value):
    # Match browser NFKD -> remove every Unicode Mark -> lowercase. Casefold
    # changes Cherokee casing and Greek final sigma; combining() misses Mc/Me.
    value = ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.category(c).startswith('M'))
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in value.lower()).split())


def admin_names(path):
    result = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        fields = line.split('\t')
        if len(fields) >= 2:
            result[fields[0]] = fields[1]
    return result


def country_lines(root, country):
    archive = root / (country + '.zip')
    if archive.exists():
        with zipfile.ZipFile(archive) as zipped:
            with zipped.open(country + '.txt') as source:
                for line in source:
                    yield line.decode('utf-8')
    else:
        with (root / (country + '.txt')).open(encoding='utf-8') as source:
            yield from source


def build(root, countries, generated_at):
    admin1 = admin_names(root / 'admin1CodesASCII.txt')
    admin2 = admin_names(root / 'admin2Codes.txt')
    skipped = Counter()
    accepted = {}
    validated_zones = set()
    input_count = 0
    for archive_country in countries:
        for line in country_lines(root, archive_country):
            input_count += 1
            f = line.rstrip('\r\n').split('\t')
            if len(f) != 19:
                skipped['malformed_row'] += 1
                continue
            if f[6] != 'P' or f[7] not in FEATURES:
                skipped['excluded_feature'] += 1
                continue
            country = f[8]
            if country != archive_country or country not in COUNTRIES:
                skipped['invalid_country'] += 1
                continue
            try:
                ident = int(f[0])
                if ident <= 0 or str(ident) != f[0]:
                    raise ValueError()
            except ValueError:
                skipped['invalid_id'] += 1
                continue
            if ident in accepted:
                skipped['duplicate_id'] += 1
                continue
            try:
                lat, lon = float(f[4]), float(f[5])
                if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    raise ValueError()
            except ValueError:
                skipped['invalid_coordinates'] += 1
                continue
            zone = f[17]
            try:
                if not zone or '/' not in zone:
                    raise ValueError()
                if zone not in validated_zones:
                    ZoneInfo(zone)
                    validated_zones.add(zone)
            except (ZoneInfoNotFoundError, ValueError):
                skipped['invalid_timezone'] += 1
                continue
            state = f[10] if country == 'US' else country
            state_name = admin1.get('US.' + state) if country == 'US' else TERRITORIES[country]
            if not state_name or (country == 'US' and state not in US_STATES):
                skipped['invalid_state'] += 1
                continue
            name = f[1].strip()
            if not name:
                skipped['missing_name'] += 1
                continue
            county = admin2.get(country + '.' + f[10] + '.' + f[11])
            if country != 'US' and not county:
                county = admin1.get(country + '.' + f[10])
            # Normalized aliases are internal search keys, never response properties.
            primary = normalize(name)
            aliases = sorted({normalize(a) for a in [f[2], *f[3].split(',')]
                              if a and len(a) <= MAX_ALIAS_LENGTH} - {primary, ''}, key=lambda a: (not a.isascii(), len(a), a))[:MAX_ALIASES]
            try:
                population = max(0, int(f[14] or '0'))
            except ValueError:
                population = 0
            accepted[ident] = (ident, name, state, state_name, country, county, lat, lon, zone, population, '|'.join(aliases))
    # Dictionary encoding avoids repeating state, county, and time-zone strings.
    states = sorted({(r[2], r[3], r[4]) for r in accepted.values()})
    counties = sorted({r[5] for r in accepted.values() if r[5] is not None})
    zones = sorted({r[8] for r in accepted.values()})
    state_index = {value: index for index, value in enumerate(states)}
    county_index = {value: index for index, value in enumerate(counties)}
    zone_index = {value: index for index, value in enumerate(zones)}
    rows = [[r[0], r[1], state_index[(r[2], r[3], r[4])], county_index.get(r[5], -1), r[6], r[7], zone_index[r[8]], r[9], r[10]]
            for r in sorted(accepted.values())]
    inputs = [root / 'admin1CodesASCII.txt', root / 'admin2Codes.txt']
    for country in countries:
        archive = root / (country + '.zip')
        inputs.append(archive if archive.exists() else root / (country + '.txt'))
    if (root / 'readme.txt').exists():
        inputs.append(root / 'readme.txt')
    provenance = [{'file': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'bytes': p.stat().st_size}
                  for p in sorted(inputs)]
    return {'info': {'version': 'geonames-' + generated_at[:10] + '-v1',
                     'source': 'https://download.geonames.org/export/dump/', 'license': 'CC BY 4.0',
                     'recordCount': len(rows), 'generatedAt': generated_at},
            'schema': ['id', 'name', 'stateIndex', 'countyIndex', 'latitude', 'longitude', 'zoneIndex', 'population', 'aliases'],
            'states': states, 'counties': counties, 'zones': zones, 'rows': rows,
            'provenance': provenance, 'report': {'inputRecords': input_count, 'skipped': dict(sorted(skipped.items()))}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--resolver-output', type=Path, help='Optional gzip/base64 TypeScript asset for the server-only resolver')
    parser.add_argument('--countries', nargs='+', choices=COUNTRIES, default=list(COUNTRIES))
    parser.add_argument('--generated-at', default=datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'))
    args = parser.parse_args()
    # Reject malformed vintages rather than silently labelling an unrelated version.
    datetime.fromisoformat(args.generated_at.replace('Z', '+00:00'))
    result = build(args.source_dir, sorted(set(args.countries)), args.generated_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    if args.resolver_output:
        resolver = {key: result[key] for key in ('info', 'states', 'counties', 'zones')}
        resolver['rows'] = [row[:7] for row in result['rows']]
        raw = json.dumps(resolver, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        # A fixed mtime and explicit level make repeated pinned builds byte-identical.
        compressed = base64.b64encode(gzip.compress(raw, compresslevel=9, mtime=0)).decode('ascii')
        args.resolver_output.parent.mkdir(parents=True, exist_ok=True)
        args.resolver_output.write_text('// Generated by scripts/build_city_catalog.py; GeoNames CC BY 4.0. See docs/CITY_DATA.md.\nexport default ' + json.dumps(compressed) + '\n', encoding='utf-8')
    print(f"{len(result['rows'])} records; {args.output.stat().st_size} bytes; skipped {result['report']['skipped']}")


if __name__ == '__main__':
    main()
