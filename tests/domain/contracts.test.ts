import { describe, expect, it } from 'vitest'
import { CarOptionSchema, CostLineSchema, HotelOptionSchema, RecoveryPlanSchema, RecoveryResultSchema, PlanningTripRequestSchema, SourceEvidenceSchema, TripRequestSchema } from '@domain/schemas'

const at = '2026-11-18T08:00:00-05:00'
const evidence = () => ({ type: 'synthetic', provider: 'Fictional schedule', sourceUrl: null, checkedAt: at, serviceDate: '2026-11-18', providerUpdatedAt: null, expiresAt: null, environment: 'synthetic', warnings: ['Fictional example'] })
const transfer = () => ({ from: 'BOS', to: 'North Station', minutes: 30, costCents: null, kind: 'transfer', vehicleId: null, evidence: [evidence()], assumptions: [] })
const transit = () => ({ kind: 'train', id: 'train', title: 'Fictional train', departureAt: '2026-11-18T10:00:00-05:00', arrivalAt: '2026-11-18T12:30:00-05:00', boardingMinutes: 15, fareCents: 4500, access: transfer(), finalTransfer: { ...transfer(), from: 'Portland station', to: 'Portland, ME' }, evidence: [evidence()], confirmations: [] })
const hotel = () => ({ id: 'hotel', name: 'Fictional hotel', address: 'Fictional Boston address', room: 'Example queen', board: 'No meals', checkin: '2026-11-18', checkout: '2026-11-19', timeZone: 'America/New_York', adults: 1, rooms: 1, costs: [{ label: 'Room', cents: null, currency: 'USD', includedInOtherCharge: false }], cancellation: { deadlineAt: '2026-11-18T18:00:00-05:00', penalty: null, text: 'Unknown synthetic cancellation terms' }, lateCheckinConfirmed: false, quoteExpiresAt: null, evidence: [evidence()], handoffId: 'hotel-search' })
const request = () => ({ mode: 'synthetic', airport: 'BOS', destination: 'Portland, ME', timeZone: 'America/New_York', arrivalAt: at, arrivalBasis: 'scheduled_gate', flight: null, originalDepartureAt: '2026-11-18T09:15:00-05:00', originalAccessMinutes: 30, originalBoardingMinutes: 15, airportExitMinutes: 45, deadlineAt: '2026-11-18T14:00:00-05:00', budgetCents: 15000, budgetMode: 'soft', drivingAllowed: true, overnightAllowed: false, priority: 'earliest', confirmedOptions: [transit()], stay: null })
const plan = () => ({ id: 'plan', title: 'Fictional plan', legs: [], finalArrivalAt: '2026-11-19T10:40:00-05:00', hotel: hotel(), durationMinutes: 760, knownCostCents: 0, priceComplete: false, transfers: 2, feasibility: 'requires_confirmation', violations: [], warnings: [], selectable: true, evidenceExpiresAt: null })

