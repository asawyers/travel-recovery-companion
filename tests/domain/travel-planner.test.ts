import { describe, expect, it } from 'vitest'
import { travelFixture, overnightTravelFixture } from '@domain/travel-fixtures'
import {
  flightOfferFingerprint,
  flightOfferId,
  hotelOfferFingerprint,
  hotelOfferId,
  TravelJourneySchema,
} from '@domain/travel-contracts'
const implementation = () => import('@domain/travel-planner').catch(() => null)
function bind(f: ReturnType<typeof travelFixture>) {
  f.flight.id = flightOfferId(f.flight)
  f.flight.fingerprint = flightOfferFingerprint(f.flight)
  f.input.selection!.flightOfferId = f.flight.id
  f.input.selection!.flightFingerprint = f.flight.fingerprint
  f.hotel.id = hotelOfferId(f.hotel)
  f.hotel.fingerprint = hotelOfferFingerprint(f.hotel)
  if (f.input.selection!.hotelOfferId) {
    f.input.selection!.hotelOfferId = f.hotel.id
    f.input.selection!.hotelFingerprint = f.hotel.fingerprint
  }
}
describe('pure complete travel composition', () => {
  it('composes cross-zone SAN ORD PWM with each boarding and original evidence without mutating facts', async () => {
    const p = await implementation()
    expect(p, 'planner exists').not.toBeNull()
    const f = travelFixture(),
      before = JSON.stringify(f)
    const j = p!.composeTravelJourney(f.input, f.flight, null, f)
    expect(j.selectable).toBe(true)
    expect(j.boardings).toBe(2)
    expect(j.transfers).toBe(1)
    expect(j.finalArrivalAt).toBe('2026-11-19T19:50:00-05:00')
    expect(j.knownCostCents).toBe(29000)
    expect(j.priceComplete).toBe(true)
    expect(j.feasibility).toBe('requires_confirmation')
    expect(j.legs.filter((l) => l.kind === 'flight')).toHaveLength(2)
    expect(j.legs.some((l) => l.kind === 'wait')).toBe(true)
    expect(j.evidenceExpiresAt).toBe(f.flight.evidence[0].expiresAt)
    expect(JSON.stringify(f)).toBe(before)
    expect(TravelJourneySchema.safeParse(j).success).toBe(true)
    for (let i = 1; i < j.legs.length; i++) {
      expect(Date.parse(j.legs[i].startAt)).toBe(Date.parse(j.legs[i - 1].endAt))
      expect(j.legs[i].from).toEqual(j.legs[i - 1].to)
    }
  })
  it('does not form a journey from unselected quotes or changed selection fingerprints', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const f = travelFixture()
    f.input.selection = null
    expect(p!.assessTravelSelection(f.input, f)).toEqual({ journey: null, selectionIssue: null })
    f.input = travelFixture().input
    f.input.selection!.flightFingerprint = 'changed'
    expect(p!.assessTravelSelection(f.input, f).selectionIssue).toBe('flight_changed')
    f.input.selection!.flightOfferId = 'missing'
    expect(p!.assessTravelSelection(f.input, f).selectionIssue).toBe('flight_missing')
  })
  it('allows a direct flight with no connection and rejects infeasible origin access', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const f = travelFixture()
    f.flight.segments = [
      {
        ...f.flight.segments[0],
        destinationAirport: f.flight.segments[1].destinationAirport,
        arrivalAt: '2026-11-19T17:00:00-05:00',
        durationMinutes: 300,
      },
    ]
    f.input.selection!.facts.connections = []
    bind(f)
    const j = p!.composeTravelJourney(f.input, f.flight, null, f)
    expect(j.selectable).toBe(true)
    expect(j.boardings).toBe(1)
    expect(j.transfers).toBe(0)
    f.input.trip.readyAt = '2026-11-19T07:00:00-08:00'
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).violations.join(' ')).toMatch(/ready|access/i)
  })
  it('requires every connection allowance and explicit transfers when airports change', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const f = travelFixture()
    f.input.selection!.facts.connections = []
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(false)
    f.input.selection!.facts.connections = [
      { afterSegmentId: 'segment-1', allowanceMinutes: 10, airportTransfer: null },
    ]
    f.flight.segments[1].originAirport = {
      ...f.flight.segments[1].originAirport,
      iata: 'MDW',
      name: 'Midway',
      latitude: 41.7868,
      longitude: -87.7522,
    }
    bind(f)
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).violations.join(' ')).toMatch(/airport.*transfer/i)
    f.input.selection!.facts.connections[0].airportTransfer = { minutes: 40, costCents: null }
    const j = p!.composeTravelJourney(f.input, f.flight, null, f)
    expect(j.selectable).toBe(true)
    expect(j.priceComplete).toBe(false)
    expect(j.legs.find((l) => l.from.name.includes('O’Hare') && l.to.name === 'Midway')?.kind).toBe('transfer')
    f.input.selection!.facts.connections[0].allowanceMinutes = 30
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(false)
  })
  it('makes a connected origin overnight stay with no invented hotel policy', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const f = overnightTravelFixture(),
      j = p!.composeTravelJourney(f.input, f.flight, f.hotel, f)
    expect(j.selectable).toBe(true)
    expect(j.knownCostCents).toBe(43000)
    expect(j.legs.filter((l) => l.kind === 'hotel')).toHaveLength(1)
    expect(j.legs[0].kind).toBe('wait')
    f.input.selection!.facts.stay!.arrangementsConfirmed = false
    expect(p!.composeTravelJourney(f.input, f.flight, f.hotel, f).violations.join(' ')).toMatch(/arrangements|policy/i)
    f.input.selection!.facts.stay!.arrangementsConfirmed = true
    f.input.selection!.facts.stay!.hotelDepartureAt = '2026-11-19T07:00:00-08:00'
    expect(p!.composeTravelJourney(f.input, f.flight, f.hotel, f).violations.join(' ')).toMatch(/processing|airport/i)
  })
  it('rejects incorrect stay dates, impossible checkin and missing stay selection facts', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    for (const change of [
      (f: ReturnType<typeof overnightTravelFixture>) => {
        f.input.selection!.facts.stay!.hotelArrivalAt = '2026-11-19T01:00:00-08:00'
      },
      (f: ReturnType<typeof overnightTravelFixture>) => {
        f.input.selection!.facts.stay!.hotelDepartureAt = f.input.selection!.facts.stay!.hotelArrivalAt
      },
      (f: ReturnType<typeof overnightTravelFixture>) => {
        f.input.selection!.facts.stay = null
      },
    ]) {
      const f = overnightTravelFixture()
      change(f)
      expect(p!.composeTravelJourney(f.input, f.flight, f.hotel, f).selectable).toBe(false)
    }
  })
  it('keeps unknown mandatory costs incomplete under a hard budget and charges source totals once', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const f = travelFixture()
    f.input.trip.budgetMode = 'hard'
    f.input.trip.budgetCents = 29000
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(true)
    f.input.selection!.facts.flightExtrasCents = null
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).violations.join(' ')).toMatch(/budget|unknown/i)
    f.input.trip.budgetMode = 'soft'
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(true)
    f.flight.costs = [{ label: 'Included only', cents: 0, currency: 'USD', includedInOtherCharge: true }]
    bind(f)
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).priceComplete).toBe(false)
  })
  it('rejects expired and future original evidence without refreshing it', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const f = travelFixture()
    f.flight.segments[0].evidence[0].expiresAt = f.now
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).violations.join(' ')).toMatch(/expired/i)
    expect(p!.assessTravelSelection(f.input, f).selectionIssue).toBe('expired')
    f.flight.segments[0].evidence[0].expiresAt = null
    f.flight.evidence[0].checkedAt = '2026-11-18T06:01:00-08:00'
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(false)
  })
  it('uses elapsed instants over DST and midnight and applies the final destination deadline', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    const f = travelFixture()
    f.now = '2026-10-31T12:00:00Z'
    f.input.trip.readyAt = '2026-10-31T20:00:00-07:00'
    f.input.departureDate = f.flight.departureDate = '2026-11-01'
    f.flight.segments = [
      {
        ...f.flight.segments[0],
        departureAt: '2026-11-01T00:30:00-07:00',
        arrivalAt: '2026-11-01T01:30:00-08:00',
        destinationAirport: { ...f.flight.segments[1].destinationAirport, timeZone: 'America/Los_Angeles' },
        durationMinutes: 120,
      },
    ]
    f.input.selection!.facts.connections = []
    f.input.selection!.facts.checkedAt = f.now
    for (const e of [...f.flight.evidence, ...f.flight.segments.flatMap((s) => s.evidence)]) {
      e.checkedAt = f.now
      e.expiresAt = '2026-10-31T12:05:00Z'
      e.serviceDate = '2026-11-01'
    }
    bind(f)
    const j = p!.composeTravelJourney(f.input, f.flight, null, f)
    expect(j.selectable).toBe(true)
    const leg = j.legs.find((l) => l.kind === 'flight')!
    expect((Date.parse(leg.endAt) - Date.parse(leg.startAt)) / 60000).toBe(120)
    f.input.trip.deadlineAt = '2026-11-01T02:19:00-08:00'
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(false)
  })
  it('rejects inconsistent offer identity, chronology, dates and bindings', async () => {
    const p = await implementation()
    expect(p).not.toBeNull()
    for (const change of [
      (f: ReturnType<typeof travelFixture>) => {
        f.flight.id = 'wrong'
      },
      (f: ReturnType<typeof travelFixture>) => {
        f.flight.segments[0].arrivalAt = '2026-11-19T08:00:00-08:00'
        bind(f)
      },
      (f: ReturnType<typeof travelFixture>) => {
        f.flight.originCityId = 'geonames:1'
        bind(f)
      },
      (f: ReturnType<typeof travelFixture>) => {
        f.input.departureDate = '2026-11-20'
      },
    ]) {
      const f = travelFixture()
      change(f)
      expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(false)
    }
  })
})
it('enforces complete seven-day coverage and leaves an explicit later deadline usable', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const f = travelFixture()
  f.input.trip.readyAt = '2026-11-12T16:50:00-08:00'
  expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(true)
  f.input.trip.readyAt = '2026-11-12T16:49:00-08:00'
  expect(p!.composeTravelJourney(f.input, f.flight, null, f).violations.join(' ')).toMatch(/seven.day/i)
  f.input.trip.deadlineAt = '2026-11-20T00:00:00-05:00'
  expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(true)
})
it('preserves real source expiry and detects a hotel quote reprice or missing property', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const f = overnightTravelFixture()
  f.hotel.costs[0].cents! += 1
  expect(p!.assessTravelSelection(f.input, f).selectionIssue).toBe('hotel_changed')
  f.hotelOffers = []
  expect(p!.assessTravelSelection(f.input, f).selectionIssue).toBe('hotel_missing')
})
it('does not expire old manual transfer checks when provider inventory remains fresh', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const f = travelFixture()
  f.input.selection!.facts.checkedAt = '2026-11-18T05:54:00-08:00'
  const j = p!.composeTravelJourney(f.input, f.flight, null, f)
  expect(j.selectable).toBe(true)
  expect(j.evidence.some((e) => e.type === 'traveler_confirmed' && e.checkedAt === '2026-11-18T05:54:00-08:00')).toBe(
    true,
  )
})

