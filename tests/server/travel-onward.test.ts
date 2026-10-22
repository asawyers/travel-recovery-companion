import { describe, expect, it, vi } from 'vitest'
import { createTravelOnwardAdapter } from '../../supabase/functions/_shared/server/travel-onward.ts'
import { travelFixture } from '../../supabase/functions/_shared/domain/travel-fixtures.ts'
import { findAirport } from '../../supabase/functions/_shared/domain/airport-metadata.ts'
import { flightOfferFingerprint, flightOfferId, TravelOnwardOfferSchema } from '../../supabase/functions/_shared/domain/travel-contracts.ts'

function fixture() {
  const f = travelFixture(), airport = findAirport('BOS')!
  f.flight.destinationAirportIata = airport.iata
  f.flight.segments.at(-1)!.destinationAirport = airport
  f.flight.id = flightOfferId(f.flight)
  f.flight.fingerprint = flightOfferFingerprint(f.flight)
  const ready = new Date(Date.parse(f.flight.segments.at(-1)!.arrivalAt) + 30 * 60000).toISOString()
  const at = (minutes: number) => new Date(Date.parse(ready) + minutes * 60000).toISOString()
  const point = (latitude: number, longitude: number) => ({ latLng: { latitude, longitude } })
  const A = point(airport.latitude, airport.longitude), B = point(airport.latitude + 0.001, airport.longitude), C = point(f.destination.latitude - 0.001, f.destination.longitude), D = point(f.destination.latitude, f.destination.longitude)
  const walk = (from: typeof A, to: typeof A) => ({ travelMode: 'WALK', startLocation: from, endLocation: to, staticDuration: '300s' })
  const ride = (vehicle = 'INTERCITY_BUS') => ({ travelMode: 'TRANSIT', startLocation: B, endLocation: C, staticDuration: '7200s', transitDetails: {
    stopDetails: { departureStop: { name: 'Airport coach stop', location: B }, arrivalStop: { name: 'Portland station', location: C }, departureTime: at(20), arrivalTime: at(140) },
    localizedValues: { departureTime: { timeZone: airport.timeZone }, arrivalTime: { timeZone: f.destination.timeZone } },
    transitLine: { name: 'Test coach', agencies: [{ name: 'Test operator' }], vehicle: { type: vehicle } }, tripShortText: 'TEST',
  } })
  const transit = (vehicle?: string) => ({ routes: [{ duration: '7800s', travelAdvisory: { transitFare: { currencyCode: 'USD', units: '35' } }, legs: [{ startLocation: A, endLocation: D, steps: [walk(A, B), ride(vehicle), walk(C, D)] }] }] })
  const drive = (minutes = 120) => ({ routes: [{ duration: `${minutes * 60}s`, legs: [{ startLocation: A, endLocation: D }] }] })
  const args = { flight: f.flight, destination: f.destination, arrivalProcessingMinutes: 30, signal: new AbortController().signal }
  return { ...f, airport, ready, at, A, B, C, D, transit, drive, args }
}
const responses = (...bodies: unknown[]) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(bodies.shift() ?? { routes: [] })))

