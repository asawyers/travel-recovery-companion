import { describe, expect, it } from 'vitest'
const implementation = () => import('@domain/travel-contracts').catch(() => null)
describe('strict travel v3 contracts', () => {
  it('requires a distinct strict versioned contract with no browser inventory', async () => {
    const p = await implementation()
    expect(p, 'travel contracts exist').not.toBeNull()
    const { travelFixture } = await import('@domain/travel-fixtures')
    const f = travelFixture()
    expect(p!.TravelRecoveryInputSchema.safeParse(f.input).success).toBe(true)
    expect(p!.TravelRecoveryInputSchema.safeParse({ ...f.input, confirmedOptions: [] }).success).toBe(false)
    expect(p!.TravelRecoveryInputSchema.safeParse({ ...f.input, version: 2 }).success).toBe(false)
  })
  it('validates one-night hotel dates and complete airport metadata', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const { travelFixture } = await import('@domain/travel-fixtures')
    const f = travelFixture()
    expect(p!.NationalHotelOfferSchema.safeParse(f.hotel).success).toBe(true)
    expect(p!.NationalHotelOfferSchema.safeParse({ ...f.hotel, checkout: '2026-11-21' }).success).toBe(false)
    expect(p!.FlightOfferSchema.safeParse(f.flight).success).toBe(true)
    const broken = structuredClone(f.flight)
    broken.segments[0].originAirport.timeZone = 'Mars/Olympus'
    expect(p!.FlightOfferSchema.safeParse(broken).success).toBe(false)
  })
  it('binds IDs to routing and fingerprints to quote details, never freshness rewrites', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const { travelFixture } = await import('@domain/travel-fixtures')
    const f = travelFixture()
    const repriced = structuredClone(f.flight)
    repriced.costs[0].cents! += 1
    expect(p!.flightOfferId(repriced)).toBe(f.flight.id)
    expect(p!.flightOfferFingerprint(repriced)).not.toBe(f.flight.fingerprint)
    const refreshed = structuredClone(f.flight)
    refreshed.evidence[0].checkedAt = '2026-11-18T06:01:00-08:00'
    expect(p!.flightOfferFingerprint(refreshed)).toBe(f.flight.fingerprint)
  })
})

