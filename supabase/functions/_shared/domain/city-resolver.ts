// Edge-only module. Inflates once during module initialization; subsequent lookup
// is synchronous. Browser search loads its own independent catalog.
import compressed from './city-resolver.generated.ts'
import type { City } from './city-types.ts'

type ResolverRow = [number, string, number, number, number, number, number]
interface ResolverData {
  info: { version: string; source: string; license: string; recordCount: number; generatedAt: string }
  states: [string, string, City['countryCode']][]
  counties: string[]
  zones: string[]
  rows: ResolverRow[]
}

async function load(): Promise<ResolverData> {
  const binary = atob(compressed)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).json() as ResolverData
}
const data = await load()
export const catalogInfo = Object.freeze(data.info)

export function findCity(id: string): City | null {
  if (typeof id !== 'string' || !/^geonames:[1-9]\d{0,9}$/.test(id)) return null
  const target = Number(id.slice(9))
  let low = 0, high = data.rows.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const row = data.rows[middle]
    if (row[0] === target) {
      const state = data.states[row[2]]
      return {
        id: `geonames:${row[0]}`, name: row[1], stateCode: state[0], stateName: state[1], countryCode: state[2],
        countyName: data.counties[row[3]] ?? null, latitude: row[4], longitude: row[5], timeZone: data.zones[row[6]],
      }
    }
    if (row[0] < target) low = middle + 1
    else high = middle - 1
  }
  return null
}
