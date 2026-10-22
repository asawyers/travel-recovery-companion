import { CitySchema, type City, type CityLeg, type CityTripRequest } from '../domain/city-contracts.ts'
import { findAirport } from '../domain/airport-metadata.ts'
import { FlightOfferSchema, TravelOnwardOfferSchema, onwardOfferId, type FlightOffer, type TravelOnwardOffer } from '../domain/travel-contracts.ts'
import { toInstantMillis } from '../domain/time.ts'
import { createPointGoogleRoutesAdapter } from './city-google-routes.ts'

type Options = { enabled: boolean; apiKey?: string; now: () => string; fetch?: typeof fetch }
export type TravelOnwardInput = { flight: FlightOffer; destination: City; arrivalProcessingMinutes: number; signal: AbortSignal }
export type TravelOnwardDiscovery = { offers: TravelOnwardOffer[]; warnings: string[] }
const AIRPORT_TOLERANCE_METERS = 2_000
const ENDPOINT_TOLERANCE_METERS = 250
const MAX_DRIVE_MINUTES = 480
const MINUTE = 60_000
const unique = (values: string[]) => [...new Set(values)].slice(0, 64)
const ANCHOR_NOTE = 'The airport endpoint approximates a terminal or access point within 2 km of the selected airport coordinate; the destination is within 250 metres of its city center. Your confirmed arrival-processing allowance must cover baggage collection and access to the actual pickup or boarding location. No extra terminal transfer or travel time is inferred.'
const DRIVE_NOTE = 'Onward driving only: vehicle access, rental pickup, rest needs and all driving charges require confirmation. No vehicle availability or booking is checked.'
function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)))
}
function at(place: CityLeg['from'], point: { latitude: number; longitude: number }, toleranceMeters = ENDPOINT_TOLERANCE_METERS): boolean {
  return place.latitude !== null && place.longitude !== null && distance({ latitude: place.latitude, longitude: place.longitude }, point) <= toleranceMeters
}

/** Selected-flight-only lookup: one transit request and one scoped onward-drive request, never a standalone drive. */
export function createTravelOnwardAdapter(options: Options) {
  const routePoints = createPointGoogleRoutesAdapter({ ...options, fewerTransfersAlternative: false, maxTransitCandidates: 2 })
  return async ({ flight, destination, arrivalProcessingMinutes, signal }: TravelOnwardInput): Promise<TravelOnwardDiscovery> => {
    const unavailable = (warning: string): TravelOnwardDiscovery => ({ offers: [], warnings: [warning] })
    if (!FlightOfferSchema.safeParse(flight).success || !CitySchema.safeParse(destination).success || destination.id !== flight.destinationCityId || !Number.isInteger(arrivalProcessingMinutes) || arrivalProcessingMinutes < 0 || arrivalProcessingMinutes > 10_080) {
      return unavailable('Invalid selected flight, destination or airport processing allowance; onward routes were not checked.')
    }
    const last = flight.segments.at(-1)!, airport = findAirport(last.destinationAirport.iata)
    if (!airport || Object.entries(airport).some(([key, value]) => last.destinationAirport[key as keyof typeof airport] !== value)) {
      return unavailable('Unrecognized arrival airport metadata; onward routes were not checked.')
    }
    let airportReadyAt: string
    try { airportReadyAt = new Date(toInstantMillis(last.arrivalAt) + arrivalProcessingMinutes * MINUTE).toISOString() }
    catch { return unavailable('Invalid selected flight arrival time; onward routes were not checked.') }
    const request: CityTripRequest = {
      version: 2, mode: 'real', originCityId: flight.originCityId, destinationCityId: destination.id,
      readyAt: airportReadyAt, deadlineAt: null, budgetCents: null, budgetMode: 'soft',
      drivingAllowed: true, priority: 'earliest', confirmedOptions: [],
    }
    const facts = await routePoints(request, {
      signal,
      origin: { name: `${airport.iata} · ${airport.name}`, latitude: airport.latitude, longitude: airport.longitude, timeZone: airport.timeZone },
      destination: { ...destination, name: `${destination.name} city center` },
      originToleranceMeters: AIRPORT_TOLERANCE_METERS,
      destinationToleranceMeters: ENDPOINT_TOLERANCE_METERS,
    })
    const warnings = [...facts.warnings], offers: TravelOnwardOffer[] = []
    for (const candidate of facts.candidates) {
      const first = candidate.legs[0], final = candidate.legs.at(-1)!
      if (!at(first.from, airport, AIRPORT_TOLERANCE_METERS) || !at(final.to, destination) || toInstantMillis(first.startAt) !== toInstantMillis(airportReadyAt)) continue
      const kind = candidate.kind === 'driving_estimate' ? 'drive' : 'transit'
      if (kind === 'drive' && (toInstantMillis(final.endAt) - toInstantMillis(first.startAt)) / MINUTE > MAX_DRIVE_MINUTES) {
        warnings.push('An onward driving estimate exceeded eight hours and was omitted; a complete rest and vehicle plan would be required.')
        continue
      }
      if (kind === 'transit' && offers.filter(offer => offer.kind === 'transit').length >= 2) continue
      if (kind === 'drive' && offers.some(offer => offer.kind === 'drive')) continue
      const legs = structuredClone(candidate.legs)
      const airportPlace = { name: airport.name, latitude: airport.latitude, longitude: airport.longitude }
      const destinationPlace = { name: destination.name, latitude: destination.latitude, longitude: destination.longitude }
      const samePoint = (a: CityLeg['from'], b: CityLeg['from']) => a.latitude === b.latitude && a.longitude === b.longitude
      // Rename every occurrence of the actual endpoint, including stationary waits;
      // preserve the provider's route/time and the explicitly bounded approximation.
      for (const leg of legs) for (const key of ['from', 'to'] as const) {
        if (samePoint(leg[key], first.from)) leg[key] = { ...airportPlace }
        else if (samePoint(leg[key], final.to)) leg[key] = { ...destinationPlace }
      }
      let connected = true
      for (const [index, leg] of legs.entries()) {
        leg.id = `onward-leg-${index + 1}`
        const previous = legs[index - 1]
        if (previous) {
          if (previous.to.latitude === null || previous.to.longitude === null || !at(leg.from, { latitude: previous.to.latitude, longitude: previous.to.longitude })) { connected = false; break }
          leg.from = { ...previous.to }
        }
        if (leg.mode === 'wait') leg.to = { ...leg.from }
      }
      if (!connected) continue
      const providerEndpointNote = `Provider route starts at ${first.from.latitude}, ${first.from.longitude} and ends at ${final.to.latitude}, ${final.to.longitude}; canonical airport/city anchors are approximate labels, not additional travel legs.`
      legs[0].assumptions = unique([...legs[0].assumptions, ANCHOR_NOTE, providerEndpointNote]).slice(0, 32)
      const data: Omit<TravelOnwardOffer, 'id'> = {
        flightOfferId: flight.id, flightFingerprint: flight.fingerprint, arrivalAirportIata: airport.iata,
        destinationCityId: destination.id, airportReadyAt, kind, legs, costs: candidate.costs,
        evidence: candidate.evidence,
        confirmations: unique([...candidate.confirmations, ANCHOR_NOTE, ...(kind === 'drive' ? [DRIVE_NOTE] : [])]),
      }
      const parsed = TravelOnwardOfferSchema.safeParse({ ...data, id: onwardOfferId(data) })
      if (parsed.success) offers.push(parsed.data)
      else warnings.push('An invalid onward route was omitted; no complete journey was inferred from it.')
      if (offers.length >= 3) break
    }
    return { offers, warnings: unique(warnings) }
  }
}