describe('selected flight onward Google Routes discovery', () => {
  it.each(['INTERCITY_BUS', 'LONG_DISTANCE_TRAIN'])('uses the actual BOS airport after arrival processing and preserves %s steps', async vehicle => {
    const f = fixture(), fetch = responses(f.transit(vehicle), f.drive())
    const result = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch })(f.args)
    expect(result.offers).toHaveLength(2)
    const [transit, drive] = result.offers
    expect(TravelOnwardOfferSchema.safeParse(transit).success).toBe(true)
    expect(transit).toMatchObject({ flightOfferId: f.flight.id, flightFingerprint: f.flight.fingerprint, arrivalAirportIata: 'BOS', destinationCityId: f.destination.id, airportReadyAt: f.ready, kind: 'transit' })
    expect(transit.legs.map(leg => leg.mode)).toEqual(['walk', 'wait', vehicle === 'INTERCITY_BUS' ? 'bus' : 'rail', 'walk'])
    expect(transit.legs[0].from).toEqual({ name: f.airport.name, latitude: f.airport.latitude, longitude: f.airport.longitude })
    expect(transit.legs.at(-1)!.to).toEqual({ name: f.destination.name, latitude: f.destination.latitude, longitude: f.destination.longitude })
    expect(transit.costs[0].cents).toBe(3500)
    expect(transit.evidence[0]).toMatchObject({ provider: 'Google Maps Routes API', type: 'schedule', checkedAt: f.now })
    expect(drive).toMatchObject({ kind: 'drive', costs: [{ cents: null }] })
    expect(drive.confirmations.join(' ')).toMatch(/vehicle.*confirmation/i)
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init!.body)))
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({ travelMode: 'TRANSIT', departureTime: f.ready, origin: { location: f.A }, destination: { location: f.D } })
    expect(bodies[1]).toMatchObject({ travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' })
    expect(bodies[1].departureTime).toBeUndefined()
  })

  it('canonicalizes an initial airport wait and keeps every route boundary connected', async () => {
    const f = fixture(), body = f.transit()
    const boarding = body.routes[0].legs[0].steps[1] as (typeof body.routes)[number]['legs'][number]['steps'][number] & { transitDetails: { stopDetails: { departureStop: { name: string; location: typeof f.A } } } }
    body.routes[0].legs[0].steps.shift()
    boarding.startLocation = f.A
    boarding.transitDetails.stopDetails.departureStop.location = f.A
    body.routes[0].duration = '7500s'
    const result = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch: responses(body, { routes: [] }) })(f.args)
    expect(result.offers).toHaveLength(1)
    const legs = result.offers[0].legs
    expect(legs[0].mode).toBe('wait')
    expect(legs[0].from).toEqual(legs[0].to)
    expect(legs[0].from.name).toBe(f.airport.name)
    for (let i = 1; i < legs.length; i++) expect(legs[i].from).toEqual(legs[i - 1].to)
  })

  it('reserves an onward driving alternative when the transit provider returns many routes', async () => {
    const f = fixture(), body = f.transit()
    body.routes = Array.from({ length: 12 }, (_, i) => {
      const route = structuredClone(body.routes[0])
      route.travelAdvisory.transitFare.units = String(i + 30)
      return route
    })
    const fetch = responses(body, f.drive())
    const result = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch })(f.args)
    expect(result.offers.map(offer => offer.kind)).toEqual(['transit', 'transit', 'drive'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not invent bus or train schedules when only an onward drive exists', async () => {
    const f = fixture(), fetch = responses({ routes: [] }, f.drive())
    const result = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch })(f.args)
    expect(result.offers.map(offer => offer.kind)).toEqual(['drive'])
    expect(result.offers[0].legs[0].startAt).toBe(f.ready)
    expect(result.offers[0].costs[0].cents).toBeNull()
  })

  it('omits drives beyond eight hours and routes that start in Boston city center', async () => {
    const f = fixture(), body = f.transit()
    body.routes[0].legs[0].startLocation = { latLng: { latitude: 42.3601, longitude: -71.0589 } }
    const result = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch: responses(body, f.drive(481)) })(f.args)
    expect(result.offers).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/eight hours/)
  })

  it('accepts an airport terminal within two kilometres while preserving its original provider endpoint disclosure', async () => {
    const f = fixture(), transit = f.transit(), drive = f.drive()
    const terminal = { latLng: { latitude: f.airport.latitude + 0.009, longitude: f.airport.longitude } }
    transit.routes[0].legs[0].startLocation = terminal
    transit.routes[0].legs[0].steps[0].startLocation = terminal
    drive.routes[0].legs[0].startLocation = terminal
    const result = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch: responses(transit, drive) })(f.args)
    expect(result.offers).toHaveLength(2)
    for (const offer of result.offers) {
      expect(offer.legs[0].from.latitude).toBe(f.airport.latitude)
      expect(offer.legs[0].assumptions.join(' ')).toContain(String(terminal.latLng.latitude))
      expect(offer.confirmations.join(' ')).toMatch(/within 2 km.*arrival-processing allowance/s)
      expect(offer.legs[0].startAt).toBe(f.ready)
    }
  })

  it('rejects an airport access point beyond two kilometres and a city endpoint beyond 250 metres', async () => {
    const f = fixture(), farAirport = f.drive(), farCity = f.drive()
    farAirport.routes[0].legs[0].startLocation = { latLng: { latitude: f.airport.latitude + 0.02, longitude: f.airport.longitude } }
    farCity.routes[0].legs[0].endLocation = { latLng: { latitude: f.destination.latitude + 0.003, longitude: f.destination.longitude } }
    for (const body of [farAirport, farCity]) {
      const result = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch: responses({ routes: [] }, body) })(f.args)
      expect(result.offers).toEqual([])
    }
  })

  it('rejects a scheduled departure before airport processing finishes', async () => {
    const f = fixture(), body = f.transit()
    const ride = body.routes[0].legs[0].steps[1] as ReturnType<typeof f.transit>['routes'][number]['legs'][number]['steps'][number] & { transitDetails: { stopDetails: { departureTime: string } } }
    ride.transitDetails.stopDetails.departureTime = f.at(-1)
    const result = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch: responses(body, { routes: [] }) })(f.args)
    expect(result.offers).toEqual([])
  })

  it('keeps route identity stable when only source check timestamps change', async () => {
    const f = fixture()
    const a = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch: responses(f.transit(), f.drive()) })(f.args)
    const b = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => new Date(Date.parse(f.now) + 60000).toISOString(), fetch: responses(f.transit(), f.drive()) })(f.args)
    expect(a.offers).toHaveLength(2)
    expect(a.offers.map(offer => offer.id)).toEqual(b.offers.map(offer => offer.id))
    expect(a.offers[0].evidence[0].checkedAt).not.toBe(b.offers[0].evidence[0].checkedAt)
  })

  it('keeps the same route identity when Google reorders alternative routes', async () => {
    const f = fixture(), first = f.transit().routes[0], second = structuredClone(first)
    second.travelAdvisory.transitFare.units = '40'
    const a = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch: responses({ routes: [first, second] }, f.drive()) })(f.args)
    const b = await createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch: responses({ routes: [second, first] }, f.drive()) })(f.args)
    expect(a.offers).toHaveLength(3)
    expect(a.offers.map(offer => offer.id).sort()).toEqual(b.offers.map(offer => offer.id).sort())
  })

  it('never queries when disabled, aborted, supplied forged airport metadata or invalid allowances', async () => {
    const f = fixture(), fetch = responses(f.transit(), f.drive()), adapter = createTravelOnwardAdapter({ enabled: true, apiKey: 'test', now: () => f.now, fetch })
    await createTravelOnwardAdapter({ enabled: false, apiKey: 'test', now: () => f.now, fetch })(f.args)
    const controller = new AbortController(); controller.abort()
    await adapter({ ...f.args, signal: controller.signal })
    await adapter({ ...f.args, arrivalProcessingMinutes: -1 })
    const forged = structuredClone(f.flight); forged.segments.at(-1)!.destinationAirport.latitude = 42
    await adapter({ ...f.args, flight: forged })
    expect(fetch).not.toHaveBeenCalled()
  })
})
