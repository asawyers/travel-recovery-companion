import { z } from 'zod'
import { ConfirmedOptionSchema, TripRequestSchema } from '../domain/schemas.ts'
import type { ConfirmedOption, SourceEvidence, TransitOption, TripRequest } from '../domain/schemas.ts'
import { addMinutes, toInstantMillis, toTripLocalTime } from '../domain/time.ts'
import { providerJson } from './provider-http.ts'
import type { ProviderAdapterOptions, RoutesAdapter } from './provider-types.ts'

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const AIRPORT = 'Boston Logan International Airport (BOS), Boston, MA, USA'
const NORTH_STATION = 'North Station, 135 Causeway Street, Boston, MA 02114, USA'
// REST uses camelCase travelAdvisory, including the optional total-route fare.
const TRANSIT_MASK = [
  'routes.duration', 'routes.warnings', 'routes.travelAdvisory.transitFare',
  'routes.legs.startLocation', 'routes.legs.endLocation',
  'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration',
  'routes.legs.steps.transitDetails.stopDetails',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.agencies.name',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
  'routes.legs.steps.transitDetails.tripShortText',
].join(',')
const DRIVE_MASK = 'routes.duration,routes.warnings,routes.legs.startLocation,routes.legs.endLocation'
const TERMINAL_WARNING = 'BOS terminal is unknown; confirm the airport pickup terminal and walking route before travel.'
const AVAILABILITY_WARNING = 'Google Maps transit times are schedule estimates; confirm service, tickets and seats with the operator. No inventory was checked.'
const ACCESS_WARNING = 'North Station access is an estimated drive, not an available taxi or rental; confirm a vehicle, pickup and the unknown transfer fare.'
const COVERAGE_WARNING = 'Unsupported Google Maps route omitted; coverage requires one Concord Coach bus from BOS or one Amtrak/Downeaster train from North Station, with walking only around the ride.'
const MAX_SECONDS = 10_080 * 60
const location = z.object({ latLng: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }) })
const stop = z.object({ name: z.string().trim().min(1).max(500), location })
const details = z.object({
  stopDetails: z.object({ departureStop: stop, arrivalStop: stop, departureTime: z.string().max(40), arrivalTime: z.string().max(40) }),
  transitLine: z.object({ name: z.string().max(500).optional(), agencies: z.array(z.object({ name: z.string().max(500) })).max(16).optional(), vehicle: z.object({ type: z.string().max(64) }) }),
  tripShortText: z.string().max(100).optional(),
})
const step = z.object({ travelMode: z.enum(['WALK', 'TRANSIT']), staticDuration: z.string().max(40).optional(), transitDetails: details.optional() })
const route = z.object({
  duration: z.string().max(40), warnings: z.array(z.string()).max(64).optional(),
  travelAdvisory: z.object({ transitFare: z.unknown().optional() }).optional(),
  legs: z.array(z.object({ startLocation: location, endLocation: location, steps: z.array(step).min(1).max(96) })).length(1),
})
const response = z.object({ routes: z.array(z.unknown()).max(4).optional() })
const driveRoute = z.object({ duration: z.string().max(40), warnings: z.array(z.string()).max(64).optional(), legs: z.array(z.object({ startLocation: location, endLocation: location })).length(1) })
type Location = z.infer<typeof location>
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/https?:\/\/\S+/gi, '[link omitted]').trim().slice(0, 500)
const notes = (values: string[]) => [...new Set(values.map(clean).filter(Boolean))].slice(0, 32)
function seconds(value: string | undefined): number | null {
  if (!value || !/^\d+(?:\.\d{1,9})?s$/.test(value)) return null
  const number = Number(value.slice(0, -1))
  return Number.isFinite(number) && number >= 0 && number <= MAX_SECONDS ? number : null
}
function inArea(value: Location, area: 'BOS' | 'north' | 'portland'): boolean {
  const { latitude: lat, longitude: lng } = value.latLng
  return area === 'BOS' ? lat >= 42.35 && lat <= 42.39 && lng >= -71.04 && lng <= -70.98
    : area === 'north' ? lat >= 42.36 && lat <= 42.373 && lng >= -71.073 && lng <= -71.052
    : lat >= 43.58 && lat <= 43.78 && lng >= -70.38 && lng <= -70.15
}
/** Up to 50m tolerates coordinates snapped to the same stop/curb; it cannot bridge a missing transfer. */
function colocated(a: Location, b: Location): boolean {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latA = radians(a.latLng.latitude); const latB = radians(b.latLng.latitude)
  const deltaLat = latB - latA; const deltaLng = radians(b.latLng.longitude - a.latLng.longitude)
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, haversine))) <= 50
}
function fareCents(value: unknown): number | null {
  const parsed = z.object({ currencyCode: z.literal('USD'), units: z.string().regex(/^\d{1,9}$/).default('0'), nanos: z.number().int().min(0).max(999_999_999).default(0) }).safeParse(value)
  if (!parsed.success || parsed.data.nanos % 10_000_000 !== 0) return null
  const cents = Number(parsed.data.units) * 100 + parsed.data.nanos / 10_000_000
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : null
}
function evidence(type: 'schedule' | 'estimated', at: string, checkedAt: string, warnings: string[]): SourceEvidence[] {
  return [{ type, provider: 'Google Maps Routes API', sourceUrl: 'https://developers.google.com/maps/documentation/routes', checkedAt,
    serviceDate: toTripLocalTime(at).slice(0, 10), providerUpdatedAt: null,
    expiresAt: new Date(toInstantMillis(checkedAt) + 300_000).toISOString(), environment: 'production', warnings: notes(warnings) }]
}
function normalizeRoute(input: unknown, mode: 'bus' | 'train', request: TripRequest, checkedAt: string, readyAt: string, driveMinutes: number, index: number, driveEnd?: Location): TransitOption | null {
  const parsed = route.safeParse(input)
  if (!parsed.success) return null
  const value = parsed.data; const leg = value.legs[0]
  const totalSeconds = seconds(value.duration)
  if (totalSeconds === null || !inArea(leg.startLocation, mode === 'bus' ? 'BOS' : 'north') || !inArea(leg.endLocation, 'portland')) return null
  const rides = leg.steps.filter(item => item.travelMode === 'TRANSIT')
  if (rides.length !== 1 || !rides[0].transitDetails) return null
  const ride = rides[0]; const transit = ride.transitDetails!
  const stations = transit.stopDetails
  const line = transit.transitLine
  const operator = [line.name ?? '', ...(line.agencies ?? []).map(item => item.name)].join(' ')
  const vehicleTypes = mode === 'bus' ? ['BUS', 'INTERCITY_BUS'] : ['HEAVY_RAIL', 'COMMUTER_TRAIN', 'HIGH_SPEED_TRAIN', 'LONG_DISTANCE_TRAIN', 'RAIL']
  if (!vehicleTypes.includes(line.vehicle.type) || !(mode === 'bus' ? /\bConcord\s+Coach(?:\s+Lines)?\b/i : /\b(?:Amtrak|Downeaster)\b/i).test(operator)) return null
  if (!inArea(stations.departureStop.location, mode === 'bus' ? 'BOS' : 'north') || !inArea(stations.arrivalStop.location, 'portland')) return null
  if (!(mode === 'bus' ? /\b(?:Logan|BOS|Terminal)\b/i : /\bNorth\s+Station\b/i).test(stations.departureStop.name) || !/\b(?:Portland|Transportation\s+Center|Thompson)\b/i.test(stations.arrivalStop.name)) return null
  const rideIndex = leg.steps.indexOf(ride)
  const before = leg.steps.slice(0, rideIndex); const after = leg.steps.slice(rideIndex + 1)
  const walkSeconds = (items: typeof before): number | null => {
    let total = 0
    for (const item of items) {
      const duration = seconds(item.staticDuration)
      if (item.travelMode !== 'WALK' || item.transitDetails || duration === null) return null
      total += duration
    }
    return total <= MAX_SECONDS ? total : null
  }
  const beforeSeconds = walkSeconds(before); const afterSeconds = walkSeconds(after)
  if (beforeSeconds === null || afterSeconds === null) return null
  if (beforeSeconds === 0 && !colocated(leg.startLocation, stations.departureStop.location)) return null
  if (afterSeconds === 0 && !colocated(stations.arrivalStop.location, leg.endLocation)) return null
  // The two separate Google requests must join at North Station; nearby city coordinates do not prove access.
  if (mode === 'train' && (!driveEnd || !colocated(driveEnd, leg.startLocation))) return null
  try {
    const depart = toInstantMillis(stations.departureTime); const arrive = toInstantMillis(stations.arrivalTime)
    const rideSeconds = seconds(ride.staticDuration)
    const boardMinutes = mode === 'bus' ? 10 : 15
    const accessMinutes = driveMinutes + Math.ceil(beforeSeconds / 60)
    if (arrive <= depart || arrive - depart > MAX_SECONDS * 1000 || rideSeconds === null || Math.abs(rideSeconds * 1000 - (arrive - depart)) > 1000) return null
    if (totalSeconds * 1000 + 1000 < arrive - depart + (beforeSeconds + afterSeconds) * 1000 || depart < toInstantMillis(addMinutes(readyAt, accessMinutes + boardMinutes))) return null
    const warnings = notes([TERMINAL_WARNING, AVAILABILITY_WARNING, ...(value.warnings ?? []), ...(mode === 'train' ? [ACCESS_WARNING] : [])])
    const schedule = evidence('schedule', stations.departureTime, checkedAt, warnings)
    const access = evidence('estimated', readyAt, checkedAt, warnings)
    const final = evidence('estimated', stations.arrivalTime, checkedAt, warnings)
    const candidate = {
      kind: mode, id: `google-routes-${mode}-${index + 1}`, title: mode === 'bus' ? 'Google Maps Concord Coach bus schedule' : 'Google Maps Amtrak/Downeaster train schedule via North Station',
      departureAt: stations.departureTime, arrivalAt: stations.arrivalTime, boardingMinutes: boardMinutes,
      fareCents: fareCents(value.travelAdvisory?.transitFare),
      access: { from: 'BOS terminal exit', to: clean(stations.departureStop.name), minutes: accessMinutes, costCents: mode === 'bus' ? 0 : null, kind: mode === 'bus' ? 'walk' : 'transfer', vehicleId: mode === 'bus' ? null : 'google-routes-unconfirmed-taxi', evidence: access,
        assumptions: notes([TERMINAL_WARNING, ...(mode === 'train' ? ['Includes estimated BOS to North Station drive plus station walking; no vehicle or fare availability confirmed.'] : ['Airport terminal walking is estimated.'])]) },
      finalTransfer: { from: clean(stations.arrivalStop.name), to: request.destination, minutes: Math.ceil(afterSeconds / 60), costCents: 0, kind: 'walk', vehicleId: null, evidence: final, assumptions: ['Final walking duration is estimated; confirm destination and pedestrian access.'] },
      evidence: schedule, confirmations: [`Assumed ${boardMinutes}-minute boarding allowance; confirm the operator requirement.`, AVAILABILITY_WARNING, ...(mode === 'train' ? [ACCESS_WARNING] : [])],
    }
    const result = ConfirmedOptionSchema.safeParse(candidate)
    return result.success && (result.data.kind === 'bus' || result.data.kind === 'train') ? result.data : null
  } catch { return null }
}

