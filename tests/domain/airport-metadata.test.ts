import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const implementation = () => import('@domain/airport-metadata').catch(() => null)
const fields = ['iata', 'name', 'latitude', 'longitude', 'timeZone', 'metadataSource', 'countryCode', 'stateCode', 'municipality', 'kind'].sort()

describe('verified airport metadata', () => {
  it('resolves airport-specific zones for endpoints and major connecting hubs', async () => {
    const m = await implementation(); expect(m, 'airport metadata must exist').not.toBeNull()
    for (const [iata, timeZone] of Object.entries({ SAN: 'America/Los_Angeles', PWM: 'America/New_York', BOS: 'America/New_York', ATL: 'America/New_York', ORD: 'America/Chicago', DFW: 'America/Chicago', DEN: 'America/Denver', PHX: 'America/Phoenix', JFK: 'America/New_York', LAX: 'America/Los_Angeles', ANC: 'America/Anchorage', HNL: 'Pacific/Honolulu', SJU: 'America/Puerto_Rico', STT: 'America/St_Thomas', GUM: 'Pacific/Guam', PPG: 'Pacific/Pago_Pago', SPN: 'Pacific/Saipan' })) {
      const airport = m!.findAirport(iata)
      expect(airport, iata).toMatchObject({ iata, timeZone })
      expect(Object.keys(airport!).sort()).toEqual(fields)
      expect(airport!.metadataSource).toMatch(/^OurAirports:\d+;GeoNames:\d+(,\d+)*$/)
    }
    expect(m!.findAirport(' san ')?.iata).toBe('SAN')
    for (const bad of ['ZZZ', 'NYC', '', 'KSAN', 'SAN;BOS']) expect(m!.findAirport(bad)).toBeUndefined()
  })

  it('returns fresh airport DTOs and nearby airports by radius and distance', async () => {
    const m = await implementation(); expect(m).not.toBeNull()
    const san = m!.findAirport('SAN')!
    const nearest = m!.nearestAirports(san)
    expect(nearest[0].airport.iata).toBe('SAN')
    expect(nearest[0].distanceKm).toBe(0)
    expect(nearest).toHaveLength(3)
    expect(nearest.every((r, i) => r.distanceKm <= 200 && (!i || r.distanceKm >= nearest[i - 1].distanceKm))).toBe(true)
    expect(m!.nearestAirports(san, { radiusKm: 0, limit: 10 }).map(r => r.airport.iata)).toEqual(['SAN'])
    expect(m!.nearestAirports(san, { limit: 1 })).toHaveLength(1)
    expect(Object.keys(nearest[0].airport).sort()).toEqual(fields)
    san.timeZone = 'Etc/UTC'
    expect(m!.findAirport('SAN')?.timeZone).toBe('America/Los_Angeles')
    for (const city of [{ latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }]) expect(m!.nearestAirports(city)).toEqual([])
    for (const options of [{ limit: 0 }, { limit: Infinity }, { radiusKm: -1 }, { radiusKm: NaN }]) expect(m!.nearestAirports({ latitude: 0, longitude: 0 }, options)).toEqual([])
    expect(m!.nearestAirports({ latitude: 0, longitude: 0 })).toEqual([])
  })

  it('pins the compact asset, verifies all zones, and covers US territories without a city catalog dependency', async () => {
    const path = 'supabase/functions/_shared/domain/airport-data.generated.json'
    const data = JSON.parse(readFileSync(path, 'utf8'))
    expect(data.rows.length).toBeGreaterThan(450)
    expect(new Set(data.rows.map((r: unknown[]) => r[0])).size).toBe(data.rows.length)
    expect([...new Set(data.rows.map((r: unknown[]) => r[6]))].sort()).toEqual(['AS', 'GU', 'MP', 'PR', 'US', 'VI'])
    for (const row of data.rows) {
      expect(Number.isFinite(row[2]) && Math.abs(row[2]) <= 90).toBe(true)
      expect(Number.isFinite(row[3]) && Math.abs(row[3]) <= 180).toBe(true)
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: row[4] })).not.toThrow()
    }
    expect(readFileSync(path).length).toBeLessThan(300_000)
    expect(data.info.rowsSha256).toBe(createHash('sha256').update(JSON.stringify(data.rows)).digest('hex'))
    expect(data.info.sources.every((s: {sha256: string, url: string, license: string}) => /^[a-f0-9]{64}$/.test(s.sha256) && s.url.startsWith('https://') && s.license)).toBe(true)
    expect(data.info.ourAirportsCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(data.info.omissions.length).toBeGreaterThan(0)
    expect(readFileSync('supabase/functions/_shared/domain/airport-metadata.ts', 'utf8')).not.toMatch(/city-(catalog|data|resolver)/)
  })

  it('generates deterministically and rejects duplicate IATA, absent airport identities, missing zones, and ambiguous zones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'airport-fixture-'))
    try {
      const header = 'id,ident,type,name,latitude_deg,longitude_deg,iso_country,iso_region,municipality,scheduled_service,iata_code,gps_code,local_code\n'
      const airport = (id: number, iata: string, lat = 40) => `${id},K${iata},medium_airport,${iata} Airport,${lat},-70,US,US-MA,Example,yes,${iata},K${iata},${iata}\n`
      writeFileSync(join(dir, 'airports.csv'), header + airport(1, 'AAA') + airport(2, 'DUP') + airport(3, 'DUP') + airport(4, 'NOZ') + airport(5, 'BAD') + airport(6, 'AMB') + airport(7, 'FAR') + airport(8, 'CTY') + airport(9, 'ICA') + airport(10, 'NAM') + airport(11, 'INV') + airport(12, 'WRG'))
      const feature = (id: number, name: string, aliases: string, zone: string, lat = 40, code = 'AIRP', country = 'US') => [id, name, name, aliases, lat, -70, 'S', code, country, '', 'MA', '', '', '', 0, '', '', zone, '2026-10-21'].join('\t')
      writeFileSync(join(dir, 'US.txt'), [feature(101, 'AAA Airport', 'AAA', 'America/New_York'), feature(102, 'NOZ Airport', 'NOZ', ''), feature(103, 'Unrelated Airfield', 'XXX', 'America/New_York'), feature(104, 'AMB Airport', 'AMB', 'America/New_York'), feature(105, 'AMB Airport', 'KAMB', 'America/Chicago'), feature(106, 'FAR Airport', 'FAR', 'America/New_York', 41), feature(107, 'CTY Airport', 'CTY', 'America/New_York', 40, 'PPL'), feature(108, 'Different Airport Name', 'KICA', 'America/New_York'), feature(109, 'NAM Airport', '', 'America/New_York'), feature(110, 'INV Airport', 'INV', 'Mars/Olympus'), feature(111, 'WRG Airport', 'WRG', 'America/New_York', 40, 'AIRP', 'CA')].join('\n'))
      const output = join(dir, 'output.json')
      const args = ['scripts/generate-airport-catalog.py', '--ourairports-csv', join(dir, 'airports.csv'), '--geonames-dir', dir, '--countries', 'US', '--allow-unpinned-inputs', '--output', output]
      const run = spawnSync('python3', args, { encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      const first = readFileSync(output, 'utf8'), data = JSON.parse(first)
      expect(data.rows.map((r: unknown[]) => r[0])).toEqual(['AAA', 'ICA', 'NAM'])
      expect(data.info.omissions.map((r: {iata: string}) => r.iata).sort()).toEqual(['AMB', 'BAD', 'CTY', 'DUP', 'FAR', 'INV', 'NOZ', 'WRG'])
      execFileSync('python3', args)
      expect(readFileSync(output, 'utf8')).toBe(first)
      const pinCheck = spawnSync('python3', args.filter(a => a !== '--allow-unpinned-inputs'), { encoding: 'utf8' })
      expect(pinCheck.status).not.toBe(0)
      expect(pinCheck.stderr).toMatch(/checksum|pinned/i)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