describe('strict bounded domain contracts', () => {
  it('accepts a bounded one-adult USD synthetic request', () => {
    expect(TripRequestSchema.parse(request())).toEqual(request())
  })
  it('rejects unsupported coverage with an actionable coverage error', () => {
    for (const destination of ['Portland, OR', 'Portland', 'Boston, MA']) {
      const result = TripRequestSchema.safeParse({ ...request(), destination })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.message).toContain('coverage')
    }
    expect(TripRequestSchema.safeParse({ ...request(), destination: 'Public library, Portland, Maine' }).success).toBe(true)
  })
  it('rejects missing modes, offsets, invalid dates, bounds, and unknown fields', () => {
    for (const patch of [ { mode: undefined }, { arrivalAt: '2026-11-18T08:00:00' }, { deadlineAt: at }, { airport: 'JFK' }, { timeZone: 'UTC' }, { budgetCents: -1 }, { budgetCents: 1.5 }, { originalAccessMinutes: Infinity }, { airportExitMinutes: -1 }, { confirmedOptions: Array(13).fill(transit()) }, { stay: { checkin: '2026-02-30', checkout: '2026-03-01', adults: 1, rooms: 1, guestNationality: 'US' } }, { unexpected: true } ]) {
      expect(TripRequestSchema.safeParse({ ...request(), ...patch }).success).toBe(false)
    }
    expect(TripRequestSchema.safeParse({ ...request(), stay: { checkin: '2026-11-18', checkout: '2026-11-19', adults: 2, rooms: 1, guestNationality: 'US' } }).success).toBe(false)
    expect(TripRequestSchema.safeParse({ ...request(), destination: 'x'.repeat(1000) }).success).toBe(false)
  })
  it('rejects malformed provenance and negative money but preserves null versus zero', () => {
    for (const cents of [-1, 0.5, Infinity]) expect(CostLineSchema.safeParse({ label: 'Fare', cents, currency: 'USD', includedInOtherCharge: false }).success).toBe(false)
    for (const cents of [null, 0]) expect(CostLineSchema.parse({ label: 'Fare', cents, currency: 'USD', includedInOtherCharge: false }).cents).toBe(cents)
    for (const patch of [{ sourceUrl: 'javascript:alert(1)' }, { checkedAt: '2026-11-18T08:00' }, { serviceDate: '2026-02-30' }, { type: 'live' }, { type: 'synthetic', environment: 'production' }]) {
      expect(SourceEvidenceSchema.safeParse({ ...evidence(), ...patch }).success).toBe(false)
    }
  })
  it('traverses nested evidence to separate real requests from synthetic and sandbox facts', () => {
    const value = request()
    value.mode = 'real'
    expect(TripRequestSchema.safeParse(value).success).toBe(false)
    const production = { ...evidence(), type: 'traveler_confirmed', environment: 'production' }
    const clean = JSON.parse(JSON.stringify(value))
    clean.confirmedOptions[0].evidence = [production]
    clean.confirmedOptions[0].access.evidence = [production]
    clean.confirmedOptions[0].finalTransfer.evidence = [production]
    expect(TripRequestSchema.safeParse(clean).success).toBe(true)
    clean.confirmedOptions[0].finalTransfer.evidence[0].environment = 'sandbox'
    expect(TripRequestSchema.safeParse(clean).success).toBe(false)
    const overnight = { kind: 'overnight', id: 'night', title: 'Fictional overnight', hotel: hotel(), hotelAccess: transfer(), checkinMinutes: 15, leaveHotelAt: '2026-11-19T07:20:00-05:00', nextDayTransit: transit(), confirmations: [] }
    clean.confirmedOptions = [overnight]
    expect(TripRequestSchema.safeParse(clean).success).toBe(false)
  })
  it('requires a nullable hotel and preserves all nested hotel data through strict parsing and JSON', () => {
    const value = plan()
    expect(RecoveryPlanSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value)
    const { hotel: _hotel, ...missing } = value
    expect(RecoveryPlanSchema.safeParse(missing).success).toBe(false)
    expect(RecoveryPlanSchema.safeParse({ ...value, hotel: null }).success).toBe(true)
    for (const patch of [{ checkin: '2026-02-30' }, { checkout: '2026-11-18' }, { rooms: 2 }, { cancellation: { deadlineAt: null, penalty: null, text: 'Terms', surprise: true } }]) {
      expect(HotelOptionSchema.safeParse({ ...hotel(), ...patch }).success).toBe(false)
    }
  })
  it('returns validation errors for malformed nested times without throwing', () => {
    for (const patch of [{ departureAt: '2026-02-30T10:00:00-05:00' }, { arrivalAt: '2026-11-18T12:30' }, { fareCents: undefined }]) {
      expect(TripRequestSchema.safeParse({ ...request(), confirmedOptions: [{ ...transit(), ...patch }] }).success).toBe(false)
    }
    expect(HotelOptionSchema.safeParse({ ...hotel(), cancellation: { deadlineAt: '2026-02-30T18:00:00-05:00', penalty: null, text: 'Unknown terms' } }).success).toBe(false)
    expect(SourceEvidenceSchema.safeParse({ ...evidence(), expiresAt: '2026-11-18T10:00' }).success).toBe(false)
    const leg = { id: 'leg', kind: 'train', from: 'North Station', to: 'Portland station', startAt: at, endAt: '2026-02-30T12:30:00-05:00', vehicleId: null, costs: [], evidence: [evidence()], assumptions: [], handoffId: null }
    expect(RecoveryPlanSchema.safeParse({ ...plan(), legs: [leg] }).success).toBe(false)
  })
  it('rejects synthetic plan evidence smuggled into a real recovery result', () => {
    const real = { ...request(), mode: 'real', confirmedOptions: [] }
    const result = { request: real, generatedAt: at, originalConnection: { readyAt: at, requiredReadyAt: at, marginMinutes: -15, shortfallMinutes: 15, missed: true }, plans: [plan()], rejected: [], warnings: [], activity: [] }
    expect(RecoveryResultSchema.safeParse(result).success).toBe(false)
  })
})

