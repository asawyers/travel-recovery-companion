import { Temporal } from '@js-temporal/polyfill'
import {
  AirportSchema,
  type City,
  type FlightOffer,
  flightOfferFingerprint,
  flightOfferId,
  FlightOfferSchema,
  type FlightSegment,
  hotelOfferFingerprint,
  hotelOfferId,
  type NationalHotelOffer,
  NationalHotelOfferSchema,
  TRAVEL_MAX_FACT_AGE_MS,
  type TravelAirport,
  type TravelRecoveryInput,
  TravelRecoveryInputSchema,
  type TravelSourceStatus,
} from '../domain/travel-contracts.ts'
import { CitySchema } from '../domain/city-contracts.ts'
import { findAirport } from '../domain/airport-metadata.ts'
import type { CostLine, SourceEvidence } from '../domain/schemas.ts'
import { serpApiJson } from './serpapi-http.ts'

export type TravelProviderContext = {
  origin: City
  destination: City
  originAirport: TravelAirport
  destinationAirport: TravelAirport
  signal: AbortSignal
}
export type TravelProviderResult<T> = { offers: T[]; sourceStatus: TravelSourceStatus; warnings: string[] }
export type TravelProvider = {
  flights(
    input: TravelRecoveryInput,
    context: TravelProviderContext,
  ): Promise<TravelProviderResult<FlightOffer>>
  hotels(
    input: TravelRecoveryInput,
    context: TravelProviderContext,
  ): Promise<TravelProviderResult<NationalHotelOffer>>
}

type Options = {
  enabled: boolean
  apiKey?: string
  now: () => string
  fetch?: typeof fetch
  resolveAirport?: (iata: string) => TravelAirport | undefined
}
type Source = 'flights' | 'hotels'
type ObjectValue = Record<string, unknown>
const object = (v: unknown): ObjectValue =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as ObjectValue : {}
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const SOURCES = {
  flights: 'https://serpapi.com/google-flights-api',
  hotels: 'https://serpapi.com/google-hotels-api',
}
const PROVIDERS = { flights: 'SerpApi Google Flights search', hotels: 'SerpApi Google Hotels search' }
const OMITTED =
  'Some search results were omitted because their identity, location, schedule, or price context could not be verified.'
const AGE_WARNING =
  'Search evidence is missing, stale, or invalid. Run a new search before selecting an offer.'
const FLIGHT_WARNINGS = [
  'Observed search schedule and price only; seats, airline inventory, baggage, extras, and ticket conditions require recheck.',
  'Airport transfers, processing time, connection allowances, and ticket protection require confirmation.',
  'The five-minute evidence limit is an application freshness limit, not a guaranteed fare expiry.',
  'Google Travel opens an external search for rechecking; it does not reserve or book travel.',
]
const HOTEL_WARNINGS = [
  'Observed search rate only; property availability, room terms, policies, and additional hotel fees require recheck.',
  'Property time zone is estimated from the origin city; confirm local check-in and check-out arrangements.',
  'The five-minute evidence limit is an application freshness limit, not a guaranteed rate expiry.',
  'Google Travel opens an external search for rechecking; it does not reserve a room.',
]

