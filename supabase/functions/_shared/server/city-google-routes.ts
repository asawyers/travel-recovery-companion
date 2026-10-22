import { z } from 'zod'
import { CityCandidateSchema, CitySchema, CityTripRequestSchema } from '../domain/city-contracts.ts'
import type { City, CityCandidate, CityLeg, CityPlace, CityTripRequest } from '../domain/city-contracts.ts'
import { toInstantMillis } from '../domain/time.ts'
import { providerJson } from './provider-http.ts'

export type CityProviderFacts = { candidates: CityCandidate[]; warnings: string[] }
export type RoutesEndpoint = { name: string; latitude: number; longitude: number; timeZone: string }
export type PointRoutesContext = { signal: AbortSignal; origin: RoutesEndpoint; destination: RoutesEndpoint; originToleranceMeters?: number; destinationToleranceMeters?: number }
type Context = PointRoutesContext
type Options = { enabled: boolean; apiKey?: string; now: () => string; fetch?: typeof fetch; fewerTransfersAlternative?: boolean; maxTransitCandidates?: number }
const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'
// Zones are localizedValues fields, not fields of TransitStopDetails. No URLs or instructions are requested.
const TRANSIT_MASK = [
  'routes.duration', 'routes.travelAdvisory.transitFare', 'routes.legs.startLocation', 'routes.legs.endLocation',
  'routes.legs.steps.startLocation', 'routes.legs.steps.endLocation', 'routes.legs.steps.staticDuration', 'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails.stopDetails', 'routes.legs.steps.transitDetails.localizedValues',
  'routes.legs.steps.transitDetails.transitLine.name', 'routes.legs.steps.transitDetails.transitLine.nameShort',
  'routes.legs.steps.transitDetails.transitLine.agencies.name', 'routes.legs.steps.transitDetails.transitLine.vehicle.type',
  'routes.legs.steps.transitDetails.tripShortText',
].join(',')
const DRIVE_MASK = 'routes.duration,routes.legs.startLocation,routes.legs.endLocation'
const DAY = 86_400_000
const AVAILABILITY = 'Google Maps transit times are schedule estimates; confirm current service, transfers, tickets and seats with each operator. No inventory was checked.'
const DRIVE_CONFIRMATION = 'Driving is an estimated duration without traffic. Confirm vehicle access and a rest plan, fuel, tolls, parking and any rental charges; no pickup, return or inventory is confirmed.'
const OMITTED = 'Unsupported or invalid Google Routes journey omitted; complete coordinates, supported modes and connected chronological steps are required.'
const ASAP_COVERAGE = 'ASAP lookup covers complete journeys within seven-day search coverage after readiness; this is not a traveler destination deadline.'
const ZONE_ESTIMATE = 'Stop time zone is estimated from the nearest selected endpoint when the provider omits its stop time zone; timestamp instants are preserved.'
const WALK_ESTIMATE = 'Walking duration and its start/end times are estimated from provider step duration; confirm pedestrian access and transfer time.'
const BOARDING_ID = 'Boarding identity uses the operator, service and scheduled trip/departure; this is not a confirmed physical vehicle ID.'
const bounded = (values: string[]) => [...new Set(values)].slice(0, 32)
const text = z.string().trim().min(1).max(500)
const location = z.object({ latLng: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }) })
const stop = z.object({ name: text, location })
const zone = z.string().min(1).max(100).refine(value => {
  if (/^[+-]/.test(value)) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true } catch { return false }
})
const localized = z.object({ timeZone: zone.optional() })
const details = z.object({
  stopDetails: z.object({ departureStop: stop, arrivalStop: stop, departureTime: z.string().max(40), arrivalTime: z.string().max(40) }),
  localizedValues: z.object({ departureTime: localized.optional(), arrivalTime: localized.optional() }).optional(),
  transitLine: z.object({ name: text.optional(), nameShort: text.optional(), agencies: z.array(z.object({ name: text })).min(1).max(16), vehicle: z.object({ type: z.string().max(64) }) }),
  tripShortText: z.string().trim().max(100).optional(),
})
const step = z.object({ travelMode: z.enum(['WALK', 'TRANSIT']), startLocation: location, endLocation: location, staticDuration: z.string().max(40), transitDetails: details.optional() })
const route = z.object({ duration: z.string().max(40), travelAdvisory: z.object({ transitFare: z.unknown().optional() }).optional(), legs: z.array(z.object({ startLocation: location, endLocation: location, steps: z.array(step).min(1).max(96) })).length(1) })
const driveRoute = z.object({ duration: z.string().max(40), legs: z.array(z.object({ startLocation: location, endLocation: location })).length(1) })
const response = z.object({ routes: z.array(z.unknown()).max(16).optional() })
type Location = z.infer<typeof location>
type Point = { latitude: number; longitude: number }
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/(?:https?:)?\/\/\S+/gi, '[link omitted]').trim().slice(0, 500)
const iso = (value: number) => new Date(value).toISOString()
function distance(a: Point, b: Point): number {
  const rad = (value: number) => value * Math.PI / 180
  const haversine = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, haversine)))
}
function seconds(value: string): number | null {
  if (!/^\d+(?:\.\d{1,9})?s$/.test(value)) return null
  const result = Number(value.slice(0, -1))
  return Number.isFinite(result) && result >= 0 && result <= 100 * DAY / 1000 ? result : null
}
function fareCents(value: unknown): number | null {
  // Google supplies this total only when the fare for every transit step is known. Count it once.
  const fare = z.object({ currencyCode: z.literal('USD'), units: z.string().regex(/^\d{1,9}$/).default('0'), nanos: z.number().int().min(0).max(999_999_999).default(0) }).safeParse(value)
  if (!fare.success || fare.data.nanos % 10_000_000 !== 0) return null
  const cents = Number(fare.data.units) * 100 + fare.data.nanos / 10_000_000
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : null
}
function place(value: Location, name: string): CityPlace & Point { return { ...value.latLng, name: clean(name) } }
function nearestZone(value: Point, context: Context): string {
  return distance(value, context.origin) <= distance(value, context.destination) ? context.origin.timeZone : context.destination.timeZone
}
function serviceDate(at: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(toInstantMillis(at))
  const part = (type: string) => parts.find(value => value.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
function evidence(type: 'schedule' | 'estimated', request: CityTripRequest, context: Context, checkedAt: string): CityCandidate['evidence'] {
  return [{ type, provider: 'Google Maps Routes API', sourceUrl: 'https://developers.google.com/maps/documentation/routes/transit-route', checkedAt,
    serviceDate: serviceDate(request.readyAt, context.origin.timeZone), providerUpdatedAt: null, expiresAt: iso(toInstantMillis(checkedAt) + 300_000), environment: 'production', warnings: [type === 'schedule' ? AVAILABILITY : DRIVE_CONFIRMATION] }]
}
const modes: Record<string, CityLeg['mode'] | undefined> = {
  BUS: 'bus', INTERCITY_BUS: 'bus', TROLLEYBUS: 'bus', SUBWAY: 'subway', TRAM: 'tram', METRO_RAIL: 'tram', FERRY: 'ferry',
  RAIL: 'rail', HEAVY_RAIL: 'rail', COMMUTER_TRAIN: 'rail', HIGH_SPEED_TRAIN: 'rail', LONG_DISTANCE_TRAIN: 'rail', MONORAIL: 'rail',
}
/** Stable boarding identity is derived only from actual schedule fields; no physical vehicle is claimed. */
function boardingId(operator: string, service: string, trip: string | undefined, departure: string): string {
  const source = `${operator}|${service}|${trip ?? ''}|${departure}`
  let hash = 2166136261
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619)
  return `${clean(trip || service).slice(0, 70)}-${(hash >>> 0).toString(16)}`
}
function normalizeTransit(input: unknown, request: CityTripRequest, context: Context, checkedAt: string, id: string): CityCandidate | null {
  const parsed = route.safeParse(input)
  if (!parsed.success) return null
  const value = parsed.data, source = value.legs[0], duration = seconds(value.duration)
  if (duration === null || duration <= 0 || distance(source.startLocation.latLng, context.origin) > (context.originToleranceMeters ?? 5_000) || distance(source.endLocation.latLng, context.destination) > (context.destinationToleranceMeters ?? 5_000)) return null
  if (distance(source.startLocation.latLng, source.steps[0].startLocation.latLng) > 250 || distance(source.endLocation.latLng, source.steps.at(-1)!.endLocation.latLng) > 250) return null
  const legs: CityLeg[] = []
  let cursor = toInstantMillis(request.readyAt), previous = place(source.startLocation, context.origin.name), travelMilliseconds = 0, rides = 0
  const push = (leg: Omit<CityLeg, 'id'>) => { legs.push({ id: `${id}-leg-${legs.length + 1}`, ...leg }) }
  try {
    for (const item of source.steps) {
      const length = seconds(item.staticDuration)
      if (length === null) return null
      const from = place(item.startLocation, 'Provider walking step start'), to = place(item.endLocation, 'Provider walking step end')
      if (distance(previous, from) > 250) return null
      if (item.travelMode === 'WALK') {
        if (item.transitDetails || (length === 0 && distance(from, to) > 1)) return null
        push({ mode: 'walk', from, to, startAt: iso(cursor), endAt: iso(cursor + length * 1000), departureTimeZone: nearestZone(from, context), arrivalTimeZone: nearestZone(to, context), operator: null, service: null, vehicleId: null, assumptions: [WALK_ESTIMATE, ZONE_ESTIMATE] })
        cursor += length * 1000
      } else {
        if (!item.transitDetails) return null
        const detail = item.transitDetails, stops = detail.stopDetails, line = detail.transitLine, mode = modes[line.vehicle.type]
        const departure = toInstantMillis(stops.departureTime), arrival = toInstantMillis(stops.arrivalTime)
        if (!mode || arrival <= departure || departure < cursor || Math.abs(arrival - departure - length * 1000) > 1000) return null
        if (distance(from, stops.departureStop.location.latLng) > 250 || distance(to, stops.arrivalStop.location.latLng) > 250) return null
        const departurePlace = place(stops.departureStop.location, stops.departureStop.name), arrivalPlace = place(stops.arrivalStop.location, stops.arrivalStop.name)
        if (distance(previous, departurePlace) > 250) return null
        const departureZone = detail.localizedValues?.departureTime?.timeZone, arrivalZone = detail.localizedValues?.arrivalTime?.timeZone
        const depZone = departureZone ?? nearestZone(departurePlace, context), arrZone = arrivalZone ?? nearestZone(arrivalPlace, context)
        const operator = clean(line.agencies.map(agency => agency.name).join(', ')), service = clean(line.name ?? line.nameShort ?? '')
        if (!operator || !service) return null
        if (departure > cursor) push({ mode: 'wait', from: { ...previous }, to: { ...previous }, startAt: iso(cursor), endAt: iso(departure), departureTimeZone: legs.at(-1)?.arrivalTimeZone ?? nearestZone(previous, context), arrivalTimeZone: legs.at(-1)?.arrivalTimeZone ?? nearestZone(previous, context), operator: null, service: null, vehicleId: null, assumptions: ['Wait at the preceding actual place until the scheduled departure; no transfer travel is inferred.'] })
        push({ mode, from: departurePlace, to: arrivalPlace, startAt: iso(departure), endAt: iso(arrival), departureTimeZone: depZone, arrivalTimeZone: arrZone, operator, service, vehicleId: boardingId(operator, service, detail.tripShortText, iso(departure)), assumptions: [BOARDING_ID, ...(!departureZone || !arrivalZone ? [ZONE_ESTIMATE] : [])] })
        cursor = arrival; rides++
      }
      previous = (legs.at(-1)!.to as CityPlace & Point)
      travelMilliseconds += length * 1000
      if (legs.length > 96) return null
    }
    if (!rides || distance(legs[0].from as CityPlace & Point, context.origin) > (context.originToleranceMeters ?? 5_000) || distance(previous, context.destination) > (context.destinationToleranceMeters ?? 5_000)) return null
    // A route duration may omit initial waiting, but cannot omit travel or exceed the whole journey.
    if (duration * 1000 + 1000 < travelMilliseconds || duration * 1000 > cursor - toInstantMillis(request.readyAt) + 1000) return null
    const candidate = CityCandidateSchema.safeParse({ id, title: 'Google Maps city transit schedule', kind: 'transit', originCityId: request.originCityId, destinationCityId: request.destinationCityId,
      legs, costs: [{ label: 'Total route transit fare including all transit steps', cents: fareCents(value.travelAdvisory?.transitFare), currency: 'USD', includedInOtherCharge: false }], evidence: evidence('schedule', request, context, checkedAt), confirmations: [AVAILABILITY] })
    return candidate.success ? candidate.data : null
  } catch { return null }
}
function normalizeDrive(input: unknown, request: CityTripRequest, context: Context, checkedAt: string, id: string): CityCandidate | null {
  const parsed = driveRoute.safeParse(input)
  if (!parsed.success) return null
  const duration = seconds(parsed.data.duration), source = parsed.data.legs[0]
  if (duration === null || duration <= 0 || distance(source.startLocation.latLng, context.origin) > (context.originToleranceMeters ?? 5_000) || distance(source.endLocation.latLng, context.destination) > (context.destinationToleranceMeters ?? 5_000)) return null
  const candidate = CityCandidateSchema.safeParse({ id, title: 'Google Maps driving duration estimate', kind: 'driving_estimate', originCityId: request.originCityId, destinationCityId: request.destinationCityId,
    legs: [{ id: `${id}-drive`, mode: 'drive', from: place(source.startLocation, context.origin.name), to: place(source.endLocation, context.destination.name), startAt: iso(toInstantMillis(request.readyAt)), endAt: iso(toInstantMillis(request.readyAt) + duration * 1000), departureTimeZone: context.origin.timeZone, arrivalTimeZone: context.destination.timeZone, operator: null, service: null, vehicleId: null, assumptions: [DRIVE_CONFIRMATION] }],
    costs: [{ label: 'Vehicle, fuel, tolls, parking and rental charges unconfirmed', cents: null, currency: 'USD', includedInOtherCharge: false }], evidence: evidence('estimated', request, context, checkedAt), confirmations: [DRIVE_CONFIRMATION] })
  return candidate.success ? candidate.data : null
}

/** Explicit, bounded investigation of trusted coordinate endpoints; no catalog or fixture fallback. */
export function createPointGoogleRoutesAdapter(options: Options) {
  return async (input: CityTripRequest, context: Context): Promise<CityProviderFacts> => {
    const unavailable = (warning: string): CityProviderFacts => ({ candidates: [], warnings: [warning] })
    if (!options.enabled || !options.apiKey?.trim() || input.mode !== 'real') return unavailable('Google Routes city investigation is unavailable; no live route facts were invented.')
    const endpoint = z.object({ name: text, latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), timeZone: zone })
    const parsed = CityTripRequestSchema.safeParse(input), origin = endpoint.safeParse(context.origin), destination = endpoint.safeParse(context.destination)
    if (!parsed.success || !origin.success || !destination.success) return unavailable('Invalid route request or endpoint metadata; lookup was not performed.')
    if (context.signal.aborted) return unavailable('Google Routes city investigation was cancelled.')
    const request = parsed.data
    let checkedAt: string, now: number, ready: number
    try { checkedAt = options.now(); now = toInstantMillis(checkedAt); ready = toInstantMillis(request.readyAt) } catch { return unavailable('Google Routes city timing is invalid; lookup was not performed.') }
    if (ready < now - 7 * DAY || ready > now + 100 * DAY) return unavailable('Google Routes transit date is outside its seven-days-past / 100-days-future coverage; lookup was not performed.')
    const warnings: string[] = request.deadlineAt === null ? [ASAP_COVERAGE] : []
    const candidates: CityCandidate[] = []
    const itineraries = new Set<string>()
    const addCandidate = (candidate: CityCandidate) => {
      // Query-specific IDs and collection metadata do not make a different travel option.
      // Preserve actual places, schedule instants, zones, operators, trips, assumptions and prices.
      const key = JSON.stringify({ kind: candidate.kind, originCityId: candidate.originCityId, destinationCityId: candidate.destinationCityId,
        legs: candidate.legs.map(({ id: _id, ...leg }) => leg), costs: candidate.costs })
      if (itineraries.has(key)) return
      itineraries.add(key)
      candidates.push(candidate)
    }
    let calls = 0
    const query = async (body: Record<string, unknown>, mask: string): Promise<unknown[]> => {
      if (context.signal.aborted || calls >= 3) return []
      calls++
      const result = await providerJson(options.fetch ?? fetch, ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': options.apiKey!.trim(), 'X-Goog-FieldMask': mask }, body: JSON.stringify(body) }, context.signal)
      if (!result.ok) {
        const reason = `${result.status === undefined ? result.kind : `HTTP ${result.status}`}${result.diagnostic ? `; ${result.diagnostic}` : ''}`
        warnings.push(`Google Routes lookup failed (${reason}); no route facts were invented.`)
        return []
      }
      const envelope = response.safeParse(result.body)
      if (!envelope.success) { warnings.push(OMITTED); return [] }
      return envelope.data.routes ?? []
    }
    const base = { origin: { location: { latLng: { latitude: origin.data.latitude, longitude: origin.data.longitude } } }, destination: { location: { latLng: { latitude: destination.data.latitude, longitude: destination.data.longitude } } }, languageCode: 'en-US', regionCode: 'us' }
    const transitBody = { ...base, travelMode: 'TRANSIT', departureTime: iso(ready), computeAlternativeRoutes: true }
    const addTransit = (raw: unknown[], queryId: number) => {
      for (const [index, item] of raw.entries()) {
        if (candidates.length >= 12 || candidates.filter(candidate => candidate.kind === 'transit').length >= (options.maxTransitCandidates ?? 12)) break
        const candidate = normalizeTransit(item, request, context, checkedAt, `google-city-transit-${queryId}-${index + 1}`)
        if (candidate) addCandidate(candidate); else warnings.push(OMITTED)
      }
    }
    addTransit(await query(transitBody, TRANSIT_MASK), 1)
    if (options.fewerTransfersAlternative !== false && request.priority === 'fewest_transfers') addTransit(await query({ ...transitBody, transitPreferences: { routingPreference: 'FEWER_TRANSFERS' } }, TRANSIT_MASK), 2)
    if (request.drivingAllowed && !context.signal.aborted && candidates.length < 12) {
      for (const [index, item] of (await query({ ...base, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }, DRIVE_MASK)).entries()) {
        if (candidates.length >= 12) break
        const candidate = normalizeDrive(item, request, context, checkedAt, `google-city-drive-${index + 1}`)
        if (candidate) addCandidate(candidate); else warnings.push(OMITTED)
      }
    }
    if (context.signal.aborted) warnings.push('Google Routes city investigation was cancelled; no further requests were made.')
    if (!candidates.length) warnings.push('No supported complete Google Maps city route was found; coverage does not establish that no transportation exists.')
    return { candidates, warnings: bounded(warnings) }
  }
}

/** City searches retain strict canonical city bindings; point searches never impersonate a city. */
export function createCityGoogleRoutesAdapter(options: Options) {
  const routePoints = createPointGoogleRoutesAdapter(options)
  return async (input: CityTripRequest, context: { signal: AbortSignal; origin: City; destination: City }): Promise<CityProviderFacts> => {
    const origin = CitySchema.safeParse(context.origin), destination = CitySchema.safeParse(context.destination)
    if (!origin.success || !destination.success || origin.data.id !== input.originCityId || destination.data.id !== input.destinationCityId) {
      return { candidates: [], warnings: ['Invalid city request or mismatched city metadata; lookup was not performed.'] }
    }
    return routePoints(input, { signal: context.signal, origin: { ...origin.data, name: `${origin.data.name} city center` }, destination: { ...destination.data, name: `${destination.data.name} city center` } })
  }
}