describe('explicit fictional scenario fixtures', () => {
  it('provides fresh valid daytime examples with exact documented arithmetic', async () => {
    const { daytimeFixture } = await import('@domain/fixtures')
    const { sumCosts, addMinutes, minutesBetween } = await import('@domain/time')
    const fixture = daytimeFixture()
    expect(fixture.request).not.toBeNull()
    const trip = TripRequestSchema.parse(fixture.request)
    expect(fixture.candidates).toBe(fixture.request.confirmedOptions)
    expect(trip.mode).toBe('synthetic')
    expect(trip.destination).toBe('Portland, ME')
    expect(trip.budgetCents).toBe(15000)
    expect(trip.deadlineAt).toBe('2026-11-18T14:00:00-05:00')
    const ready = addMinutes(trip.arrivalAt, trip.airportExitMinutes + trip.originalAccessMinutes)
    const required = addMinutes(trip.originalDepartureAt, -trip.originalBoardingMinutes)
    expect(minutesBetween(required, ready)).toBe(15)
    for (const [id, arrival, total, duration] of [['train', '12:50', 7200, 290], ['bus', '12:10', 4700, 250], ['car', '11:45', 14500, 225]] as const) {
      const option = trip.confirmedOptions.find(value => value.id === id)!
      if (option.kind === 'overnight') throw new Error('Daytime candidate must be direct')
      expect(option.finalTransfer.to).toBe(trip.destination)
      let end: string
      let costs
      if (option.kind === 'car') {
        end = addMinutes(trip.arrivalAt, trip.airportExitMinutes + option.access.minutes + option.pickupMinutes + option.driveMinutes + option.returnMinutes + option.finalTransfer.minutes)
        costs = [...option.costs, { label: 'Access', cents: option.access.costCents, currency: 'USD', includedInOtherCharge: false }, { label: 'Final', cents: option.finalTransfer.costCents, currency: 'USD', includedInOtherCharge: false }]
        expect(option.pickupHoursConfirmed).toBe(false)
      } else {
        end = addMinutes(option.arrivalAt, option.finalTransfer.minutes)
        costs = [option.access.costCents, option.fareCents, option.finalTransfer.costCents].map(cents => ({ label: 'Segment', cents, currency: 'USD', includedInOtherCharge: false }))
        if (id === 'train') expect(option.access.to).toBe('North Station')
      }
      expect(end).toBe(`2026-11-18T${arrival}:00-05:00`)
      expect(minutesBetween(trip.arrivalAt, end)).toBe(duration)
      expect(sumCosts(costs)).toMatchObject({ knownCostCents: total, priceComplete: true })
    }
    fixture.request.confirmedOptions.length = 0
    expect(daytimeFixture().candidates).toHaveLength(3)
  })
  it('encodes the overnight hotel and immediate-car differences exactly', async () => {
    const { overnightFixture } = await import('@domain/fixtures')
    const { addMinutes, minutesBetween, sumCosts } = await import('@domain/time')
    const fixture = overnightFixture()
    expect(fixture.request).not.toBeNull()
    const trip = TripRequestSchema.parse(fixture.request)
    expect(fixture.candidates).toBe(fixture.request.confirmedOptions)
    const night = trip.confirmedOptions.find(option => option.kind === 'overnight')!
    const car = trip.confirmedOptions.find(option => option.kind === 'car')!
    expect(night.kind).toBe('overnight')
    if (night.kind !== 'overnight' || car.kind !== 'car') throw new Error('Missing overnight or car')
    expect(night.hotel.lateCheckinConfirmed).toBe(false)
    expect(night.hotel.checkin).toBe('2026-11-18')
    expect(night.hotel.checkout).toBe('2026-11-19')
    expect(night.hotelAccess.to).toBe(night.hotel.name)
    expect(night.nextDayTransit.access.from).toBe(night.hotel.name)
    expect(night.leaveHotelAt).toBe('2026-11-19T07:20:00-05:00')
    expect(addMinutes(night.leaveHotelAt, night.nextDayTransit.access.minutes)).toBe('2026-11-19T07:45:00-05:00')
    expect(addMinutes(night.nextDayTransit.arrivalAt, night.nextDayTransit.finalTransfer.minutes)).toBe('2026-11-19T10:40:00-05:00')
    const costs = [...night.hotel.costs, ...[night.hotelAccess.costCents, night.nextDayTransit.access.costCents, night.nextDayTransit.fareCents, night.nextDayTransit.finalTransfer.costCents].map(cents => ({ label: 'Segment', cents, currency: 'USD', includedInOtherCharge: false }))]
    expect(sumCosts(costs).knownCostCents).toBe(20200)
    expect(sumCosts(car.costs).knownCostCents).toBe(24000)
    expect(minutesBetween(trip.arrivalAt, '2026-11-19T10:40:00-05:00')).toBe(760)
    expect(minutesBetween('2026-11-19T01:45:00-05:00', '2026-11-19T10:40:00-05:00')).toBe(535)
    expect(car.pickupHoursConfirmed && car.returnLocationConfirmed).toBe(true)
    expect(trip.stay).toMatchObject({ adults: 1, rooms: 1, guestNationality: 'US' })
    expect(fixture.now).toBe('2026-11-18T07:55:00-05:00')
    fixture.request.confirmedOptions.length = 0
    expect(overnightFixture().candidates).toHaveLength(2)
  })
})


