import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'
import { MAX_FACT_AGE_MS } from '../domain/api.ts'
import { TripRequestSchema } from '../domain/schemas.ts'
import type { FlightStatusReport, SourceEvidence, TripRequest } from '../domain/schemas.ts'
import { toInstantMillis, toTripLocalTime } from '../domain/time.ts'
import { providerJson } from './provider-http.ts'
import type { FlightAdapter, ProviderAdapterOptions } from './provider-types.ts'

const ORIGIN_TIME_ZONE = 'America/Los_Angeles'
const FLIGHTAWARE_BASE = 'https://aeroapi.flightaware.com/aeroapi/flights/'
const timestamp = TripRequestSchema.shape.arrivalAt.nullable()
const airport = z.object({ code: z.string().nullable().optional(), code_iata: z.string().nullable().optional(), code_icao: z.string().nullable().optional() }).nullable()
const record = z.object({
  ident: z.string().trim().min(1).max(100), fa_flight_id: z.string().trim().min(1).max(100),
  ident_iata: z.string().nullable().optional(), ident_icao: z.string().nullable().optional(),
  codeshares: z.array(z.string()).max(100).nullable().optional(), codeshares_iata: z.array(z.string()).max(100).nullable().optional(),
  origin: airport, destination: airport, scheduled_out: timestamp.optional(), scheduled_off: timestamp.optional(),
  actual_in: timestamp, estimated_in: timestamp, scheduled_in: timestamp, actual_on: timestamp,
  cancelled: z.boolean(), diverted: z.boolean(), position_only: z.boolean(),
})
const response = z.object({
  flights: z.array(record).max(100), links: z.object({ next: z.string().nullable() }).nullable(), num_pages: z.number().int().min(1),
})
const normalizeIdent = (value: string) => value.replace(/\s/g, '').toUpperCase()
function routeMatches(value: z.infer<typeof airport>, iata: string, icao: string): boolean {
  if (!value) return false
  // Conflicting explicit codes are not evidence for the supported route.
  if (value.code_iata && value.code_iata !== iata) return false
  if (value.code_icao && value.code_icao !== icao) return false
  return value.code_iata === iata || value.code_icao === icao || value.code === iata || value.code === icao
}
function requestWindow(request: TripRequest, checkedAt: string): { start: string; end: string; ident: string } | null {
  if (!request.flight) return null
  const ident = normalizeIdent(request.flight.ident)
  if (!/^(?:[A-Z]{3}|[A-Z0-9]{2})[0-9]{1,4}[A-Z]?$/.test(ident) || !/^[A-Z]/.test(ident)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.flight.departureDate)) return null
  try {
    const date = Temporal.PlainDate.from(request.flight.departureDate, { overflow: 'reject' })
    const start = date.toZonedDateTime({ timeZone: ORIGIN_TIME_ZONE, plainTime: '00:00' }).toInstant()
    const end = date.add({ days: 1 }).toZonedDateTime({ timeZone: ORIGIN_TIME_ZONE, plainTime: '00:00' }).toInstant()
    const now = Temporal.Instant.from(checkedAt)
    const lower = now.subtract({ hours: 240 }).epochMilliseconds
    const upper = now.add({ hours: 48 }).epochMilliseconds
    if (start.epochMilliseconds < lower || end.epochMilliseconds > upper) return null
    return { start: start.toString(), end: end.toString(), ident }
  } catch { return null }
}

