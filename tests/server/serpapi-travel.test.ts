import { describe, expect, it, vi } from 'vitest'
import { travelFixture } from '../../supabase/functions/_shared/domain/travel-fixtures'
import { findAirport } from '../../supabase/functions/_shared/domain/airport-metadata'
import {
  FlightOfferSchema,
  NationalHotelOfferSchema,
} from '../../supabase/functions/_shared/domain/travel-contracts'

const NOW = '2026-11-18T14:00:00Z'
const CREATED = '2026-11-18T13:59:20Z'
const PROCESSED = '2026-11-18T13:59:25Z'
const metadata = () => ({ status: 'Success', created_at: CREATED, processed_at: PROCESSED })
const segment = (
  from = 'SAN',
  to = 'PWM',
  departure = '2026-11-19 09:00',
  arrival = '2026-11-19 17:00',
  duration = 300,
  flight = 'AA 123',
) => ({
  departure_airport: { id: from, name: 'Untrusted source airport', time: departure },
  arrival_airport: { id: to, time: arrival },
  duration,
  airline: 'American Airlines',
  flight_number: flight,
})
const itinerary = () => ({ flights: [segment()], total_duration: 300, price: 250 })
const flightsBody = () => ({ search_metadata: metadata(), best_flights: [itinerary()] })
const property = () => ({
  property_token: 'fixture-property-san',
  name: 'San Diego Hotel',
  gps_coordinates: { latitude: 32.72, longitude: -117.17 },
  total_rate: { lowest: '$120', extracted_lowest: 120, extracted_before_taxes_fees: 100 },
  check_in_time: '3:00 PM',
  check_out_time: '11:00 AM',
})
const hotelsBody = () => ({ search_metadata: metadata(), properties: [property()] })
const setup = async (body: unknown = flightsBody(), options: Record<string, unknown> = {}) => {
  const module = await import('../../supabase/functions/_shared/server/serpapi-travel').catch(() => null)
  expect(module, 'SerpApi travel adapter exists').not.toBeNull()
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)))
  const adapter = module!.createSerpApiTravelAdapter({
    enabled: true,
    apiKey: 'fixture-secret',
    now: () => NOW,
    fetch: fetcher,
    ...options,
  })
  const fixture = travelFixture()
  const input = { ...fixture.input, investigate: true, selection: null }
  const context = {
    origin: fixture.origin,
    destination: fixture.destination,
    originAirport: findAirport('SAN')!,
    destinationAirport: findAirport('PWM')!,
    signal: new AbortController().signal,
  }
  return { adapter, fetcher, input, context }
}
const overnight = async (body: unknown = hotelsBody(), options: Record<string, unknown> = {}) => {
  const state = await setup(body, options)
  state.input.overnight = { checkin: '2026-11-18', checkout: '2026-11-19' }
  return state
}