it('represents all elapsed time from readiness with an explicit origin wait before direct access', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const f = travelFixture()
  const journey = p!.composeTravelJourney(f.input, f.flight, null, f)
  expect(journey.legs[0].kind).toBe('wait')
  expect(journey.legs[0].startAt).toBe(f.input.trip.readyAt)
  expect(journey.legs[0].from).toEqual(journey.legs[0].to)
  expect(journey.legs[0].assumptions.join(' ')).toMatch(/accommodation|lodging/i)
  const elapsed = journey.legs.reduce(
    (total, leg) => total + (Date.parse(leg.endAt) - Date.parse(leg.startAt)) / 60000,
    0,
  )
  expect(elapsed).toBe(journey.durationMinutes)
})

it('preserves all 32 source charges plus extras in schema-valid selected flight and hotel journeys', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const f = overnightTravelFixture()
  f.flight.costs = Array.from({ length: 32 }, (_, i) => ({
    label: `Flight charge ${i}`,
    cents: 100,
    currency: 'USD',
    includedInOtherCharge: false,
  }))
  f.hotel.costs = Array.from({ length: 32 }, (_, i) => ({
    label: `Hotel charge ${i}`,
    cents: 100,
    currency: 'USD',
    includedInOtherCharge: false,
  }))
  bind(f)
  const journey = p!.composeTravelJourney(f.input, f.flight, f.hotel, f)
  expect(journey.selectable).toBe(true)
  expect(journey.knownCostCents).toBe(12400)
  expect(journey.legs.find((leg) => leg.kind === 'flight')!.costs).toHaveLength(33)
  expect(journey.legs.find((leg) => leg.kind === 'hotel')!.costs).toHaveLength(33)
  expect(TravelJourneySchema.safeParse(journey).success).toBe(true)
})