describe('explicit car and hotel pricing', () => {
  it('rejects absent price lines while preserving explicit free and unknown prices', async () => {
    const { daytimeFixture, overnightFixture } = await import('@domain/fixtures')
    const car = daytimeFixture().candidates.find(option => option.kind === 'car')!
    expect(CarOptionSchema.safeParse({ ...car, costs: [] }).success).toBe(false)
    expect(HotelOptionSchema.safeParse({ ...hotel(), costs: [] }).success).toBe(false)
    for (const cents of [0, null]) {
      const costs = [{ label: 'Explicit price', cents, currency: 'USD', includedInOtherCharge: false }]
      expect(CarOptionSchema.safeParse({ ...car, costs }).success).toBe(true)
      expect(HotelOptionSchema.safeParse({ ...hotel(), costs }).success).toBe(true)
    }
    const trip = overnightFixture().request
    const night = trip.confirmedOptions.find(option => option.kind === 'overnight')!
    if (night.kind !== 'overnight') throw new Error('Missing overnight candidate')
    expect(TripRequestSchema.safeParse({ ...trip, confirmedOptions: [{ ...night, hotel: { ...night.hotel, costs: [] } }] }).success).toBe(false)
    expect(RecoveryPlanSchema.safeParse({ ...plan(), hotel: { ...hotel(), costs: [] } }).success).toBe(false)
    const wait = { id: 'wait', kind: 'wait', from: 'North Station', to: 'North Station', startAt: at, endAt: at, vehicleId: null, costs: [], evidence: [evidence()], assumptions: [], handoffId: null }
    expect(RecoveryPlanSchema.safeParse({ ...plan(), hotel: null, legs: [wait] }).success).toBe(true)
  })
})


describe('trusted planning request boundary', () => {
  it.each(['2026-11-18T14:00:00-05:00', '2026-11-18T15:00:00-05:00'])('preserves strict input chronology but accepts trusted late arrival %s for planning', arrivalAt => {
    const late = { ...request(), arrivalAt, arrivalBasis: 'actual_gate' }
    expect(TripRequestSchema.safeParse(late).success).toBe(false)
    expect(PlanningTripRequestSchema.safeParse(late).success).toBe(true)
    expect(PlanningTripRequestSchema.safeParse({ ...late, unexpected: true }).success).toBe(false)
    expect(PlanningTripRequestSchema.safeParse({ ...late, mode: 'real' }).success).toBe(false)
  })
})