describe('SerpApi flight discovery', () => {
  it('normalizes one observed route fare with authoritative airports, original source age and safe handoff', async () => {
    const { adapter, input, context, fetcher } = await setup()
    const result = await adapter.flights(input, context)
    expect(result.offers).toHaveLength(1)
    const offer = result.offers[0]
    expect(FlightOfferSchema.safeParse(offer).success).toBe(true)
    expect(offer.costs).toEqual([{
      label: 'Observed one-way flight fare; baggage and extras require recheck',
      cents: 25000,
      currency: 'USD',
      includedInOtherCharge: false,
    }])
    expect(offer.segments[0].originAirport).toEqual(findAirport('SAN'))
    expect(offer.segments[0].departureAt).toBe('2026-11-19T17:00:00Z')
    expect(offer.evidence[0]).toMatchObject({
      type: 'estimated',
      environment: 'production',
      provider: 'SerpApi Google Flights search',
      checkedAt: CREATED,
      providerUpdatedAt: PROCESSED,
      expiresAt: '2026-11-18T14:04:20Z',
    })
    expect(result.sourceStatus).toMatchObject({
      source: 'flights',
      status: 'available',
      checkedAt: NOW,
      expiresAt: '2026-11-18T14:04:20Z',
    })
    expect(offer.handoffUrl).toContain('https://www.google.com/travel/flights?')
    expect(new URL(offer.handoffUrl!).searchParams.get('q')).toContain('SAN to PWM on 2026-11-19')
    expect(fetcher).toHaveBeenCalledOnce()
    const params = new URL(String(fetcher.mock.calls[0][0])).searchParams
    for (
      const [key, value] of Object.entries({
        engine: 'google_flights',
        departure_id: 'SAN',
        arrival_id: 'PWM',
        outbound_date: '2026-11-19',
        type: '2',
        adults: '1',
        currency: 'USD',
        travel_class: '1',
        gl: 'us',
        hl: 'en',
        no_cache: 'true',
      })
    ) expect(params.get(key)).toBe(value)
    expect(params.has('return_date')).toBe(false)
  })

  it('keeps SAN to ORD to PWM segments with each airport zone and one route price', async () => {
    const body = flightsBody()
    body.best_flights[0] = {
      flights: [
        segment('SAN', 'ORD', '2026-11-19 09:00', '2026-11-19 15:00', 240, 'AA 1'),
        segment('ORD', 'PWM', '2026-11-19 16:00', '2026-11-19 19:00', 120, 'AA 2'),
      ],
      total_duration: 420,
      price: 300,
    }
    const { adapter, input, context } = await setup(body)
    const result = await adapter.flights(input, context)
    expect(result.offers[0].segments).toHaveLength(2)
    expect(result.offers[0].segments[1].originAirport.timeZone).toBe('America/Chicago')
    expect(result.offers[0].segments[1].departureAt).toBe('2026-11-19T22:00:00Z')
    expect(result.offers[0].segments[1].boardingId).not.toBe(result.offers[0].segments[0].boardingId)
    expect(result.offers[0].costs).toHaveLength(1)
  })

  it('supports other_flights without best_flights and deduplicates identical physical flights', async () => {
    const { adapter, input, context } = await setup({
      search_metadata: metadata(),
      other_flights: [itinerary(), itinerary()],
    })
    expect((await adapter.flights(input, context)).offers).toHaveLength(1)
  })

  it('preserves an airport change instead of silently joining airports', async () => {
    const { adapter, input, context } = await setup({
      search_metadata: metadata(),
      other_flights: [{
        flights: [
          segment('SAN', 'ORD', '2026-11-19 09:00', '2026-11-19 15:00', 240, 'AA 1'),
          segment('MDW', 'PWM', '2026-11-19 17:00', '2026-11-19 20:00', 120, 'AA 2'),
        ],
        total_duration: 480,
        price: 200,
      }],
    })
    const result = await adapter.flights(input, context)
    expect(result.offers[0].segments[0].destinationAirport.iata).toBe('ORD')
    expect(result.offers[0].segments[1].originAirport.iata).toBe('MDW')
    expect(result.offers[0].evidence[0].warnings.join(' ')).toMatch(/airport.*transfer/i)
  })

  it('accepts explicit date rollover', async () => {
    const { adapter, input, context } = await setup({
      search_metadata: metadata(),
      other_flights: [{
        flights: [segment('SAN', 'PWM', '2026-11-19 22:00', '2026-11-20 06:00', 300)],
        total_duration: 300,
        price: 100,
      }],
    })
    expect((await adapter.flights(input, context)).offers[0].segments[0].arrivalAt).toBe(
      '2026-11-20T11:00:00Z',
    )
  })

  it.each([
    'duration',
    'total_duration',
    'unknown_airport',
    'wrong_departure_date',
    'wrong_endpoint',
    'missing_identity',
    'negative_chronology',
    'too_many_segments',
  ])('omits invalid %s facts with a fixed limited warning', async (kind) => {
    const body = flightsBody()
    const item = body.best_flights[0]
    if (kind === 'duration') item.flights[0].duration = 1
    if (kind === 'total_duration') item.total_duration = 1
    if (kind === 'unknown_airport') item.flights[0].arrival_airport.id = 'ZZZ'
    if (kind === 'wrong_departure_date') item.flights[0].departure_airport.time = '2026-11-20 09:00'
    if (kind === 'wrong_endpoint') item.flights[0].arrival_airport.id = 'BOS'
    if (kind === 'missing_identity') item.flights[0].flight_number = ''
    if (kind === 'negative_chronology') item.flights[0].arrival_airport.time = '2026-11-19 09:00'
    if (kind === 'too_many_segments') item.flights = Array.from({ length: 9 }, () => segment())
    const { adapter, input, context } = await setup(body)
    const result = await adapter.flights(input, context)
    expect(result.offers).toEqual([])
    expect(result.sourceStatus.status).toBe('limited')
    expect(result.warnings).not.toEqual([])
  })

  it.each(['2027-03-14 02:30', '2026-11-01 01:30'])(
    'rejects DST missing or ambiguous airport time %s',
    async (departure) => {
      const date = departure.slice(0, 10)
      const { adapter, input, context } = await setup({
        search_metadata: { created_at: '2026-10-22T12:00:00Z' },
        other_flights: [{
          flights: [segment('SAN', 'PWM', departure, `${date} 12:00`, 300)],
          total_duration: 300,
        }],
      }, { now: () => '2026-10-22T12:01:00Z' })
      input.departureDate = date
      input.trip.readyAt = '2026-10-22T08:00:00-07:00'
      expect((await adapter.flights(input, context)).offers).toEqual([])
    },
  )

  it('does not change physical identity on reprice or freshness refresh; fingerprints track price', async () => {
    const a = await setup()
    const bBody = flightsBody()
    bBody.best_flights[0].price = 260
    const b = await setup(bBody)
    const cBody = flightsBody()
    cBody.search_metadata.created_at = '2026-11-18T13:59:21Z'
    const c = await setup(cBody)
    const offerA = (await a.adapter.flights(a.input, a.context)).offers[0]
    const offerB = (await b.adapter.flights(b.input, b.context)).offers[0]
    const offerC = (await c.adapter.flights(c.input, c.context)).offers[0]
    expect(offerB.id).toBe(offerA.id)
    expect(offerB.fingerprint).not.toBe(offerA.fingerprint)
    expect(offerC.id).toBe(offerA.id)
    expect(offerC.fingerprint).toBe(offerA.fingerprint)
  })

  it.each([undefined, -1, NaN])('keeps missing or invalid fare %s unknown', async (price) => {
    const body = { search_metadata: metadata(), other_flights: [{ ...itinerary(), price }] }
    const { adapter, input, context } = await setup(body)
    expect((await adapter.flights(input, context)).offers[0].costs[0].cents).toBeNull()
  })

  it('ranks known prices before unknown prices for cheapest and limits output to three', async () => {
    const entries = [500, undefined, 100, 200, 50].map((price, index) => ({
      flights: [segment('SAN', 'PWM', '2026-11-19 09:00', '2026-11-19 17:00', 300, `AA ${index}`)],
      total_duration: 300,
      price,
    }))
    const { adapter, input, context } = await setup({ search_metadata: metadata(), other_flights: entries })
    input.trip.priority = 'cheapest'
    expect((await adapter.flights(input, context)).offers.map((o) => o.costs[0].cents)).toEqual([
      5000,
      10000,
      20000,
    ])
  })

  it('filters same-day searches from the readiness hour and retains exact readiness qualification', async () => {
    const { adapter, input, context, fetcher } = await setup()
    input.trip.readyAt = '2026-11-19T08:39:00-08:00'
    const result = await adapter.flights(input, context)
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('outbound_times')).toBe('8,23')
    expect(result.offers[0].evidence[0].warnings.join(' ')).toMatch(/processing|transfer/i)
  })
})