// Descriptive strings are data. Reject markup and URLs rather than passing source instructions or links onward.
function clean(value: unknown, key: string | undefined, limit = 500): string | null {
  if (typeof value !== 'string' || value.length > 16_384) return null
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim()
  if (!text || /[<>]|https?:|www\.|javascript:|data:/i.test(text) || (key && text.includes(key))) return null
  return text.slice(0, limit)
}
function digest(value: unknown): string {
  const text = JSON.stringify(value)
  return [2166136261, 3335557771, 1234567891, 4093082899].map((seed) => {
    let hash = seed
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
    return (hash >>> 0).toString(16).padStart(8, '0')
  }).join('')
}
function result<T>(
  source: Source,
  checkedAt: string,
  status: TravelSourceStatus['status'],
  offers: T[] = [],
  warnings: string[] = [],
  expiresAt: string | null = null,
): TravelProviderResult<T> {
  const messages = {
    unavailable:
      'Search is unavailable for this request. Check the selected airports, dates, and search configuration.',
    limited: 'Some search evidence could not be verified. Recheck details before selecting an offer.',
    empty: 'No matching offers were found in this search.',
    available:
      'Observed search offers are available for external rechecking; availability and prices are not guaranteed.',
  }
  return {
    offers,
    sourceStatus: { source, status, message: messages[status], checkedAt, expiresAt },
    warnings,
  }
}
function utc(value: unknown): Temporal.Instant | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(value)
    ? value.replace(' ', 'T').replace(' UTC', 'Z')
    : value
  if (!/Z$|\+00:00$/.test(normalized)) return null
  try {
    return Temporal.Instant.from(normalized)
  } catch {
    return null
  }
}
function evidence(source: Source, body: ObjectValue, date: string, fetchedAt: string): SourceEvidence | null {
  const metadata = object(body.search_metadata), check = utc(metadata.created_at)
  let now: Temporal.Instant
  try {
    now = Temporal.Instant.from(fetchedAt)
  } catch {
    return null
  }
  if (
    !check || now.epochMilliseconds - check.epochMilliseconds < 0 ||
    now.epochMilliseconds - check.epochMilliseconds >= TRAVEL_MAX_FACT_AGE_MS
  ) return null
  const updated = metadata.processed_at === undefined ? null : utc(metadata.processed_at)
  if (
    metadata.processed_at !== undefined &&
    (!updated || updated.epochMilliseconds > now.epochMilliseconds ||
      updated.epochMilliseconds < check.epochMilliseconds)
  ) return null
  let expiry = check.add({ milliseconds: TRAVEL_MAX_FACT_AGE_MS })
  if (metadata.expires_at !== undefined) {
    const explicit = utc(metadata.expires_at)
    if (!explicit || explicit.epochMilliseconds <= now.epochMilliseconds) return null
    if (Temporal.Instant.compare(explicit, expiry) < 0) expiry = explicit
  }
  return {
    type: 'estimated',
    environment: 'production',
    provider: PROVIDERS[source],
    sourceUrl: SOURCES[source],
    checkedAt: check.toString(),
    providerUpdatedAt: updated?.toString() ?? null,
    serviceDate: date,
    expiresAt: expiry.toString(),
    warnings: [...(source === 'flights' ? FLIGHT_WARNINGS : HOTEL_WARNINGS)],
  }
}
function safeHandoff(value: unknown, kind: Source, apiKey: string | undefined): string | null {
  if (typeof value !== 'string' || value.length > 2048 || (apiKey && value.includes(apiKey))) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' || !['www.google.com', 'google.com'].includes(url.hostname) || url.port ||
      url.username || url.password || url.hash ||
      ![`/travel/${kind}`, `/travel/${kind}/`].includes(url.pathname)
    ) return null
    if (
      [...url.searchParams.keys()].some((k) => !['q', 'hl', 'gl', 'curr', 'tfs', 'tfu'].includes(k)) ||
      (apiKey && [...url.searchParams.values()].some((value) => value.includes(apiKey)))
    ) return null
    return url.toString()
  } catch {
    return null
  }
}
function handoff(kind: Source, query: string): string | null {
  const url = new URL(`https://www.google.com/travel/${kind}`)
  url.searchParams.set('q', query)
  url.searchParams.set('hl', 'en')
  url.searchParams.set('gl', 'us')
  url.searchParams.set('curr', 'USD')
  return safeHandoff(url.toString(), kind, undefined)
}
function resolve(code: unknown, resolver: (iata: string) => TravelAirport | undefined): TravelAirport | null {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return null
  try {
    const airport = resolver(code), parsed = AirportSchema.safeParse(airport)
    return parsed.success && parsed.data.iata === code ? parsed.data : null
  } catch {
    return null
  }
}
function valid(
  input: TravelRecoveryInput,
  context: TravelProviderContext,
  source: Source,
  options: Options,
  attemptedAt: string,
): boolean {
  if (
    !options.enabled || !options.apiKey?.trim() || !input?.investigate || context?.signal?.aborted ||
    typeof context?.signal?.addEventListener !== 'function'
  ) return false
  if (
    !TravelRecoveryInputSchema.safeParse(input).success || !CitySchema.safeParse(context.origin).success ||
    !CitySchema.safeParse(context.destination).success ||
    !AirportSchema.safeParse(context.originAirport).success ||
    !AirportSchema.safeParse(context.destinationAirport).success
  ) return false
  if (
    context.origin.id !== input.trip.originCityId ||
    context.destination.id !== input.trip.destinationCityId ||
    context.originAirport.iata !== input.originAirportIata ||
    context.destinationAirport.iata !== input.destinationAirportIata ||
    input.originAirportIata === input.destinationAirportIata
  ) return false
  const resolver = options.resolveAirport ?? findAirport
  for (const selected of [context.originAirport, context.destinationAirport]) {
    const airport = resolve(selected.iata, resolver)
    if (
      !airport || airport.timeZone !== selected.timeZone || airport.latitude !== selected.latitude ||
      airport.longitude !== selected.longitude
    ) return false
  }
  try {
    const timeZone = source === 'flights' ? context.originAirport.timeZone : context.origin.timeZone
    const today = Temporal.Instant.from(attemptedAt).toZonedDateTimeISO(timeZone).toPlainDate()
    const ready = Temporal.Instant.from(input.trip.readyAt).toZonedDateTimeISO(timeZone)
      .toPlainDate()
    const departure = Temporal.PlainDate.from(input.departureDate)
    if (
      Temporal.PlainDate.compare(departure, today) < 0 ||
      Temporal.PlainDate.compare(departure, today.add({ days: 330 })) > 0 ||
      Temporal.PlainDate.compare(departure, ready) < 0
    ) return false
    if (source === 'hotels') {
      if (!input.overnight || input.overnight.checkout !== input.departureDate) return false
      const checkin = Temporal.PlainDate.from(input.overnight.checkin)
      if (Temporal.PlainDate.compare(checkin, today) < 0 || Temporal.PlainDate.compare(checkin, ready) < 0) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}
// Optional echoed search parameters may narrow trust, never override the bound request.
function boundResponse(body: ObjectValue, parameters: Record<string, string>): boolean {
  const echoed = object(body.search_parameters)
  return Object.entries(parameters).every(([key, value]) =>
    echoed[key] === undefined || String(echoed[key]) === value
  )
}
function cents(value: unknown): number | null {
  if (!finite(value) || value < 0 || value > 1_000_000) return null
  const amount = Math.round(value * 100)
  return Math.abs(amount / 100 - value) < 0.0000001 ? amount : null
}
function currencyMatches(...values: unknown[]): boolean {
  return values.every((v) => v === undefined || v === 'USD')
}
function cost(label: string, amount: number | null): CostLine {
  return { label, cents: amount, currency: 'USD', includedInOtherCharge: false }
}
function airportTime(value: unknown, airport: TravelAirport): Temporal.Instant | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return null
  try {
    return Temporal.PlainDateTime.from(value.replace(' ', 'T'), { overflow: 'reject' }).toZonedDateTime(
      airport.timeZone,
      { disambiguation: 'reject' },
    ).toInstant()
  } catch {
    return null
  }
}
function flight(
  raw: unknown,
  input: TravelRecoveryInput,
  e: SourceEvidence,
  options: Options,
  body: ObjectValue,
): FlightOffer | null {
  const item = object(raw), flights = list(item.flights)
  if (
    !flights.length || flights.length > 8 ||
    (item.type !== undefined && item.type !== 'One way' && item.type !== 'One-way')
  ) return null
  const segments: FlightSegment[] = []
  let lastArrival: Temporal.Instant | null = null
  for (const rawSegment of flights) {
    const s = object(rawSegment), from = object(s.departure_airport), to = object(s.arrival_airport)
    const origin = resolve(from.id, options.resolveAirport ?? findAirport),
      destination = resolve(to.id, options.resolveAirport ?? findAirport)
    if (!origin || !destination || origin.iata === destination.iata) return null
    const departure = airportTime(from.time, origin), arrival = airportTime(to.time, destination)
    const carrier = clean(s.airline, options.apiKey), flightNumber = clean(s.flight_number, options.apiKey)
    if (!departure || !arrival || !carrier || !flightNumber || !finite(s.duration) || s.duration <= 0) {
      return null
    }
    const actualDuration = (arrival.epochMilliseconds - departure.epochMilliseconds) / 60_000
    if (
      actualDuration <= 0 || actualDuration !== s.duration ||
      (lastArrival && departure.epochMilliseconds < lastArrival.epochMilliseconds)
    ) return null
    const identity = digest([
      origin.iata,
      destination.iata,
      departure.toString(),
      arrival.toString(),
      carrier,
      flightNumber,
    ])
    segments.push({
      id: `segment-${identity}`,
      boardingId: `boarding-${identity}`,
      originAirport: origin,
      destinationAirport: destination,
      departureAt: departure.toString(),
      arrivalAt: arrival.toString(),
      carrier,
      flightNumber,
      durationMinutes: actualDuration,
      evidence: [e],
    })
    lastArrival = arrival
  }
  const first = segments[0], last = segments.at(-1)!
  if (
    first.originAirport.iata !== input.originAirportIata ||
    last.destinationAirport.iata !== input.destinationAirportIata ||
    object(object(flights[0]).departure_airport).time?.toString().slice(0, 10) !== input.departureDate
  ) return null
  const start = Temporal.Instant.from(first.departureAt), end = Temporal.Instant.from(last.arrivalAt)
  if (
    start.epochMilliseconds < Temporal.Instant.from(input.trip.readyAt).epochMilliseconds ||
    !finite(item.total_duration) ||
    item.total_duration !== (end.epochMilliseconds - start.epochMilliseconds) / 60_000
  ) return null
  if (item.layovers !== undefined) {
    const layovers = list(item.layovers)
    if (
      layovers.length !== segments.length - 1 || layovers.some((v, index) =>
        object(v).duration !==
          (Temporal.Instant.from(segments[index + 1].departureAt).epochMilliseconds -
              Temporal.Instant.from(segments[index].arrivalAt).epochMilliseconds) / 60_000
      )
    ) return null
  }
  const payload = {
    originCityId: input.trip.originCityId,
    destinationCityId: input.trip.destinationCityId,
    departureDate: input.departureDate,
    originAirportIata: input.originAirportIata,
    destinationAirportIata: input.destinationAirportIata,
    handoffUrl: safeHandoff(object(body.search_metadata).google_flights_url, 'flights', options.apiKey) ??
      handoff(
        'flights',
        `One way flights ${first.originAirport.iata} to ${last.destinationAirport.iata} on ${input.departureDate} for 1 adult economy`,
      ),
    segments,
    costs: [
      cost(
        'Observed one-way flight fare; baggage and extras require recheck',
        currencyMatches(item.currency, body.currency) ? cents(item.price) : null,
      ),
    ],
    evidence: [e],
  }
  const parsed = FlightOfferSchema.safeParse({
    ...payload,
    id: flightOfferId(payload),
    fingerprint: flightOfferFingerprint(payload),
  })
  return parsed.success ? parsed.data : null
}
function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) *
      Math.sin((b.longitude - a.longitude) * rad / 2) ** 2
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}
function hotelCost(item: ObjectValue, body: ObjectValue): CostLine {
  const total = object(item.total_rate), nightly = object(item.rate_per_night)
  if (!currencyMatches(item.currency, body.currency, total.currency, nightly.currency)) {
    return cost('Observed hotel price unknown; additional fees unknown', null)
  }
  // Numeric extracted values are denominated by the explicitly USD-bound request. A contrary displayed currency fails closed.
  const amount = (rate: ObjectValue, field: 'lowest' | 'before_taxes_fees'): number | null => {
    const display = rate[field]
    if (typeof display === 'string' && !/^\s*(?:USD\s*)?\$[\d,.]+\s*(?:USD)?\s*$/.test(display)) return null
    return cents(rate[field === 'lowest' ? 'extracted_lowest' : 'extracted_before_taxes_fees'])
  }
  let price = amount(total, 'lowest')
  if (price !== null) return cost('Observed whole-stay hotel total; additional fees require recheck', price)
  price = amount(total, 'before_taxes_fees')
  if (price !== null) {
    return cost('Observed whole-stay hotel estimate before taxes; additional fees unknown', price)
  }
  price = amount(nightly, 'lowest')
  if (price !== null) return cost('Observed one-night hotel estimate; additional fees unknown', price)
  price = amount(nightly, 'before_taxes_fees')
  return cost(
    price === null
      ? 'Observed hotel price unknown; additional fees unknown'
      : 'Observed one-night hotel estimate before taxes; additional fees unknown',
    price,
  )
}
function hotel(
  raw: unknown,
  input: TravelRecoveryInput,
  context: TravelProviderContext,
  e: SourceEvidence,
  options: Options,
  body: ObjectValue,
): NationalHotelOffer | null {
  const item = object(raw), coords = object(item.gps_coordinates), name = clean(item.name, options.apiKey)
  const token = typeof item.property_token === 'string' ? item.property_token : item.property_id ?? item.id
  if (
    typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(token) ||
    (options.apiKey && token.includes(options.apiKey)) || !name || !finite(coords.latitude) ||
    !finite(coords.longitude) || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180 ||
    !input.overnight
  ) return null
  const location = { latitude: coords.latitude, longitude: coords.longitude }
  if (distanceKm(context.origin, location) > 50) return null
  if (
    (item.check_in_date !== undefined && item.check_in_date !== input.overnight.checkin) ||
    (item.check_out_date !== undefined && item.check_out_date !== input.overnight.checkout) ||
    (item.adults !== undefined && item.adults !== 1) || (item.rooms !== undefined && item.rooms !== 1)
  ) return null
  const payload = {
    originCityId: context.origin.id,
    propertyId: `serpapi-property-${digest(token)}`,
    name,
    ...location,
    handoffUrl: handoff(
      'hotels',
      `${name} ${context.origin.name} ${context.origin.stateCode} ${context.origin.countryCode} ${input.overnight.checkin} ${input.overnight.checkout} 1 adult 1 room`,
    ),
    address: clean(item.address, options.apiKey),
    timeZone: context.origin.timeZone,
    timeZoneStatus: 'estimated_from_origin_city' as const,
    checkin: input.overnight.checkin,
    checkout: input.overnight.checkout,
    adults: 1 as const,
    rooms: 1 as const,
    room: clean(item.room, options.apiKey),
    cancellation: clean(item.cancellation_policy ?? item.cancellation, options.apiKey, 4000),
    checkinPolicy: clean(item.check_in_time ?? item.check_in_policy, options.apiKey, 4000),
    checkoutPolicy: clean(item.check_out_time ?? item.check_out_policy, options.apiKey, 4000),
    costs: [hotelCost(item, body)],
    evidence: [e],
  }
  const parsed = NationalHotelOfferSchema.safeParse({
    ...payload,
    id: hotelOfferId(payload),
    fingerprint: hotelOfferFingerprint(payload),
  })
  return parsed.success ? parsed.data : null
}
function knownCost(offer: { costs: CostLine[] }): number {
  return offer.costs[0]?.cents ?? Infinity
}
function compareFlights(
  priority: TravelRecoveryInput['trip']['priority'],
  a: FlightOffer,
  b: FlightOffer,
): number {
  const arrival = () =>
    Temporal.Instant.compare(
      Temporal.Instant.from(a.segments.at(-1)!.arrivalAt),
      Temporal.Instant.from(b.segments.at(-1)!.arrivalAt),
    )
  const price = () => {
    const aa = knownCost(a), bb = knownCost(b)
    return aa === bb ? 0 : aa < bb ? -1 : 1
  }
  const transfers = () => a.segments.length - b.segments.length
  return (priority === 'cheapest'
    ? price() || arrival() || transfers()
    : priority === 'fewest_transfers'
    ? transfers() || arrival() || price()
    : arrival() || price() || transfers()) || a.id.localeCompare(b.id)
}

