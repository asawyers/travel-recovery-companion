// Keep this module behind a dynamic import in browser code. Domain types live in
// city-types.ts so importing City alone never includes the national data asset.
import generated from './city-data.generated.json' with { type: 'json' }
import type { City } from './city-types.ts'

type CompactRow = [number, string, number, number, number, number, number, number, string]
// Retain compact rows only: no expanded City array, ID map, or search-key copy.
const rows = generated.rows as CompactRow[]
export const catalogInfo = Object.freeze(generated.info)

function expand(row: CompactRow): City {
  const state = generated.states[row[2]]
  return {
    id: `geonames:${row[0]}`, name: row[1], stateCode: state[0], stateName: state[1],
    countryCode: state[2] as City['countryCode'], countyName: generated.counties[row[3]] ?? null,
    latitude: row[4], longitude: row[5], timeZone: generated.zones[row[6]],
  }
}

export function findCity(id: string): City | null {
  if (typeof id !== 'string' || !/^geonames:[1-9]\d{0,9}$/.test(id)) return null
  const target = Number(id.slice(9))
  let low = 0, high = rows.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const row = rows[middle]
    if (row[0] === target) return expand(row)
    if (row[0] < target) low = middle + 1
    else high = middle - 1
  }
  return null
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

// These small dictionaries are shared; per-place search keys are not retained.
const stateSearch = generated.states.map(state => ` ${normalize(state.join(' '))}`)
const countySearch = generated.counties.map(county => ` ${normalize(county)}`)

function matchesTokens(candidate: string, location: string, tokens: string[]): boolean {
  for (const token of tokens) {
    if (!candidate.includes(` ${token}`) && !location.includes(` ${token}`)) return false
  }
  return true
}

export function searchCities(query: string, limit = 8): City[] {
  if (typeof query !== 'string' || query.length > 200 || !Number.isFinite(limit) || limit < 1) return []
  const normalized = normalize(query)
  if (normalized.length < 2) return []
  const tokens = normalized.split(' ')
  const count = Math.min(20, Math.floor(limit))
  const best: { row: CompactRow; score: number }[] = []
  for (const row of rows) {
    const name = normalize(row[1])
    const location = `${stateSearch[row[2]]}${countySearch[row[3]] ?? ''}`
    const primaryMatches = matchesTokens(` ${name}`, location, tokens)
    let aliases: string[] | undefined
    if (!primaryMatches) {
      if (!row[8] || !matchesTokens(` ${row[8].replace(/\|/g, ' ')}`, location, tokens)) continue
      aliases = row[8].split('|')
      // Tokens must belong to one name/alias plus its location.
      if (!aliases.some(alias => matchesTokens(` ${alias}`, location, tokens))) continue
    }
    const exact = name === normalized || (aliases ?? row[8].split('|')).includes(normalized)
    const fullName = tokens.slice(0, name.split(' ').length).join(' ') === name
    const score = exact ? 3 : fullName ? 2 : name.startsWith(tokens[0]) ? 1 : 0
    const candidate = { row, score }
    const at = best.findIndex(existing => score > existing.score ||
      (score === existing.score && (row[7] > existing.row[7] || (row[7] === existing.row[7] && row[0] < existing.row[0]))))
    if (at >= 0) best.splice(at, 0, candidate)
    else if (best.length < count) best.push(candidate)
    if (best.length > count) best.pop()
  }
  return best.map(({ row }) => expand(row))
}