/** Bounded server-only schedule estimates. No seats, rental inventory or booking is queried. */
export function createGoogleRoutesAdapter(options: ProviderAdapterOptions): RoutesAdapter {
  return async (input, context) => {
    const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason, retryable: false })
    if (!options.enabled || !options.apiKey?.trim() || input.mode !== 'real') return unavailable('Google Routes investigation is unavailable; manual route facts were retained.')
    const parsed = TripRequestSchema.safeParse(input)
    if (!parsed.success || /https?:\/\/|[\r\n]/i.test(input.destination)) return unavailable('Google Routes coverage is limited to a public Portland, Maine destination.')
    const request = parsed.data
    let checkedAt: string; let readyAt: string
    try { checkedAt = options.now(); readyAt = addMinutes(request.arrivalAt, request.airportExitMinutes) }
    catch { return unavailable('Google Routes timing is unsupported; retain manual route facts.') }
    const nowMs = toInstantMillis(checkedAt)
    const readyMs = toInstantMillis(readyAt)
    const inTransitWindow = (at: string) => { const difference = toInstantMillis(at) - nowMs; return difference >= -7 * 86_400_000 && difference <= 100 * 86_400_000 }
    if (!inTransitWindow(readyAt)) return unavailable('Google Routes transit date is outside supported coverage; manual route facts were retained.')
    if (context.signal.aborted) return unavailable('Google Routes investigation was cancelled; manual route facts were retained.')
    const candidates: ConfirmedOption[] = []; const warnings: string[] = [TERMINAL_WARNING]
    const fetcher = options.fetcher ?? fetch
    // This cache is scoped to one explicit investigation and retains no provider data between runs.
    const memo = new Map<string, ReturnType<typeof providerJson>>()
    let calls = 0
    const query = async (body: Record<string, unknown>, mask: string): Promise<unknown | null> => {
      if (context.signal.aborted) return null
      const serialized = JSON.stringify(body)
      const key = `${mask}:${serialized}`
      let pending = memo.get(key)
      if (!pending) {
        if (calls >= 3) return null
        calls++
        pending = providerJson(fetcher, ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': options.apiKey!.trim(), 'X-Goog-FieldMask': mask }, body: serialized }, context.signal)
        memo.set(key, pending)
      }
      const result = await pending
      if (!result.ok) { warnings.push(result.kind === 'rate_limited' ? 'Google Routes rate limit reached; this optional route lookup is unavailable.' : 'Google Routes optional route lookup is unavailable; retain manual facts.'); return null }
      return result.body
    }
    const transitBody = (origin: string, departureAt: string, kind: 'bus' | 'train') => ({
      origin: { address: origin }, destination: { address: request.destination }, travelMode: 'TRANSIT',
      departureTime: new Date(toInstantMillis(departureAt)).toISOString().replace('.000Z', 'Z'), computeAlternativeRoutes: true,
      transitPreferences: { allowedTravelModes: [kind === 'bus' ? 'BUS' : 'TRAIN'], routingPreference: 'FEWER_TRANSFERS' }, languageCode: 'en-US', regionCode: 'us',
    })
    const addRoutes = (body: unknown, kind: 'bus' | 'train', driveMinutes: number, driveEnd?: Location) => {
      const parsedResponse = response.safeParse(body)
      if (!parsedResponse.success) { warnings.push('Google Routes response was malformed; manual route facts were retained.'); return }
      for (const [index, value] of (parsedResponse.data.routes ?? []).entries()) {
        const option = normalizeRoute(value, kind, request, checkedAt, readyAt, driveMinutes, index, driveEnd)
        if (option) candidates.push(option); else warnings.push(COVERAGE_WARNING)
      }
    }
    const busAt = addMinutes(readyAt, 10)
    if (inTransitWindow(busAt)) addRoutes(await query(transitBody(AIRPORT, busAt, 'bus'), TRANSIT_MASK), 'bus', 0)
    if (readyMs < nowMs) warnings.push('Past DRIVE departure times are unsupported; North Station access was not invented.')
    else if (!context.signal.aborted) {
      const accessBody = await query({ origin: { address: AIRPORT }, destination: { address: NORTH_STATION }, travelMode: 'DRIVE', departureTime: new Date(readyMs).toISOString().replace('.000Z', 'Z'), routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'en-US', regionCode: 'us' }, DRIVE_MASK)
      const accessResponse = response.safeParse(accessBody)
      const accessRoute = driveRoute.safeParse(accessResponse.success ? accessResponse.data.routes?.[0] : undefined)
      if (accessRoute.success) {
        const value = accessRoute.data; const duration = seconds(value.duration)
        if (duration !== null && duration > 0 && inArea(value.legs[0].startLocation, 'BOS') && inArea(value.legs[0].endLocation, 'north')) {
          warnings.push(...(value.warnings ?? []).map(clean))
          const driveMinutes = Math.ceil(duration / 60)
          const railAt = addMinutes(readyAt, driveMinutes + 15)
          if (inTransitWindow(railAt)) addRoutes(await query(transitBody(NORTH_STATION, railAt, 'train'), TRANSIT_MASK), 'train', driveMinutes, value.legs[0].endLocation)
        } else warnings.push('Unsupported BOS to North Station access estimate omitted; no onward rail route was invented.')
      } else warnings.push('BOS to North Station access is unavailable; no onward rail route was invented.')
    }
    if (!candidates.length) return unavailable(notes([...warnings, 'No supported Google Maps route was found; retain manual route options.']).join(' ').slice(0, 500))
    return { status: 'ok', data: { candidates: candidates.slice(0, 8) }, evidence: candidates.flatMap(candidate => candidate.kind === 'bus' || candidate.kind === 'train' ? candidate.evidence : []), warnings: notes(warnings) }
  }
}
