import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const catalogPath = new URL('../../supabase/functions/_shared/domain/city-catalog.ts', import.meta.url)
async function catalog() {
  expect(existsSync(catalogPath), 'the versioned city catalog must exist').toBe(true)
  return import('../../supabase/functions/_shared/domain/city-catalog')
}

describe('national city catalog', () => {
  it('disambiguates Portland by state and returns an exact stable ID', async () => {
    const { searchCities, findCity } = await catalog()
    const maine = searchCities('Portland ME')[0]
    const oregon = searchCities('Portland Oregon')[0]
    expect(maine).toMatchObject({ name: 'Portland', stateCode: 'ME', timeZone: 'America/New_York' })
    expect(oregon).toMatchObject({ name: 'Portland', stateCode: 'OR', timeZone: 'America/Los_Angeles' })
    expect(maine.id).not.toBe(oregon.id)
    expect(findCity(maine.id)).toEqual(maine)
    expect(maine.id).toMatch(/^geonames:[1-9]\d*$/)
    expect(Object.keys(maine).sort()).toEqual(['id', 'name', 'stateCode', 'stateName', 'countryCode', 'countyName', 'latitude', 'longitude', 'timeZone'].sort())
  }, 15000)
  it('can distinguish Springfield by state and county', async () => {
    const { searchCities } = await catalog()
    expect(searchCities('Springfield Sangamon Illinois')[0]).toMatchObject({ name: 'Springfield', stateCode: 'IL', countyName: 'Sangamon County' })
    expect(searchCities('Springfield Hampden MA')[0]).toMatchObject({ name: 'Springfield', stateCode: 'MA', countyName: 'Hampden County' })
  })
  it('retains small inhabited communities and searchable accent and alias variants', async () => {
    const { searchCities } = await catalog()
    expect(searchCities('Monowi NE')[0]).toMatchObject({ name: 'Monowi', stateCode: 'NE' })
    expect(searchCities('Anasco PR')[0]).toMatchObject({ name: 'Añasco', countryCode: 'PR' })
    expect(searchCities('NYC')[0]).toMatchObject({ name: 'New York City', stateCode: 'NY' })
  })
  it.each([
    ['ᏓᎵᏆ', 'geonames:4552707', 'Tahlequah'],
    ['Τόμας WV', 'geonames:4824597', 'Thomas'],
  ])('matches retained Unicode alias %s using the same normalization as queries', async (query, id, name) => {
    const { searchCities } = await catalog()
    expect(searchCities(query)[0]).toMatchObject({ id, name })
  })
  it('bounds input and output and rejects malformed or unknown IDs', async () => {
    const { searchCities, findCity } = await catalog()
    for (const id of ['', 'geonames:0', 'geonames:0001', 'geonames:1.5', 'geonames:99999999999999999', 'other:5128581', 'geonames:999999999']) expect(findCity(id)).toBeNull()
    expect(searchCities('')).toEqual([])
    expect(searchCities('a')).toEqual([])
    expect(searchCities('a'.repeat(201))).toEqual([])
    expect(searchCities('Springfield', 0)).toEqual([])
    expect(searchCities('Springfield', -1)).toEqual([])
    expect(searchCities('Springfield', Number.NaN)).toEqual([])
    expect(searchCities('Springfield', 999).length).toBeLessThanOrEqual(20)
    expect(searchCities('Springfield', 2)).toHaveLength(2)
  })
  it('ships sorted unique valid records for every supported country and US state', async () => {
    const { catalogInfo, findCity } = await catalog()
    const { catalogInfo: serverInfo, findCity: resolve } = await import('../../supabase/functions/_shared/domain/city-resolver')
    expect(serverInfo).toEqual(catalogInfo)
    const data = JSON.parse(readFileSync(new URL('../../supabase/functions/_shared/domain/city-data.generated.json', import.meta.url), 'utf8'))
    expect(catalogInfo.recordCount).toBeGreaterThan(100000)
    expect(catalogInfo.recordCount).toBe(data.rows.length)
    expect(catalogInfo.license).toBe('CC BY 4.0')
    expect(catalogInfo.source).toContain('geonames.org')
    const ids = new Set<number>(), countries = new Set<string>(), states = new Set<string>(), zones = new Set<string>()
    let previous = 0
    for (const row of data.rows) {
      expect(row[0]).toBeGreaterThan(previous)
      previous = row[0]
      ids.add(row[0])
      const city = findCity(`geonames:${row[0]}`)!
      expect(city).not.toBeNull()
      expect(resolve(city.id)).toEqual(city)
      expect(city.latitude).toBeGreaterThanOrEqual(-90)
      expect(city.latitude).toBeLessThanOrEqual(90)
      expect(city.longitude).toBeGreaterThanOrEqual(-180)
      expect(city.longitude).toBeLessThanOrEqual(180)
      expect(city.stateCode).toMatch(/^[A-Z]{2}$/)
      expect(city.stateName.length).toBeGreaterThan(0)
      countries.add(city.countryCode); states.add(city.stateCode); zones.add(city.timeZone)
    }
    for (const zone of zones) expect(() => new Intl.DateTimeFormat('en', { timeZone: zone }).format()).not.toThrow()
    expect(ids.size).toBe(data.rows.length)
    expect([...countries].sort()).toEqual(['AS', 'GU', 'MP', 'PR', 'US', 'VI'])
    expect(states.size).toBe(56)
  }, 30000)
})