it('rejects prospective origin airport access that already started despite a future flight and fresh quote', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const f = travelFixture()
  f.now = '2026-11-19T08:00:00-08:00'
  f.input.trip.readyAt = '2026-11-19T06:00:00-08:00'
  for (const evidence of [...f.flight.evidence, ...f.flight.segments.flatMap((segment) => segment.evidence)]) {
    evidence.checkedAt = f.now
    evidence.expiresAt = '2026-11-19T08:05:00-08:00'
  }
  const before = JSON.stringify(f)
  const journey = p!.composeTravelJourney(f.input, f.flight, null, f)
  expect(journey.selectable).toBe(false)
  expect(journey.violations.join(' ')).toMatch(/origin airport access.*already|origin airport access.*current/i)
  expect(JSON.stringify(f)).toBe(before)
  expect(journey.evidenceExpiresAt).toBe('2026-11-19T08:05:00-08:00')
})

it('rejects prospective origin hotel access that already started without rewriting readiness or evidence', async () => {
  const p = await implementation()
  expect(p).not.toBeNull()
  const f = overnightTravelFixture()
  f.now = '2026-11-18T16:00:00-08:00'
  for (const evidence of [
    ...f.flight.evidence,
    ...f.flight.segments.flatMap((segment) => segment.evidence),
    ...f.hotel.evidence,
  ]) {
    evidence.checkedAt = f.now
    evidence.expiresAt = '2026-11-18T16:05:00-08:00'
  }
  const before = JSON.stringify(f)
  const journey = p!.composeTravelJourney(f.input, f.flight, f.hotel, f)
  expect(journey.selectable).toBe(false)
  expect(journey.violations.join(' ')).toMatch(/origin hotel access.*already|origin hotel access.*current/i)
  expect(JSON.stringify(f)).toBe(before)
  expect(journey.evidenceExpiresAt).toBe('2026-11-18T16:05:00-08:00')
})

