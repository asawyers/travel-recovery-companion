import { z } from 'zod'
import { CitySchema } from '../domain/city-contracts.ts'
import { findCity as resolveCity } from '../domain/city-resolver.ts'
import { findAirport as resolveAirport } from '../domain/airport-metadata.ts'
import { PreferencePatchSchema } from '../domain/assistance.ts'
import type { PreferencePatch } from '../domain/assistance.ts'
import {
  AirportSchema,
  flightOfferFingerprint,
  flightOfferId,
  FlightOfferSchema,
  hotelOfferFingerprint,
  hotelOfferId,
  NationalHotelOfferSchema,
  TRAVEL_MAX_FACT_AGE_MS,
  TravelAssistanceSchema,
  TravelRecoveryInputSchema,
  TravelRecoveryResponseSchema,
  travelRequestBinding,
  TravelSourceStatusSchema,
} from '../domain/travel-contracts.ts'
import type {
  City,
  FlightOffer,
  NationalHotelOffer,
  TravelAirport,
  TravelAssistance,
  TravelRecoveryResponse,
  TravelSourceStatus,
} from '../domain/travel-contracts.ts'
import type { SourceEvidence } from '../domain/schemas.ts'
import { assessTravelSelection } from '../domain/travel-planner.ts'
import { toInstantMillis } from '../domain/time.ts'
import type { TravelProvider } from './serpapi-travel.ts'
import type {
  TravelAgentExecutor,
  TravelAssessment,
  TravelFlightDiscovery,
  TravelHotelDiscovery,
} from './travel-agent-contracts.ts'
import { explicitlyRequestedCityPatch } from './city-agent-contracts.ts'
import { corsHeaders, HttpError, jsonResponse, readJson } from './http.ts'
const flightResult = z.strictObject({
  offers: z.array(FlightOfferSchema).max(3),
  sourceStatus: TravelSourceStatusSchema,
  warnings: z.array(z.string().max(500)).max(64),
})
const hotelResult = z.strictObject({
  offers: z.array(NationalHotelOfferSchema).max(3),
  sourceStatus: TravelSourceStatusSchema,
  warnings: z.array(z.string().max(500)).max(64),
})
const millis = toInstantMillis
const notes = (values: string[]) => [...new Set(values)].slice(0, 64)
type Source = 'flights' | 'hotels'
const sourceMessages = {
  available: 'Discovery quotes are available; confirm availability and final prices before booking.',
  empty: 'No matching quotes were returned by this search.',
  limited: 'Discovery returned limited quotes; confirm details before booking.',
  unavailable: 'Quote discovery is unavailable. Search again before selecting a journey.',
}
const limited = (): TravelAssistance => ({
  status: 'limited',
  summary:
    'AI assistance could not complete a verified recommendation. Review the flight and hotel quotes and edit your trip fields as needed.',
  appliedPreferences: {},
  selectedPlanId: null,
  activity: [],
})
const unavailable = (): TravelAssistance => ({
  ...limited(),
  status: 'unavailable',
  summary: 'AI assistance is unavailable. You can still compare the flight and hotel quotes and edit your trip fields.',
})
const clarificationQuestions = {
  flight:
    'Please select a flight quote and confirm its transfer, airport processing and connection allowances so I can assess the complete journey.',
  airport: 'Which origin and destination airports should I use? Please confirm their three-letter airport codes.',
  transfer:
    'Please confirm the transfer durations and costs, airport processing time and connection allowances for your selected flight.',
  hotel:
    'Please select a hotel quote and confirm your overnight dates, arrival and departure times, transfer and check-in allowances, and property arrangements.',
  readyAt: 'What date and time will you be ready to leave the origin city? Please include the time zone.',
  deadlineAt:
    'What is your required arrival date and time at the destination city? Please include the time zone, or confirm there is no deadline.',
  budget: 'What is your total budget, and should it be a hard limit or a preference?',
  preference:
    'Would you like to prioritize earliest arrival, lowest complete price or fewest transfers, and is driving allowed?',
}
/** Races dependencies that ignore abort and cleans its listener on every settlement. */
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(new Error('Request ended'))
    }
    promise.then((value) => {
      signal.removeEventListener('abort', abort)
      resolve(value)
    }, (error) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
const evidenceOf = (
  flights: FlightOffer[],
  hotels: NationalHotelOffer[],
): SourceEvidence[] => [
  ...flights.flatMap((f) => [...f.evidence, ...f.segments.flatMap((s) => s.evidence)]),
  ...hotels.flatMap((h) => h.evidence),
]
const expiryOf = (e: { checkedAt: string; expiresAt: string | null }) =>
  Math.min(millis(e.checkedAt) + TRAVEL_MAX_FACT_AGE_MS, e.expiresAt === null ? Infinity : millis(e.expiresAt))
function safeEvidence(e: SourceEvidence): SourceEvidence {
  if (!e.sourceUrl) return e
  const url = new URL(e.sourceUrl)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return { ...e, sourceUrl: url.toString() }
}
/** Public, environment-free HTTP assembly. The entrypoint owns credentials and activation. */
export function createTravelRecoveryHandler(
  deps: {
    now: () => string
    findCity?: (id: string) => City | null
    findAirport?: (iata: string) => TravelAirport | undefined
    provider?: TravelProvider
    agent?: TravelAgentExecutor
  },
): (request: Request) => Promise<Response> {
  return async (httpRequest) => {
    const headers = corsHeaders(), controller = new AbortController(), providerController = new AbortController()
    const forwardAbort = () => controller.abort(), abortProvider = () => providerController.abort()
    httpRequest.signal.addEventListener('abort', forwardAbort, { once: true })
    if (httpRequest.signal.aborted) controller.abort()
    controller.signal.addEventListener('abort', abortProvider, { once: true })
    // The total budget includes the body; provider calls share one shorter budget.
    const totalTimer = setTimeout(() => controller.abort(), 30_000)
    let providerTimer: ReturnType<typeof setTimeout> | undefined, open = true
    const active = () => {
      if (!open || controller.signal.aborted) throw new Error('Request ended')
    }
    try {
      if (httpRequest.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (httpRequest.method !== 'POST') {
        headers.set('Allow', 'POST, OPTIONS')
        throw new HttpError(405, 'Use POST to request travel recovery plans.')
      }
      // Aborting this pipe also stops readJson's pending reader, clearing its body timer.
      const readRequest = httpRequest.body
        ? new Request(
          httpRequest.url,
          {
            method: 'POST',
            headers: httpRequest.headers,
            body: httpRequest.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
              signal: controller.signal,
            }),
            duplex: 'half',
          } as RequestInit,
        )
        : httpRequest
      const parsed = TravelRecoveryInputSchema.safeParse(await readJson(readRequest))
      active()
      if (!parsed.success) throw new HttpError(400, 'Invalid travel recovery request.')
      const input = parsed.data,
        findCity = deps.findCity ?? resolveCity,
        findAirport = deps.findAirport ?? resolveAirport
      const origin = findCity(input.trip.originCityId), destination = findCity(input.trip.destinationCityId)
      if (
        !origin || !destination || origin.id !== input.trip.originCityId ||
        destination.id !== input.trip.destinationCityId || !CitySchema.safeParse(origin).success ||
        !CitySchema.safeParse(destination).success
      ) throw new HttpError(400, 'Choose valid U.S. origin and destination cities.')
      const originAirport = findAirport(input.originAirportIata),
        destinationAirport = findAirport(input.destinationAirportIata)
      if (
        !originAirport || !destinationAirport || originAirport.iata !== input.originAirportIata ||
        destinationAirport.iata !== input.destinationAirportIata || !AirportSchema.safeParse(originAirport).success ||
        !AirportSchema.safeParse(destinationAirport).success
      ) throw new HttpError(400, 'Choose valid origin and destination airport codes.')
      const warnings: string[] = [], statuses = new Map<Source, TravelSourceStatus>(), rejectedExpiries: number[] = []
      let flightOffers: FlightOffer[] = [], hotelOffers: NationalHotelOffer[] = [], expiredSelection = false
      let latest: TravelAssessment | undefined, latestPatch: PreferencePatch = {}, assessmentNumber = 0
      let flightPromise: Promise<TravelFlightDiscovery> | undefined,
        hotelPromise: Promise<TravelHotelDiscovery> | undefined
      const invalidate = () => {
        latest = undefined
        latestPatch = {}
      }
      const unavailableStatus = (source: Source, previous?: TravelSourceStatus): TravelSourceStatus => ({
        source,
        status: 'unavailable',
        message: !input.investigate ? 'Quote discovery was not requested.' : sourceMessages.unavailable,
        checkedAt: previous?.checkedAt ?? deps.now(),
        expiresAt: previous?.expiresAt ?? null,
      })
      const airportMatches = (airport: TravelAirport) => {
        const canonical = findAirport(airport.iata)
        return !!canonical && AirportSchema.safeParse(canonical).success &&
          (Object.keys(airport) as (keyof TravelAirport)[]).every((key) => airport[key] === canonical[key])
      }
      const discover = async (source: Source): Promise<TravelFlightDiscovery | TravelHotelDiscovery> => {
        active()
        const failure = (previous?: TravelSourceStatus) => {
          const status = unavailableStatus(source, previous)
          statuses.set(source, status)
          warnings.push(sourceMessages.unavailable)
          invalidate()
          return { offers: [], status, warnings: [sourceMessages.unavailable] }
        }
        if (!input.investigate || !deps.provider || (source === 'hotels' && !input.overnight)) return failure()
        if (providerTimer === undefined) providerTimer = setTimeout(() => providerController.abort(), 20_000)
        let observed: TravelSourceStatus | undefined
        try {
          if (providerController.signal.aborted) return failure()
          const context = {
            origin: structuredClone(origin),
            destination: structuredClone(destination),
            originAirport: structuredClone(originAirport),
            destinationAirport: structuredClone(destinationAirport),
            signal: providerController.signal,
          }
          const raw = await bounded<unknown>(
            source === 'flights'
              ? deps.provider.flights(structuredClone(input), context)
              : deps.provider.hotels(structuredClone(input), context),
            providerController.signal,
          )
          active()
          const result = source === 'flights' ? flightResult.parse(raw) : hotelResult.parse(raw)
          if (result.sourceStatus.source !== source) throw new Error('Source mismatch')
          observed = result.sourceStatus
          const nowMs = millis(deps.now()),
            evidence = evidenceOf(
              source === 'flights' ? result.offers as FlightOffer[] : [],
              source === 'hotels' ? result.offers as NationalHotelOffer[] : [],
            )
          if (
            result.offers.length && !['available', 'limited'].includes(observed.status) ||
            observed.status === 'available' && !result.offers.length
          ) throw new Error('Status mismatch')
          if (
            evidence.some((e) =>
              e.environment !== 'production' || e.type === 'synthetic' || millis(e.checkedAt) > nowMs ||
              e.providerUpdatedAt !== null && millis(e.providerUpdatedAt) > nowMs
            ) || millis(observed.checkedAt) > nowMs
          ) throw new Error('Invalid original evidence')
          const expired = evidence.some((e) => expiryOf(e) <= nowMs) || expiryOf(observed) <= nowMs
          if (expired) {
            rejectedExpiries.push(expiryOf(observed), ...evidence.map(expiryOf))
            if (
              input.selection &&
              result.offers.some((offer) =>
                source === 'flights'
                  ? offer.id === input.selection!.flightOfferId &&
                    offer.fingerprint === input.selection!.flightFingerprint
                  : offer.id === input.selection!.hotelOfferId &&
                    offer.fingerprint === input.selection!.hotelFingerprint
              )
            ) expiredSelection = true
            return failure(observed)
          }
          if (source === 'flights') {
            const offers = result.offers as FlightOffer[]
            if (
              new Set(offers.map((f) => f.id)).size !== offers.length ||
              offers.some((f) =>
                f.originCityId !== input.trip.originCityId || f.destinationCityId !== input.trip.destinationCityId ||
                f.originAirportIata !== input.originAirportIata ||
                f.destinationAirportIata !== input.destinationAirportIata || f.departureDate !== input.departureDate ||
                f.id !== flightOfferId(f) || f.fingerprint !== flightOfferFingerprint(f) || f.segments.some((s) =>
                  !airportMatches(s.originAirport) || !airportMatches(s.destinationAirport)
                )
              )
            ) throw new Error('Flight binding mismatch')
            flightOffers = offers.map((f) => ({
              ...f,
              evidence: f.evidence.map(safeEvidence),
              segments: f.segments.map((s) => ({ ...s, evidence: s.evidence.map(safeEvidence) })),
            }))
          } else {
            const offers = result.offers as NationalHotelOffer[]
            if (
              new Set(offers.map((h) => h.id)).size !== offers.length ||
              offers.some((h) =>
                h.originCityId !== input.trip.originCityId || h.timeZone !== origin.timeZone || !input.overnight ||
                h.checkin !== input.overnight.checkin || h.checkout !== input.overnight.checkout ||
                h.id !== hotelOfferId(h) || h.fingerprint !== hotelOfferFingerprint(h)
              )
            ) throw new Error('Hotel binding mismatch')
            hotelOffers = offers.map((h) => ({ ...h, evidence: h.evidence.map(safeEvidence) }))
          }
          const status = { ...observed, message: sourceMessages[observed.status] },
            safeWarnings = result.warnings.length
              ? [
                'Search results have qualifications; confirm route details, final prices and availability before booking.',
              ]
              : []
          statuses.set(source, status)
          warnings.push(...safeWarnings)
          invalidate()
          return source === 'flights'
            ? { offers: structuredClone(flightOffers), status, warnings: safeWarnings }
            : { offers: structuredClone(hotelOffers), status, warnings: safeWarnings }
        } catch {
          active()
          return failure(observed)
        }
      }
      const getFlights = () => flightPromise ??= discover('flights') as Promise<TravelFlightDiscovery>
      const getHotels = () => hotelPromise ??= discover('hotels') as Promise<TravelHotelDiscovery>
      const ensureDiscovery = async () => {
        if (input.investigate) await Promise.all([getFlights(), ...(input.overnight ? [getHotels()] : [])])
      }
      const snapshot = (patch: PreferencePatch): TravelRecoveryResponse => {
        active()
        const canonical = TravelRecoveryInputSchema.parse({ ...input, trip: { ...input.trip, ...patch } }),
          now = deps.now()
        // Model work can outlast a quote that was fresh during tool assessment.
        // Retire it using its original observation and expiry before producing any snapshot.
        for (const [source, status] of statuses) {
          if (status.status === 'unavailable') continue
          const offers = source === 'flights' ? flightOffers : hotelOffers
          const evidence = evidenceOf(source === 'flights' ? flightOffers : [], source === 'hotels' ? hotelOffers : [])
          if (expiryOf(status) > millis(now) && evidence.every((item) => expiryOf(item) > millis(now))) continue
          rejectedExpiries.push(expiryOf(status), ...evidence.map(expiryOf))
          if (
            input.selection &&
            offers.some((offer) =>
              source === 'flights'
                ? offer.id === input.selection!.flightOfferId &&
                  offer.fingerprint === input.selection!.flightFingerprint
                : offer.id === input.selection!.hotelOfferId && offer.fingerprint === input.selection!.hotelFingerprint
            )
          ) expiredSelection = true
          if (source === 'flights') flightOffers = []
          else hotelOffers = []
          statuses.set(source, unavailableStatus(source, status))
          warnings.push(sourceMessages.unavailable)
        }
        const assessment = assessTravelSelection(canonical, { origin, destination, flightOffers, hotelOffers, now })
        if (expiredSelection && !assessment.journey) assessment.selectionIssue = 'expired'
        const expires = Math.min(
          millis(now) + TRAVEL_MAX_FACT_AGE_MS,
          ...evidenceOf(flightOffers, hotelOffers).map(expiryOf),
          ...[...statuses.values()].map(expiryOf),
          ...rejectedExpiries,
        )
        return TravelRecoveryResponseSchema.parse({
          version: 3,
          request: travelRequestBinding(canonical),
          origin,
          destination,
          generatedAt: now,
          expiresAt: new Date(expires).toISOString(),
          flightOffers,
          hotelOffers,
          sourceStatuses: [...statuses.values()].sort((a, b) => a.source.localeCompare(b.source)),
          ...assessment,
          warnings: notes(warnings),
          ...(input.conversation
            ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } }
            : {}),
        })
      }
      const assess = async (raw: PreferencePatch): Promise<TravelAssessment> => {
        active()
        invalidate()
        const patch = PreferencePatchSchema.parse(raw)
        if (!explicitlyRequestedCityPatch(input.refinement ?? '', patch)) {
          throw new Error('Unrequested preference change')
        }
        await ensureDiscovery()
        active()
        latestPatch = patch
        latest = { assessmentId: `assessment-${++assessmentNumber}`, result: snapshot(patch) }
        return structuredClone(latest)
      }
      let assistance: TravelAssistance | undefined
      if (input.refinement) {
        if (!deps.agent) assistance = unavailable()
        else {
          try {
            assistance = TravelAssistanceSchema.parse(
              await bounded(
                deps.agent({
                  input: structuredClone(input),
                  origin: structuredClone(origin),
                  destination: structuredClone(destination),
                  refinement: input.refinement,
                  ...(input.conversation ? { conversation: structuredClone(input.conversation) } : {}),
                  signal: controller.signal,
                  tools: {
                    findFlights: () => {
                      active()
                      invalidate()
                      return getFlights().then((value) => structuredClone(value))
                    },
                    findHotels: () => {
                      active()
                      invalidate()
                      return getHotels().then((value) => structuredClone(value))
                    },
                    assess,
                  },
                }),
                controller.signal,
              ),
            )
            active()
            if (assistance.clarification) assistance.summary = clarificationQuestions[assistance.clarification.field]
            if (assistance.status === 'completed') {
              if (
                !latest || !explicitlyRequestedCityPatch(input.refinement, assistance.appliedPreferences) ||
                (['priority', 'drivingAllowed'] as const).some((key) =>
                  assistance!.appliedPreferences[key] !== latestPatch[key]
                ) || (assistance.selectedPlanId === null
                  ? !!latest.result.journey?.selectable
                  : latest.result.journey?.id !== assistance.selectedPlanId || !latest.result.journey.selectable)
              ) {
                throw new Error('Unassessed recommendation')
              }
              const current = snapshot(latestPatch)
              if (
                assistance.selectedPlanId === null
                  ? !!current.journey?.selectable
                  : current.journey?.id !== assistance.selectedPlanId || !current.journey.selectable
              ) {
                throw new Error('Recommendation expired or became ineligible')
              }
              latest = { ...latest, result: current }
            }
          } catch {
            active()
            assistance = limited()
          }
        }
      }
      if (assistance?.status !== 'completed') {
        if (!assistance?.clarification) await ensureDiscovery()
        if (!statuses.has('flights')) statuses.set('flights', unavailableStatus('flights'))
        if (input.overnight && !statuses.has('hotels')) statuses.set('hotels', unavailableStatus('hotels'))
        latestPatch = {}
        latest = { assessmentId: `assessment-${++assessmentNumber}`, result: snapshot({}) }
        if (assistance) assistance = { ...assistance, appliedPreferences: {}, selectedPlanId: null }
      }
      active()
      const result = TravelRecoveryResponseSchema.parse({ ...latest!.result, ...(assistance ? { assistance } : {}) })
      return jsonResponse(result, 200, headers)
    } catch (error) {
      return jsonResponse(
        { error: error instanceof HttpError ? error.message : 'Travel recovery planning is temporarily unavailable.' },
        error instanceof HttpError ? error.status : 500,
        headers,
      )
    } finally {
      open = false
      clearTimeout(totalTimer)
      if (providerTimer !== undefined) clearTimeout(providerTimer)
      controller.abort()
      providerController.abort()
      httpRequest.signal.removeEventListener('abort', forwardAbort)
      controller.signal.removeEventListener('abort', abortProvider)
    }
  }
}