describe('SerpApi guards and evidence', () => {
  it.each([
    'disabled',
    'missing_key',
    'not_investigating',
    'cancelled',
    'same_airport',
    'city_binding',
    'airport_binding',
    'bad_context',
    'past',
    'too_far',
    'before_readiness',
  ])('does not fetch for %s', async (kind) => {
    const { adapter, input, context, fetcher } = await setup(
      flightsBody(),
      kind === 'disabled' ? { enabled: false } : kind === 'missing_key' ? { apiKey: '' } : {},
    )
    if (kind === 'not_investigating') input.investigate = false
    if (kind === 'cancelled') {
      const c = new AbortController()
      c.abort()
      context.signal = c.signal
    }
    if (kind === 'same_airport') input.destinationAirportIata = 'SAN'
    if (kind === 'city_binding') context.origin.id = 'geonames:123'
    if (kind === 'airport_binding') context.originAirport = findAirport('LAX')!
    if (kind === 'bad_context') context.origin.timeZone = 'bad-zone'
    if (kind === 'past') input.departureDate = '2026-11-17'
    if (kind === 'too_far') input.departureDate = '2027-10-15'
    if (kind === 'before_readiness') input.trip.readyAt = '2026-11-20T08:00:00-08:00'
    expect((await adapter.flights(input, context)).sourceStatus.status).toBe('unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([undefined, '2026-11-18T13:54:59Z', '2026-11-18T14:00:01Z', 'not-a-date'])(
    'does not refresh missing, stale or future source check %s',
    async (created_at) => {
      const { adapter, input, context } = await setup({
        search_metadata: { ...metadata(), created_at },
        other_flights: [itinerary()],
      })
      const result = await adapter.flights(input, context)
      expect(result.offers).toEqual([])
      expect(result.sourceStatus.status).toBe('limited')
      expect(result.sourceStatus.checkedAt).toBe(NOW)
      expect(result.sourceStatus.expiresAt).toBeNull()
    },
  )

  it('supports legacy UTC metadata and nullable processing metadata without inventing freshness', async () => {
    const { adapter, input, context } = await setup({
      search_metadata: { created_at: '2026-11-18 13:59:20 UTC' },
      other_flights: [itinerary()],
    })
    expect((await adapter.flights(input, context)).offers[0].evidence[0]).toMatchObject({
      checkedAt: CREATED,
      providerUpdatedAt: null,
    })
  })

  it('evaluates source processing times after the HTTP attempt completes', async () => {
    let clock = '2026-11-18T13:59:00Z'
    const s = await setup(flightsBody(), {
      now: () => clock,
      fetch: async () => {
        clock = NOW
        return new Response(JSON.stringify(flightsBody()))
      },
    })
    const result = await s.adapter.flights(s.input, s.context)
    expect(result.offers).toHaveLength(1)
    expect(result.sourceStatus.checkedAt).toBe('2026-11-18T13:59:00Z')
  })

  it('sanitizes raw provider error details and makes no extra request', async () => {
    const { adapter, input, context, fetcher } = await setup({
      error: 'fixture-secret https://serpapi.com/searches/private?api_key=fixture-secret',
    })
    const result = await adapter.flights(input, context)
    expect(result.offers).toEqual([])
    expect(result.sourceStatus.status).toBe('unavailable')
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
    expect(JSON.stringify(result)).not.toContain('searches/private')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each([
    'https://serpapi.com/searches/private',
    'https://evil.example/travel/flights',
    'https://www.google.com/travel/flights?booking_token=secret',
    'https://www.google.com/travel/flights?api_key=secret',
  ])('replaces unsafe source handoff %s', async (url) => {
    const { adapter, input, context } = await setup({
      ...flightsBody(),
      search_metadata: { ...metadata(), google_flights_url: url },
    })
    const result = await adapter.flights(input, context)
    expect(result.offers[0].handoffUrl).toContain('https://www.google.com/travel/flights?q=')
    expect(result.offers[0].handoffUrl).not.toContain('secret')
  })
})

describe('SerpApi origin overnight hotels', () => {
  it('queries the selected origin and explicit one-night stay, retaining the whole-stay observed total once', async () => {
    const { adapter, input, context, fetcher } = await overnight()
    const result = await adapter.hotels(input, context)
    expect(result.offers).toHaveLength(1)
    const offer = result.offers[0]
    expect(NationalHotelOfferSchema.safeParse(offer).success).toBe(true)
    expect(offer).toMatchObject({
      originCityId: context.origin.id,
      name: 'San Diego Hotel',
      adults: 1,
      rooms: 1,
      timeZone: context.origin.timeZone,
      timeZoneStatus: 'estimated_from_origin_city',
      checkinPolicy: '3:00 PM',
      checkoutPolicy: '11:00 AM',
    })
    expect(offer.costs).toHaveLength(1)
    expect(offer.costs[0].cents).toBe(12000)
    expect(offer.costs[0].label).toMatch(/whole.stay/i)
    expect(offer.evidence[0]).toMatchObject({
      provider: 'SerpApi Google Hotels search',
      checkedAt: CREATED,
      providerUpdatedAt: PROCESSED,
    })
    expect(offer.evidence[0].warnings.join(' ')).toMatch(/additional.*fees|extra.*fees/i)
    expect(offer.handoffUrl).toContain('https://www.google.com/travel/hotels?')
    expect(new URL(offer.handoffUrl!).searchParams.get('q')).toContain(
      'San Diego Hotel San Diego CA US 2026-11-18 2026-11-19',
    )
    expect(fetcher).toHaveBeenCalledOnce()
    const p = new URL(String(fetcher.mock.calls[0][0])).searchParams
    for (
      const [key, value] of Object.entries({
        engine: 'google_hotels',
        q: 'Hotels in San Diego CA US',
        check_in_date: '2026-11-18',
        check_out_date: '2026-11-19',
        adults: '1',
        currency: 'USD',
        gl: 'us',
        hl: 'en',
        no_cache: 'true',
      })
    ) expect(p.get(key)).toBe(value)
  })

  it('labels nightly-only and before-tax amounts as estimates with unknown extra fees', async () => {
    const p = {
      ...property(),
      total_rate: undefined,
      rate_per_night: { lowest: '$90', extracted_lowest: 90 },
    }
    const { adapter, input, context } = await overnight({ search_metadata: metadata(), properties: [p] })
    const offer = (await adapter.hotels(input, context)).offers[0]
    expect(offer.costs[0].cents).toBe(9000)
    expect(offer.costs[0].label).toMatch(/estimate.*fees unknown/i)
    const before = await overnight({
      search_metadata: metadata(),
      properties: [{
        ...property(),
        total_rate: { extracted_before_taxes_fees: 70, before_taxes_fees: '$70' },
      }],
    })
    expect((await before.adapter.hotels(before.input, before.context)).offers[0].costs[0].label).toMatch(
      /before taxes.*fees unknown/i,
    )
  })

  it.each(['EUR', 'CAD'])('keeps unsupported currency %s unknown', async (currency) => {
    const { adapter, input, context } = await overnight({
      search_metadata: metadata(),
      properties: [{ ...property(), currency }],
    })
    expect((await adapter.hotels(input, context)).offers[0].costs[0].cents).toBeNull()
  })

  it('keeps a valid property with missing price unknown and changes fingerprint on reprice only', async () => {
    const a = await overnight()
    const b = await overnight({
      search_metadata: { ...metadata(), created_at: '2026-11-18T13:59:22Z' },
      properties: [property()],
    })
    const c = await overnight({
      search_metadata: metadata(),
      properties: [{ ...property(), total_rate: undefined }],
    })
    const oa = (await a.adapter.hotels(a.input, a.context)).offers[0]
    const ob = (await b.adapter.hotels(b.input, b.context)).offers[0]
    const oc = (await c.adapter.hotels(c.input, c.context)).offers[0]
    expect(ob.id).toBe(oa.id)
    expect(ob.fingerprint).toBe(oa.fingerprint)
    expect(oc.id).toBe(oa.id)
    expect(oc.fingerprint).not.toBe(oa.fingerprint)
    expect(oc.costs[0].cents).toBeNull()
  })

  it.each(['missing_gps', 'boston_gps', 'invalid_gps', 'missing_identity', 'html_name'])(
    'omits incomplete or out-of-origin property %s',
    async (kind) => {
      const p: Record<string, unknown> = property()
      if (kind === 'missing_gps') delete p.gps_coordinates
      if (kind === 'boston_gps') p.gps_coordinates = { latitude: 42.36, longitude: -71.06 }
      if (kind === 'invalid_gps') p.gps_coordinates = { latitude: 300, longitude: -117 }
      if (kind === 'missing_identity') delete p.property_token
      if (kind === 'html_name') p.name = '<script>secret</script>'
      const { adapter, input, context } = await overnight({ search_metadata: metadata(), properties: [p] })
      const result = await adapter.hotels(input, context)
      expect(result.offers).toEqual([])
      expect(result.sourceStatus.status).toBe('limited')
      expect(JSON.stringify(result)).not.toContain('secret')
    },
  )

  it('does not copy URL or HTML policy strings and bounds descriptive policy text', async () => {
    const { adapter, input, context } = await overnight({
      search_metadata: metadata(),
      properties: [{
        ...property(),
        cancellation_policy: 'https://evil.example/secret',
        check_in_time: '<b>3pm</b>',
        check_out_time: '11am\u0000',
      }],
    })
    const offer = (await adapter.hotels(input, context)).offers[0]
    expect(offer.cancellation).toBeNull()
    expect(offer.checkinPolicy).toBeNull()
    expect(offer.checkoutPolicy).toBe('11am')
  })

  it.each(['not_requested', 'not_aligned', 'multiple_nights', 'past_checkin'])(
    'does not fetch a hotel when %s',
    async (kind) => {
      const { adapter, input, context, fetcher } = await overnight()
      if (kind === 'not_requested') input.overnight = null
      if (kind === 'not_aligned') input.overnight = { checkin: '2026-11-19', checkout: '2026-11-20' }
      if (kind === 'multiple_nights') input.overnight = { checkin: '2026-11-17', checkout: '2026-11-19' }
      if (kind === 'past_checkin') {
        input.departureDate = '2026-11-18'
        input.overnight = { checkin: '2026-11-17', checkout: '2026-11-18' }
      }
      expect((await adapter.hotels(input, context)).sourceStatus.status).toBe('unavailable')
      expect(fetcher).not.toHaveBeenCalled()
    },
  )
})

describe('bounded search and defensive source handling', () => {
  it.each(['flights', 'hotels'] as const)(
    'does not copy encoded credentials from a %s source handoff',
    async (source) => {
      const body = source === 'flights'
        ? {
          ...flightsBody(),
          search_metadata: {
            ...metadata(),
            google_flights_url: 'https://www.google.com/travel/flights?q=fixture%2Dsecret',
          },
        }
        : hotelsBody()
      const s = await overnight(body)
      const result = await s.adapter[source](s.input, s.context)
      expect(decodeURIComponent(result.offers[0].handoffUrl!)).not.toContain('fixture-secret')
    },
  )

  it.each(['flights', 'hotels'] as const)(
    'retains an earlier explicit source expiry for %s',
    async (source) => {
      const body = source === 'flights' ? flightsBody() : hotelsBody()
      const s = await overnight({
        ...body,
        search_metadata: { ...metadata(), expires_at: '2026-11-18T14:01:00Z' },
      })
      const result = await s.adapter[source](s.input, s.context)
      expect(result.offers[0].evidence[0].expiresAt).toBe('2026-11-18T14:01:00Z')
      expect(result.sourceStatus.expiresAt).toBe('2026-11-18T14:01:00Z')
    },
  )

  it.each(['flights', 'hotels'] as const)(
    'reports malformed %s result collections as limited',
    async (source) => {
      const body = {
        search_metadata: metadata(),
        [source === 'flights' ? 'best_flights' : 'properties']: { not: 'an array' },
      }
      const s = await overnight(body)
      expect((await s.adapter[source](s.input, s.context)).sourceStatus.status).toBe('limited')
    },
  )

  it.each(['flights', 'hotels'] as const)(
    'reports an empty successful %s search without invented offers or further queries',
    async (source) => {
      const s = await overnight({ search_metadata: metadata() })
      const result = await s.adapter[source](s.input, s.context)
      expect(result.offers).toEqual([])
      expect(result.sourceStatus.status).toBe('empty')
      expect(result.sourceStatus.expiresAt).toBeNull()
      expect(s.fetcher).toHaveBeenCalledOnce()
    },
  )

  it.each(['flights', 'hotels'] as const)('rejects mismatched echoed %s search dates', async (source) => {
    const body = source === 'flights' ? flightsBody() : hotelsBody()
    const s = await overnight({
      ...body,
      search_parameters: source === 'flights'
        ? { outbound_date: '2026-12-01' }
        : { check_in_date: '2026-12-01' },
    })
    expect((await s.adapter[source](s.input, s.context)).offers).toEqual([])
    expect(s.fetcher).toHaveBeenCalledOnce()
  })

  it.each(['flights', 'hotels'] as const)(
    'bounds inspected %s results to 32 and output to three',
    async (source) => {
      const body = source === 'flights'
        ? {
          search_metadata: metadata(),
          best_flights: Array.from(
            { length: 33 },
            (_, index) => ({
              ...itinerary(),
              price: index === 32 ? 1 : index + 100,
              flights: [segment('SAN', 'PWM', '2026-11-19 09:00', '2026-11-19 17:00', 300, `AA ${index}`)],
            }),
          ),
        }
        : {
          search_metadata: metadata(),
          properties: Array.from(
            { length: 33 },
            (_, index) => ({
              ...property(),
              property_token: `property-${index}`,
              total_rate: { extracted_lowest: index === 32 ? 1 : index + 100 },
            }),
          ),
        }
      const s = await overnight(body)
      s.input.trip.priority = 'cheapest'
      const result = await s.adapter[source](s.input, s.context)
      expect(result.offers).toHaveLength(3)
      expect(result.offers.map((o) => o.costs[0].cents)).toEqual([10000, 10100, 10200])
      expect(s.fetcher).toHaveBeenCalledOnce()
    },
  )

  it.each(['flights', 'hotels'] as const)(
    'uses no followup after cancellation of a %s HTTP request',
    async (source) => {
      const controller = new AbortController()
      const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}))
      const s = await overnight(undefined, { fetch: fetcher })
      s.context.signal = controller.signal
      const pending = s.adapter[source](s.input, s.context)
      controller.abort()
      const result = await pending
      expect(result.offers).toEqual([])
      expect(result.sourceStatus.status).toBe('unavailable')
      expect(fetcher).toHaveBeenCalledOnce()
    },
  )

  it.each(['disabled', 'missing_key', 'not_investigating', 'cancelled', 'city_binding', 'airport_binding'])(
    'does not fetch a hotel for %s',
    async (kind) => {
      const s = await overnight(
        undefined,
        kind === 'disabled' ? { enabled: false } : kind === 'missing_key' ? { apiKey: undefined } : {},
      )
      if (kind === 'not_investigating') s.input.investigate = false
      if (kind === 'cancelled') {
        const controller = new AbortController()
        controller.abort()
        s.context.signal = controller.signal
      }
      if (kind === 'city_binding') s.context.destination.id = 'geonames:123'
      if (kind === 'airport_binding') s.context.destinationAirport = findAirport('BOS')!
      expect((await s.adapter.hotels(s.input, s.context)).offers).toEqual([])
      expect(s.fetcher).not.toHaveBeenCalled()
    },
  )

  it.each(['2026-11-18T13:54:59Z', '2026-11-18T14:00:01Z', undefined])(
    'never refreshes a hotel source check %s',
    async (created_at) => {
      const s = await overnight({ ...hotelsBody(), search_metadata: { created_at } })
      expect((await s.adapter.hotels(s.input, s.context)).offers).toEqual([])
    },
  )

  it('keeps a safe source Google Flights handoff', async () => {
    const url = 'https://www.google.com/travel/flights?hl=en&tfs=official_search_context'
    const s = await setup({ ...flightsBody(), search_metadata: { ...metadata(), google_flights_url: url } })
    expect((await s.adapter.flights(s.input, s.context)).offers[0].handoffUrl).toBe(url)
  })

  it('never trusts provider airport coordinates, names, or time zones', async () => {
    const s = await setup({
      search_metadata: metadata(),
      other_flights: [{
        ...itinerary(),
        flights: [{
          ...segment(),
          departure_airport: {
            id: 'SAN',
            name: 'Fake airport',
            time: '2026-11-19 09:00',
            latitude: 1,
            longitude: 1,
            time_zone: 'Europe/London',
          },
        }],
      }],
    })
    expect((await s.adapter.flights(s.input, s.context)).offers[0].segments[0].originAirport).toEqual(
      findAirport('SAN'),
    )
  })

  it('rejects an unknown intermediate airport and malformed layover duration', async () => {
    const body = {
      search_metadata: metadata(),
      other_flights: [{
        flights: [
          segment('SAN', 'ZZZ', '2026-11-19 09:00', '2026-11-19 15:00', 240),
          segment('ZZZ', 'PWM', '2026-11-19 16:00', '2026-11-19 19:00', 120),
        ],
        total_duration: 420,
        price: 50,
      }],
    }
    const s = await setup(body)
    expect((await s.adapter.flights(s.input, s.context)).offers).toEqual([])
    const b = await setup({
      search_metadata: metadata(),
      other_flights: [{
        flights: [
          segment('SAN', 'ORD', '2026-11-19 09:00', '2026-11-19 15:00', 240),
          segment('ORD', 'PWM', '2026-11-19 16:00', '2026-11-19 19:00', 120, 'AA 2'),
        ],
        total_duration: 420,
        layovers: [{ duration: 1 }],
        price: 50,
      }],
    })
    expect((await b.adapter.flights(b.input, b.context)).offers).toEqual([])
  })

  it('ranks earliest arrival and fewest boardings according to the request', async () => {
    const body = {
      search_metadata: metadata(),
      other_flights: [itinerary(), {
        flights: [
          segment('SAN', 'ORD', '2026-11-19 06:00', '2026-11-19 12:00', 240),
          segment('ORD', 'PWM', '2026-11-19 13:00', '2026-11-19 16:00', 120, 'AA 2'),
        ],
        total_duration: 420,
        price: 50,
      }],
    }
    const s = await setup(body)
    expect((await s.adapter.flights(s.input, s.context)).offers[0].segments).toHaveLength(2)
    s.input.trip.priority = 'fewest_transfers'
    expect((await s.adapter.flights(s.input, s.context)).offers[0].segments).toHaveLength(1)
  })

  it('keeps an explicitly non-USD flight fare unknown', async () => {
    const s = await setup({
      search_metadata: metadata(),
      other_flights: [{ ...itinerary(), currency: 'EUR' }],
    })
    expect((await s.adapter.flights(s.input, s.context)).offers[0].costs[0].cents).toBeNull()
  })

  it.each(['check_in_date', 'check_out_date', 'adults', 'rooms'])(
    'rejects contradictory property stay field %s',
    async (key) => {
      const s = await overnight({
        search_metadata: metadata(),
        properties: [{ ...property(), [key]: key.includes('date') ? '2026-12-01' : 2 }],
      })
      expect((await s.adapter.hotels(s.input, s.context)).offers).toEqual([])
    },
  )

  it('does not turn a displayed unsupported hotel currency into a known USD total', async () => {
    const s = await overnight({
      search_metadata: metadata(),
      properties: [{ ...property(), total_rate: { lowest: '€120', extracted_lowest: 120 } }],
    })
    expect((await s.adapter.hotels(s.input, s.context)).offers[0].costs[0].cents).toBeNull()
  })
})

describe('review regressions for canonical credentials and airport-local dates', () => {
  it('redacts the normalized credential from flight descriptive fields', async () => {
    const s = await setup({
      search_metadata: metadata(),
      other_flights: [{ ...itinerary(), flights: [{ ...segment(), airline: 'fixture-secret' }] }],
    }, { apiKey: ' fixture-secret ' })
    const result = await s.adapter.flights(s.input, s.context)
    expect(result.offers).toEqual([])
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
    expect(new URL(String(s.fetcher.mock.calls[0][0])).searchParams.get('api_key')).toBe('fixture-secret')
  })

  it('redacts the normalized credential from a source Google Flights handoff', async () => {
    const s = await setup({
      ...flightsBody(),
      search_metadata: {
        ...metadata(),
        google_flights_url: 'https://www.google.com/travel/flights?q=fixture-secret',
      },
    }, { apiKey: ' fixture-secret ' })
    const result = await s.adapter.flights(s.input, s.context)
    expect(result.offers).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
  })

  it('redacts the normalized credential from hotel identity and policies', async () => {
    const s = await overnight({
      search_metadata: metadata(),
      properties: [{ ...property(), name: 'fixture-secret' }, {
        ...property(),
        cancellation_policy: 'fixture-secret',
      }],
    }, { apiKey: ' fixture-secret ' })
    const result = await s.adapter.hotels(s.input, s.context)
    expect(result.offers).toHaveLength(1)
    expect(result.offers[0].cancellation).toBeNull()
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
  })

  it('uses selected departure-airport readiness hour when the city has a different zone', async () => {
    const s = await setup({
      search_metadata: metadata(),
      other_flights: [{
        flights: [segment('DHN', 'PWM', '2026-11-18 10:30', '2026-11-18 14:30', 180)],
        total_duration: 180,
        price: 100,
      }],
    })
    Object.assign(s.context.origin, {
      id: 'geonames:4174715',
      name: 'Tallahassee',
      stateCode: 'FL',
      stateName: 'Florida',
      latitude: 30.4383,
      longitude: -84.2807,
      timeZone: 'America/New_York',
    })
    s.context.originAirport = findAirport('DHN')!
    s.input.trip.originCityId = s.context.origin.id
    s.input.originAirportIata = 'DHN'
    s.input.departureDate = '2026-11-18'
    s.input.trip.readyAt = '2026-11-18T11:00:00-05:00'
    const result = await s.adapter.flights(s.input, s.context)
    expect(result.offers).toHaveLength(1)
    expect(new URL(String(s.fetcher.mock.calls[0][0])).searchParams.get('outbound_times')).toBe('10,23')
  })

  it('keeps an airport-local departure date that is the previous city-local day across midnight', async () => {
    const s = await setup({
      search_metadata: { created_at: '2026-11-18T05:29:00Z' },
      other_flights: [{
        flights: [segment('DHN', 'PWM', '2026-11-17 23:50', '2026-11-18 03:50', 180)],
        total_duration: 180,
        price: 100,
      }],
    }, { now: () => '2026-11-18T05:30:00Z' })
    Object.assign(s.context.origin, {
      id: 'geonames:4174715',
      name: 'Tallahassee',
      stateCode: 'FL',
      stateName: 'Florida',
      latitude: 30.4383,
      longitude: -84.2807,
      timeZone: 'America/New_York',
    })
    s.context.originAirport = findAirport('DHN')!
    s.input.trip.originCityId = s.context.origin.id
    s.input.originAirportIata = 'DHN'
    s.input.departureDate = '2026-11-17'
    s.input.trip.readyAt = '2026-11-18T00:40:00-05:00'
    const result = await s.adapter.flights(s.input, s.context)
    expect(result.offers).toHaveLength(1)
    expect(s.fetcher).toHaveBeenCalledOnce()
    expect(new URL(String(s.fetcher.mock.calls[0][0])).searchParams.get('outbound_times')).toBe('23,23')
  })
})