it('binds quote fingerprints to segment IDs while ignoring only top-level identity and provenance', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const f = travelFixture()
  f.flight.segments[0].id = 'different-segment'
  expect(p!.flightOfferFingerprint(f.flight)).not.toBe(f.flight.fingerprint)
})
it('validates response inventory bindings and never echoes conversation history', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const f = travelFixture()
  f.input.refinement = 'Private request'
  f.input.conversation = { turnId: 'turn', baseRevision: 0, history: [{ role: 'user', content: 'Private history' }] }
  const response = {
    version: 3 as const,
    request: p!.travelRequestBinding(f.input),
    origin: f.origin,
    destination: f.destination,
    generatedAt: f.now,
    expiresAt: f.flight.evidence[0].expiresAt!,
    flightOffers: [f.flight],
    hotelOffers: [],
    sourceStatuses: [],
    journey: null,
    selectionIssue: null,
    warnings: [],
  }
  expect(JSON.stringify(response)).not.toMatch(/Private history|Private request/)
  expect(p!.TravelRecoveryResponseSchema.safeParse(response).success).toBe(true)
  const unbound = structuredClone(response)
  unbound.flightOffers[0].destinationCityId = 'geonames:1'
  expect(p!.TravelRecoveryResponseSchema.safeParse(unbound).success).toBe(false)
  const forged = structuredClone(response)
  forged.flightOffers[0].costs[0].cents! += 1
  expect(p!.TravelRecoveryResponseSchema.safeParse(forged).success).toBe(false)
  expect(p!.TravelRecoveryResponseSchema.safeParse({ ...response, conversation: f.input.conversation }).success).toBe(
    false,
  )
})
it('bounds response expiry by original checks when providers omit explicit expiry', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const f = travelFixture()
  for (const e of [...f.flight.evidence, ...f.flight.segments.flatMap((s) => s.evidence)]) e.expiresAt = null
  const response = {
    version: 3,
    request: p!.travelRequestBinding(f.input),
    origin: f.origin,
    destination: f.destination,
    generatedAt: '2026-11-18T06:03:00-08:00',
    expiresAt: '2026-11-18T06:08:00-08:00',
    flightOffers: [f.flight],
    hotelOffers: [],
    sourceStatuses: [],
    journey: null,
    selectionIssue: null,
    warnings: [],
  }
  expect(p!.TravelRecoveryResponseSchema.safeParse(response).success).toBe(false)
})
it('does not accept disconnected or altered selectable journey payloads', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const f = travelFixture()
  const { composeTravelJourney } = await import('@domain/travel-planner')
  const j = composeTravelJourney(f.input, f.flight, null, f)
  const changed = structuredClone(j)
  changed.legs[1].from = { ...changed.legs[1].from, latitude: changed.legs[1].from.latitude + 1 }
  expect(p!.TravelJourneySchema.safeParse(changed).success).toBe(false)
  const end = structuredClone(j)
  end.finalArrivalAt = f.now
  expect(p!.TravelJourneySchema.safeParse(end).success).toBe(false)
})
it('rejects duplicate quote identities, unbound segments and invalid clarification effects', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const f = travelFixture()
  const flight = structuredClone(f.flight)
  flight.segments[1].boardingId = flight.segments[0].boardingId
  expect(p!.FlightOfferSchema.safeParse(flight).success).toBe(false)
  const endpoint = structuredClone(f.flight)
  endpoint.originAirportIata = 'LAX'
  expect(p!.FlightOfferSchema.safeParse(endpoint).success).toBe(false)
  const response = {
    version: 3,
    request: p!.travelRequestBinding(f.input),
    origin: f.origin,
    destination: f.destination,
    generatedAt: f.now,
    expiresAt: f.flight.evidence[0].expiresAt!,
    flightOffers: [f.flight, f.flight],
    hotelOffers: [],
    sourceStatuses: [],
    journey: null,
    selectionIssue: null,
    warnings: [],
  }
  expect(p!.TravelRecoveryResponseSchema.safeParse(response).success).toBe(false)
  expect(
    p!.TravelAssistanceSchema.safeParse({
      status: 'completed',
      summary: 'Needs facts',
      appliedPreferences: { priority: 'cheapest' },
      selectedPlanId: 'id',
      activity: [],
      clarification: { field: 'hotel', reason: 'required' },
    }).success,
  ).toBe(false)
})
it('requires a selected journey to match returned inventory and rejects hotel quotes without a requested stay', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const { composeTravelJourney } = await import('@domain/travel-planner')
  const f = travelFixture()
  const response = {
    version: 3,
    request: p!.travelRequestBinding(f.input),
    origin: f.origin,
    destination: f.destination,
    generatedAt: f.now,
    expiresAt: f.flight.evidence[0].expiresAt!,
    flightOffers: [f.flight],
    hotelOffers: [],
    sourceStatuses: [],
    journey: composeTravelJourney(f.input, f.flight, null, f),
    selectionIssue: null,
    warnings: [],
  }
  expect(p!.TravelRecoveryResponseSchema.safeParse({ ...response, flightOffers: [] }).success).toBe(false)
  expect(p!.TravelRecoveryResponseSchema.safeParse({ ...response, hotelOffers: [f.hotel] }).success).toBe(false)
  const changed = structuredClone(response)
  changed.journey.flightOfferId = 'unbound'
  expect(p!.TravelRecoveryResponseSchema.safeParse(changed).success).toBe(false)
})
it('accepts only nullable customer handoff URLs and rejects provider URLs or credential parameters', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const f = travelFixture()
  expect(
    p!.FlightOfferSchema.safeParse({
      ...f.flight,
      handoffUrl: 'https://www.google.com/travel/flights?q=Flights+SAN+PWM',
    }).success,
  ).toBe(true)
  for (const handoffUrl of [
    'https://serpapi.com/search?api_key=secret',
    'https://www.google.com/travel/flights?api_key=secret',
    'https://evil.test/travel/flights',
  ])
    expect(p!.FlightOfferSchema.safeParse({ ...f.flight, handoffUrl }).success).toBe(false)
})

it('rejects an empty segment array without throwing from offer refinements', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const f = travelFixture()
  expect(() => p!.FlightOfferSchema.safeParse({ ...f.flight, segments: [] })).not.toThrow()
  expect(p!.FlightOfferSchema.safeParse({ ...f.flight, segments: [] }).success).toBe(false)
})