describe('nearby-airport onward composition', () => {
  async function example(kind: 'transit' | 'drive' = 'transit') {
    const { findAirport } = await import('@domain/airport-metadata')
    const { onwardOfferId } = await import('@domain/travel-contracts')
    const f = travelFixture(), airport = findAirport('BOS')!
    f.flight.destinationAirportIata = 'BOS'
    f.flight.segments.at(-1)!.destinationAirport = airport
    f.input.destinationAirportIata = 'BOS'
    bind(f)
    const airportReadyAt = new Date(Date.parse(f.flight.segments.at(-1)!.arrivalAt) + f.input.selection!.facts.arrivalProcessingMinutes * 60000).toISOString()
    const data = {
      flightOfferId: f.flight.id, flightFingerprint: f.flight.fingerprint, arrivalAirportIata: 'BOS', destinationCityId: f.destination.id, airportReadyAt, kind,
      legs: [{ id: 'onward-bus-leg', mode: kind === 'drive' ? 'drive' as const : 'bus' as const, from: { name: airport.name, latitude: airport.latitude, longitude: airport.longitude }, to: { name: f.destination.name, latitude: f.destination.latitude, longitude: f.destination.longitude }, startAt: airportReadyAt, endAt: new Date(Date.parse(airportReadyAt) + 180 * 60000).toISOString(), departureTimeZone: airport.timeZone, arrivalTimeZone: f.destination.timeZone, operator: kind === 'drive' ? null : 'Concord Coach', service: kind === 'drive' ? null : 'Portland', vehicleId: kind === 'drive' ? null : 'coach-1', assumptions: ['Schedule estimate; confirm tickets.'] }],
      costs: [{ label: 'Onward transit fare', cents: kind === 'drive' ? null : 3500, currency: 'USD', includedInOtherCharge: false }], evidence: [{ ...f.flight.evidence[0], provider: 'Google Maps Routes API', type: 'schedule' as const }], confirmations: ['Check onward transport.'],
    }
    const offer = { ...data, id: onwardOfferId(data) }
    f.input.onwardFlight = { flightOfferId: f.flight.id, flightFingerprint: f.flight.fingerprint, arrivalProcessingMinutes: f.input.selection!.facts.arrivalProcessingMinutes }
    f.input.selection!.onwardOfferId = offer.id
    return { ...f, onwardOffers: [offer] }
  }
  it('composes SAN to BOS plus scheduled onward bus to the original Portland destination', async () => {
    const f = await example(), p = await implementation(), j = p!.composeTravelJourney(f.input, f.flight, null, f)
    expect(j.selectable).toBe(true)
    expect(j.destinationCityId).toBe(f.destination.id)
    expect(j.legs.at(-1)!.kind).toBe('bus')
    expect(j.boardings).toBe(3)
    expect(j.transfers).toBe(2)
    expect(j.legs.at(-1)!.to.name).toBe('Portland')
    expect(j.finalArrivalAt).toBe(f.onwardOffers[0].legs[0].endAt)
    expect(j.costs.at(-1)!.cents).toBe(3500)
    expect(j.costs.some(c => c.label === 'Destination airport to city transfer')).toBe(false)
    expect(TravelJourneySchema.safeParse(j).success).toBe(true)
  })
  it('rejects a missing or changed onward selection instead of inventing destination access', async () => {
    const f = await example(), p = await implementation()
    expect(p!.assessTravelSelection(f.input, { ...f, onwardOffers: [] }).selectionIssue).toBe('onward_missing')
    f.onwardOffers[0].flightFingerprint = 'changed'
    expect(p!.assessTravelSelection(f.input, f).selectionIssue).toBe('onward_changed')
  })
  it('requires the arrival-processing allowance used by the ground search', async () => {
    const f = await example(), p = await implementation()
    f.input.selection!.facts.arrivalProcessingMinutes += 15
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(false)
  })
  it('enforces the deadline at Portland after the complete ground journey', async () => {
    const f = await example(), p = await implementation()
    f.input.trip.deadlineAt = new Date(Date.parse(f.onwardOffers[0].airportReadyAt) + 60000).toISOString()
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).violations.join(' ')).toMatch(/destination deadline/)
  })
  it('permits scoped onward driving only after vehicle confirmation and keeps its costs unknown', async () => {
    const f = await example('drive'), p = await implementation()
    expect(f.input.trip.drivingAllowed).toBe(false)
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(false)
    f.input.selection!.onwardVehicleConfirmed = true
    const journey = p!.composeTravelJourney(f.input, f.flight, null, f)
    expect(journey.selectable).toBe(true)
    expect(journey.priceComplete).toBe(false)
    f.input.trip.budgetMode = 'hard'
    f.input.trip.budgetCents = 100000
    expect(p!.composeTravelJourney(f.input, f.flight, null, f).selectable).toBe(false)
  })
  it('keeps route identity stable when observation freshness changes', async () => {
    const f = await example(), { onwardOfferId } = await import('@domain/travel-contracts'), offer = structuredClone(f.onwardOffers[0])
    offer.evidence[0].checkedAt = new Date(Date.parse(offer.evidence[0].checkedAt) + 1000).toISOString()
    expect(onwardOfferId(offer)).toBe(offer.id)
    offer.legs[0].id = 'provider-reordered-option-17'
    expect(onwardOfferId(offer)).toBe(offer.id)
    offer.legs[0].endAt = new Date(Date.parse(offer.legs[0].endAt) + 1000).toISOString()
    expect(onwardOfferId(offer)).not.toBe(offer.id)
  })
})