// Preserve a selected identity only when the bounded fresh response actually reacquired it.
function topOffers<T extends { id: string }>(ranked: T[], selectedId: string | null | undefined): T[] {
  const output = ranked.slice(0, 3)
  if (selectedId && !output.some((offer) => offer.id === selectedId)) {
    const selected = ranked.find((offer) => offer.id === selectedId)
    if (selected) output[2] = selected
  }
  return output
}

/** One explicitly requested, bounded search per method. No pagination, booking, or quota-expanding followups. */
export function createSerpApiTravelAdapter(configuration: Options): TravelProvider {
  const options: Options = { ...configuration, apiKey: configuration.apiKey?.trim() }
  return {
    async flights(input, context) {
      const attemptedAt = options.now()
      if (!valid(input, context, 'flights', options, attemptedAt)) {
        return result('flights', attemptedAt, 'unavailable')
      }
      const parameters: Record<string, string> = {
        departure_id: input.originAirportIata,
        arrival_id: input.destinationAirportIata,
        outbound_date: input.departureDate,
        type: '2',
        adults: '1',
        currency: 'USD',
        travel_class: '1',
        gl: 'us',
        hl: 'en',
        no_cache: 'true',
      }
      const ready = Temporal.Instant.from(input.trip.readyAt).toZonedDateTimeISO(
        context.originAirport.timeZone,
      )
      if (ready.toPlainDate().toString() === input.departureDate) {
        parameters.outbound_times = `${ready.hour},23`
      }
      const response = await serpApiJson({
        apiKey: options.apiKey!,
        engine: 'google_flights',
        parameters,
        signal: context.signal,
        fetch: options.fetch,
      })
      if (!response.ok) {
        return result('flights', attemptedAt, 'unavailable', [], [
          'Flight search could not be completed. Try again later.',
        ])
      }
      const body = object(response.body), e = evidence('flights', body, input.departureDate, options.now())
      if (!e || !boundResponse(body, parameters)) {
        return result('flights', attemptedAt, 'limited', [], [AGE_WARNING])
      }
      const raw = [...list(body.best_flights).slice(0, 32), ...list(body.other_flights).slice(0, 32)].slice(
        0,
        32,
      )
      const offers = new Map<string, FlightOffer>()
      let omitted = ['best_flights', 'other_flights'].some((key) =>
        body[key] !== undefined && !Array.isArray(body[key])
      )
      for (const item of raw) {
        const offer = flight(item, input, e, options, body)
        if (offer) { if (!offers.has(offer.id)) offers.set(offer.id, offer) }
        else omitted = true
      }
      const output = topOffers(
        [...offers.values()].sort((a, b) => compareFlights(input.trip.priority, a, b)),
        input.selection?.flightOfferId,
      )
      return result(
        'flights',
        attemptedAt,
        omitted ? 'limited' : output.length ? 'available' : 'empty',
        output,
        omitted ? [OMITTED] : [],
        output.length ? e.expiresAt : null,
      )
    },
    async hotels(input, context) {
      const attemptedAt = options.now()
      if (!valid(input, context, 'hotels', options, attemptedAt)) {
        return result('hotels', attemptedAt, 'unavailable')
      }
      const parameters = {
        q: `Hotels in ${context.origin.name} ${context.origin.stateCode} ${context.origin.countryCode}`,
        check_in_date: input.overnight!.checkin,
        check_out_date: input.overnight!.checkout,
        adults: '1',
        currency: 'USD',
        gl: 'us',
        hl: 'en',
        no_cache: 'true',
      }
      const response = await serpApiJson({
        apiKey: options.apiKey!,
        engine: 'google_hotels',
        parameters,
        signal: context.signal,
        fetch: options.fetch,
      })
      if (!response.ok) {
        return result('hotels', attemptedAt, 'unavailable', [], [
          'Hotel search could not be completed. Try again later.',
        ])
      }
      const body = object(response.body),
        e = evidence('hotels', body, input.overnight!.checkin, options.now())
      if (!e || !boundResponse(body, parameters)) {
        return result('hotels', attemptedAt, 'limited', [], [AGE_WARNING])
      }
      const offers = new Map<string, NationalHotelOffer>()
      let omitted = body.properties !== undefined && !Array.isArray(body.properties)
      for (const item of list(body.properties).slice(0, 32)) {
        const offer = hotel(item, input, context, e, options, body)
        if (offer) { if (!offers.has(offer.id)) offers.set(offer.id, offer) }
        else omitted = true
      }
      const output = topOffers(
        [...offers.values()].sort((a, b) => {
          const aa = knownCost(a), bb = knownCost(b)
          return (aa === bb ? 0 : aa < bb ? -1 : 1) || a.id.localeCompare(b.id)
        }),
        input.selection?.hotelOfferId,
      )
      return result(
        'hotels',
        attemptedAt,
        omitted ? 'limited' : output.length ? 'available' : 'empty',
        output,
        omitted ? [OMITTED] : [],
        output.length ? e.expiresAt : null,
      )
    },
  }
}