it('rejects invalid journey money without throwing from aggregate refinements', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture } = await import('@domain/travel-fixtures')
  const { composeTravelJourney } = await import('@domain/travel-planner')
  const f = travelFixture()
  const journey = composeTravelJourney(f.input, f.flight, null, f)
  journey.costs[0].cents = -1
  expect(() => p!.TravelJourneySchema.safeParse(journey)).not.toThrow()
  expect(p!.TravelJourneySchema.safeParse(journey).success).toBe(false)
})

async function completedTravelResponse(overnight = false) {
  const p = await implementation()
  expect(p).not.toBeNull()
  const { travelFixture, overnightTravelFixture } = await import('@domain/travel-fixtures')
  const { composeTravelJourney } = await import('@domain/travel-planner')
  const f = overnight ? overnightTravelFixture() : travelFixture()
  return {
    schema: p!.TravelRecoveryResponseSchema,
    response: {
      version: 3 as const,
      request: p!.travelRequestBinding(f.input),
      origin: f.origin,
      destination: f.destination,
      generatedAt: f.now,
      expiresAt: f.flight.evidence[0].expiresAt!,
      flightOffers: [f.flight],
      hotelOffers: overnight ? [f.hotel] : [],
      sourceStatuses: [],
      journey: composeTravelJourney(f.input, f.flight, overnight ? f.hotel : null, f),
      selectionIssue: null,
      warnings: [],
    },
  }
}

it('rejects shifted journey flight times against unchanged selected inventory', async () => {
  const { schema, response } = await completedTravelResponse()
  expect(schema.safeParse(response).success).toBe(true)
  const nextDay = (value: string) => new Date(Date.parse(value) + 86400000).toISOString()
  response.journey.legs.forEach((leg) => {
    leg.startAt = nextDay(leg.startAt)
    leg.endAt = nextDay(leg.endAt)
  })
  response.journey.finalArrivalAt = nextDay(response.journey.finalArrivalAt)
  expect(schema.safeParse(response).success).toBe(false)
})

it('rejects flight boarding, airline, airport and source changes against selected inventory', async () => {
  for (const mutate of [
    (leg: any) => {
      leg.boardingId = 'changed-boarding'
    },
    (leg: any) => {
      leg.operator = 'Changed airline'
    },
    (leg: any) => {
      leg.service = 'Changed flight'
    },
    (leg: any) => {
      leg.evidence[0].provider = 'Changed source'
    },
  ]) {
    const { schema, response } = await completedTravelResponse()
    mutate(response.journey.legs.find((leg) => leg.kind === 'flight')!)
    expect(schema.safeParse(response).success).toBe(false)
  }
})

it('rejects hotel property, timing and evidence changes against selected stay facts', async () => {
  for (const mutate of [
    (leg: any) => {
      leg.from = { ...leg.from, name: 'Different property' }
      leg.to = leg.from
    },
    (leg: any) => {
      leg.startAt = '2026-11-18T17:00:00-08:00'
    },
    (leg: any) => {
      leg.evidence[0].provider = 'Changed source'
    },
  ]) {
    const { schema, response } = await completedTravelResponse(true)
    expect(schema.safeParse(response).success).toBe(true)
    mutate(response.journey.legs.find((leg) => leg.kind === 'hotel')!)
    expect(schema.safeParse(response).success).toBe(false)
  }
})

it('rejects erased global or per-leg source charges even when totals are recomputed', async () => {
  const { schema, response } = await completedTravelResponse()
  response.journey.costs = []
  response.journey.knownCostCents = 0
  response.journey.priceComplete = true
  expect(schema.safeParse(response).success).toBe(false)
  response.journey.legs.forEach((leg) => {
    leg.costs = []
  })
  expect(schema.safeParse(response).success).toBe(false)
})

it('rejects a duration that disagrees with the request-ready instant', async () => {
  const { schema, response } = await completedTravelResponse()
  response.journey.durationMinutes = 0
  expect(schema.safeParse(response).success).toBe(false)
})

it('rejects duplicate selected fare copied onto a different leg despite consistent aggregate totals', async () => {
  const { schema, response } = await completedTravelResponse()
  response.journey.legs
    .find((leg) => leg.kind === 'processing')!
    .costs.push(structuredClone(response.flightOffers[0].costs[0]))
  response.journey.costs = response.journey.legs.flatMap((leg) => leg.costs)
  response.journey.knownCostCents += response.flightOffers[0].costs[0].cents!
  expect(schema.safeParse(response).success).toBe(false)
})