describe('catalog generation', () => {
  it('filters invalid and excluded places, reports reasons, and is reproducible for a pinned vintage', () => {
    const script = new URL('../../scripts/build_city_catalog.py', import.meta.url)
    expect(existsSync(script), 'the offline catalog generator must exist').toBe(true)
    const dir = mkdtempSync(join(tmpdir(), 'city-catalog-fixture-'))
    writeFileSync(join(dir, 'admin1CodesASCII.txt'), 'US.ME\tMaine\tMaine\t1\n')
    writeFileSync(join(dir, 'admin2Codes.txt'), 'US.ME.005\tCumberland County\tCumberland County\t2\n')
    const row = (id: string, code = 'PPL', zone = 'America/New_York', lat = '43.6') => [id, 'Fixture Town', 'Fixture Town', 'Alias Town,काक', lat, '-70.2', 'P', code, 'US', '', 'ME', '005', '', '', '0', '', '', zone, '2026-10-21'].join('\t')
    writeFileSync(join(dir, 'US.txt'), [row('1'), row('1'), row('2', 'PPLH'), row('3', 'PPL', 'Invalid/Zone'), row('4', 'PPL', 'America/New_York', 'NaN'), row('5', 'PPLX')].join('\n'))
    const output = join(dir, 'catalog.json')
    const resolverOutput = join(dir, 'resolver.generated.ts')
    const run = () => execFileSync('python3', [script.pathname, '--source-dir', dir, '--countries', 'US', '--generated-at', '2026-10-22T00:00:00Z', '--output', output, '--resolver-output', resolverOutput], { encoding: 'utf8' })
    const first = run()
    const bytes = readFileSync(output, 'utf8')
    const resolverBytes = readFileSync(resolverOutput, 'utf8')
    const generated = JSON.parse(bytes)
    expect(generated.rows).toHaveLength(1)
    expect(generated.rows[0][0]).toBe(1)
    expect(generated.rows[0][8].split('|')).toContain('कक')
    expect(generated.report.skipped).toMatchObject({ duplicate_id: 1, excluded_feature: 2, invalid_timezone: 1, invalid_coordinates: 1 })
    expect(generated.provenance[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(first).toContain('1 records')
    run()
    expect(readFileSync(output, 'utf8')).toBe(bytes)
    expect(readFileSync(resolverOutput, 'utf8')).toBe(resolverBytes)
  })
})

describe('server-only city resolution', () => {
  it('resolves the same authoritative cities without loading browser search data', async () => {
    const path = new URL('../../supabase/functions/_shared/domain/city-resolver.ts', import.meta.url)
    expect(existsSync(path), 'the server resolver must exist independently of browser search').toBe(true)
    const { findCity: resolve } = await import('../../supabase/functions/_shared/domain/city-resolver')
    const { findCity, searchCities } = await catalog()
    for (const query of ['Portland ME', 'Springfield Illinois', 'Monowi NE', 'Anasco PR', 'Hagatna GU']) {
      const selected = searchCities(query)[0]
      expect(selected).toBeDefined()
      expect(resolve(selected.id)).toEqual(findCity(selected.id))
    }
    for (const id of ['', 'geonames:0', 'geonames:0001', 'geonames:999999999']) expect(resolve(id)).toBeNull()
    const source = readFileSync(path, 'utf8')
    expect(source).not.toContain('city-data.generated.json')
    expect(source).not.toContain('city-catalog')
  }, 15000)
})