/** Server-only lookup: one request, one page, fixed coverage and no automatic retries. */
export function createFlightAwareAdapter(options: ProviderAdapterOptions): FlightAdapter {
  return async (request, context) => {
    if (!options.enabled || !options.apiKey?.trim() || request.mode !== 'real' || !request.flight) {
      return { status: 'unavailable', reason: 'Flight status lookup is not configured for this request; retain the manual arrival.', retryable: false }
    }
    const checkedAt = options.now()
    const window = requestWindow(request, checkedAt)
    if (!window) return { status: 'unavailable', reason: 'Flight status lookup needs a supported flight number and a departure date within the available lookup window.', retryable: false }
    const url = new URL(FLIGHTAWARE_BASE + encodeURIComponent(window.ident))
    url.search = new URLSearchParams({ ident_type: 'designator', start: window.start, end: window.end, max_pages: '1' }).toString()
    const result = await providerJson(options.fetcher ?? fetch, url.toString(), {
      method: 'GET', headers: { 'x-apikey': options.apiKey, Accept: 'application/json' }, redirect: 'error',
    }, context.signal)
    if (!result.ok) {
      return { status: 'error', reason: result.kind === 'rate_limited'
        ? 'Flight status lookup is rate limited; retain the manual arrival.'
        : 'Flight status lookup is temporarily unavailable; retain the manual arrival.',
      retryable: result.kind === 'rate_limited' || result.kind === 'timeout' || result.kind === 'network' || (result.kind === 'http' && (result.status ?? 0) >= 500) }
    }
    const parsed = response.safeParse(result.body)
    if (!parsed.success) return { status: 'error', reason: 'Flight status returned an invalid response; retain the manual arrival.', retryable: false }
    if (parsed.data.links?.next || parsed.data.num_pages > 1) {
      return { status: 'ambiguous', reason: 'Flight status results are incomplete; confirm the flight and retain the manual arrival.', retryable: false }
    }
    const matches = parsed.data.flights.filter(flight => {
      if (!routeMatches(flight.origin, 'SAN', 'KSAN') || !routeMatches(flight.destination, 'BOS', 'KBOS')) return false
      const aliases = [flight.ident, flight.ident_iata, flight.ident_icao, ...(flight.codeshares ?? []), ...(flight.codeshares_iata ?? [])]
      if (!aliases.some(alias => alias && normalizeIdent(alias) === window.ident)) return false
      const departure = flight.scheduled_out ?? flight.scheduled_off
      if (!departure) return false
      return Temporal.Instant.from(departure).toZonedDateTimeISO(ORIGIN_TIME_ZONE).toPlainDate().toString() === request.flight!.departureDate
    })
    if (matches.length > 1) return { status: 'ambiguous', reason: 'Multiple flights match this number, departure date and route; confirm the flight and retain the manual arrival.', retryable: false }
    if (!matches.length) return { status: 'unavailable', reason: 'No matching SAN to BOS flight was found for this departure date; retain the manual arrival.', retryable: false }
    const flight = matches[0]
    const outcome: FlightStatusReport['outcome'] = flight.cancelled ? 'cancelled' : flight.diverted ? 'diverted' : flight.position_only ? 'position_only'
      : flight.actual_in || flight.estimated_in ? 'gate_available' : flight.actual_on ? 'runway_only' : flight.scheduled_in ? 'gate_available' : 'runway_only'
    const report: FlightStatusReport = { ident: flight.ident, faFlightId: flight.fa_flight_id,
      scheduledIn: flight.scheduled_in, estimatedIn: flight.estimated_in, actualIn: flight.actual_in, actualOn: flight.actual_on, outcome }
    const arrival = outcome !== 'gate_available' ? null : flight.actual_in
      ? { arrivalAt: flight.actual_in, arrivalBasis: 'actual_gate' as const }
      : flight.estimated_in ? { arrivalAt: flight.estimated_in, arrivalBasis: 'estimated_gate' as const }
      : { arrivalAt: flight.scheduled_in!, arrivalBasis: 'scheduled_gate' as const }
    const warnings = outcome === 'cancelled' ? ['FlightAware has cancelled tracking for this flight; airline cancellation requires confirmation. Retain the manual arrival.']
      : outcome === 'diverted' ? ['This flight is flagged as diverted; confirm the actual destination and retain the manual arrival.']
      : outcome === 'position_only' ? ['This flight has position data only; a gate arrival cannot be established. Retain the manual arrival.']
      : outcome === 'runway_only' ? ['No gate arrival time is available. Runway arrival does not establish gate arrival; retain the manual arrival.']
      : arrival?.arrivalBasis === 'scheduled_gate' ? ['Only a scheduled gate arrival is available; confirm current flight status.']
      : arrival?.arrivalBasis === 'estimated_gate' ? ['Gate arrival is estimated and can change; confirm current flight status.'] : []
    const evidence: SourceEvidence = {
      provider: 'FlightAware AeroAPI', type: arrival?.arrivalBasis === 'actual_gate' ? 'live' : arrival?.arrivalBasis === 'scheduled_gate' ? 'schedule' : 'estimated',
      environment: 'production', sourceUrl: 'https://www.flightaware.com/', checkedAt, providerUpdatedAt: null,
      serviceDate: arrival ? toTripLocalTime(arrival.arrivalAt).slice(0, 10) : request.flight.departureDate,
      expiresAt: new Date(toInstantMillis(checkedAt) + MAX_FACT_AGE_MS).toISOString(), warnings,
    }
    return { status: 'ok', data: { arrival, report }, evidence: [evidence], warnings }
  }
}
