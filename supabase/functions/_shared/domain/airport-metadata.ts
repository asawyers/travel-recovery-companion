import generated from './airport-data.generated.json' with { type: 'json' }

export type AirportMetadata = {
  iata: string
  name: string
  latitude: number
  longitude: number
  timeZone: string
  metadataSource: string
  countryCode: string
  stateCode: string
  municipality: string
  kind: 'large_airport' | 'medium_airport' | 'small_airport'
}

type Row = [string, string, number, number, string, string, string, string, string, AirportMetadata['kind']]
const rows = generated.rows as Row[]

function expand(row: Row): AirportMetadata {
  return { iata: row[0], name: row[1], latitude: row[2], longitude: row[3], timeZone: row[4], metadataSource: row[5], countryCode: row[6], stateCode: row[7], municipality: row[8], kind: row[9] }
}

export function findAirport(iata: string): AirportMetadata | undefined {
  if (typeof iata !== 'string') return undefined
  const code = iata.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return undefined
  let low = 0, high = rows.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    if (rows[mid][0] === code) return expand(rows[mid])
    if (rows[mid][0] < code) low = mid + 1
    else high = mid - 1
  }
  return undefined
}

function distanceKm(a: { latitude: number; longitude: number }, row: Row): number {
  const rad = Math.PI / 180
  const h = Math.sin((row[2] - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(row[2] * rad) * Math.sin((row[3] - a.longitude) * rad / 2) ** 2
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}

export function nearestAirports(city: { latitude: number; longitude: number }, options?: { limit?: number; radiusKm?: number }): Array<{ airport: AirportMetadata; distanceKm: number }> {
  const limit = options?.limit ?? 3, radiusKm = options?.radiusKm ?? 200
  if (!Number.isFinite(city.latitude) || Math.abs(city.latitude) > 90 || !Number.isFinite(city.longitude) || Math.abs(city.longitude) > 180 || !Number.isFinite(limit) || limit < 1 || !Number.isFinite(radiusKm) || radiusKm < 0) return []
  return rows.map(row => ({ row, distanceKm: distanceKm(city, row) }))
    .filter(result => result.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.row[0].localeCompare(b.row[0]))
    .slice(0, Math.floor(limit)).map(({ row, distanceKm }) => ({ airport: expand(row), distanceKm }))
}
