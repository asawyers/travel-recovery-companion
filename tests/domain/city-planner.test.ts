import { describe, expect, it } from 'vitest'

const implementation = () => import('@domain/city-planner').catch(() => null)
const fixture = async () => (await import('@domain/city-fixtures')).cityFixture()
const iso = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60000).toISOString()

describe('pure national city planner', () => {
  it('assesses connected multimodal journeys without mutating inputs', async () => {
    const p = await implementation(); expect(p, 'city planner must exist').not.toBeNull()
    const f = await fixture(), before = JSON.stringify(f)
    const result = p!.planCityRecovery(f.request, f.candidates, f)
    expect(result.version).toBe(2)
    expect(result.plans.length).toBeGreaterThan(0)
    expect(result.plans[0].durationMinutes).toBe((Date.parse(result.plans[0].finalArrivalAt) - Date.parse(f.request.readyAt)) / 60000)
    expect(result.warnings.join(' ')).toMatch(/7.day|seven.day/i)
    expect(JSON.stringify(f)).toBe(before)
  })

  it('uses instants across time zones and the DST fallback', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const f = await fixture(), candidate = f.candidates[0]
    f.request.readyAt = '2026-11-01T01:30:00-04:00'
    f.now = '2026-11-01T01:00:00-04:00'
    candidate.evidence[0].checkedAt = f.now
    candidate.evidence[0].serviceDate = '2026-11-01'
    candidate.legs = [{ ...candidate.legs[0], from: candidate.legs[0].from, to: candidate.legs.at(-1)!.to, startAt: f.request.readyAt, endAt: '2026-11-01T01:30:00-05:00', mode: 'rail', vehicleId: 'dst-train' }]
    const result = p!.planCityRecovery(f.request, [candidate], f)
    expect(result.plans[0].durationMinutes).toBe(60)
    candidate.legs[0].endAt = '2026-11-01T00:45:00-07:00'
    candidate.legs[0].arrivalTimeZone = 'America/Los_Angeles'
    expect(p!.planCityRecovery(f.request, [candidate], f).plans[0].durationMinutes).toBe(135)
  })

  it('includes the exact seven-day complete journey boundary and rejects a later final transfer', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const f = await fixture(), candidate = f.candidates[0]
    candidate.legs.at(-1)!.endAt = iso(f.request.readyAt, 10080)
    expect(p!.planCityRecovery(f.request, [candidate], f).plans).toHaveLength(1)
    candidate.legs.at(-1)!.endAt = iso(f.request.readyAt, 10081)
    const result = p!.planCityRecovery(f.request, [candidate], f)
    expect(result.plans).toHaveLength(0)
    expect(result.rejected[0].violations.join(' ')).toMatch(/coverage|horizon/i)
    expect(f.request.deadlineAt).toBeNull()
  })

  it('rejects wrong-city IDs, remote endpoints, gaps and time overlaps explicitly', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const mutations = [
      (c: any) => { c.destinationCityId = 'geonames:999999' },
      (c: any) => { c.legs.at(-1).to.latitude = 0; c.legs.at(-1).to.longitude = 0 },
      (c: any) => { c.legs[1].from = { name: 'Unconnected station', latitude: null, longitude: null } },
      (c: any) => { c.legs[1].startAt = iso(c.legs[0].endAt, -1) },
      (c: any) => { c.legs[1].startAt = iso(c.legs[0].endAt, 1) },
    ]
    for (const mutate of mutations) {
      const f = await fixture(), candidate = f.candidates[0]; mutate(candidate)
      const result = p!.planCityRecovery(f.request, [candidate], f)
      expect(result.plans).toHaveLength(0)
      expect(result.rejected[0].violations.length).toBeGreaterThan(0)
    }
    const f = await fixture()
    expect(() => p!.planCityRecovery(f.request, f.candidates, { ...f, origin: f.destination })).toThrow(/origin|city/i)
  })

  it('counts actual boardings while consecutive legs on the same vehicle are through service', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const f = await fixture(), c = f.candidates[0], first = c.legs[0].from, last = c.legs.at(-1)!.to
    c.legs = Array.from({ length: 4 }, (_, i) => ({ ...c.legs[0], id: `leg-${i}`, mode: 'rail' as const, vehicleId: ['A', 'A', 'B', 'A'][i], from: i === 0 ? first : last, to: last, startAt: iso(f.request.readyAt, i * 10), endAt: iso(f.request.readyAt, (i + 1) * 10) }))
    expect(p!.planCityRecovery(f.request, [c], f).plans[0].transfers).toBe(2)
  })

  it('retains the original earliest expiry and rejects expired or future evidence', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const f = await fixture(), c = f.candidates[0]
    c.evidence[0].expiresAt = iso(f.now, 1)
    c.evidence.push({ ...c.evidence[0], expiresAt: iso(f.now, 3) })
    expect(p!.planCityRecovery(f.request, [c], f).plans[0].evidenceExpiresAt).toBe(c.evidence[0].expiresAt)
    c.evidence[0].expiresAt = f.now
    expect(p!.planCityRecovery(f.request, [c], f).rejected[0].violations.join(' ')).toMatch(/expired/i)
    c.evidence[0].expiresAt = null; c.evidence[0].checkedAt = iso(f.now, 1)
    expect(p!.planCityRecovery(f.request, [c], f).plans).toHaveLength(0)
  })

  it('keeps unknown and non-USD prices incomplete, excludes them under hard budgets, and ranks complete cheapest first', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const f = await fixture(), unknown = structuredClone(f.candidates[0]), priced = structuredClone(f.candidates[0])
    unknown.id = 'unknown'; unknown.costs[0].cents = null
    priced.id = 'priced'; priced.costs = [{ label: 'Route fare', cents: 5000, currency: 'USD', includedInOtherCharge: false }, { label: 'Included transfer', cents: 1000, currency: 'USD', includedInOtherCharge: true }]
    f.request.priority = 'cheapest'
    expect(p!.planCityRecovery(f.request, [unknown, priced], f).plans[0]).toMatchObject({ id: 'priced', knownCostCents: 5000, priceComplete: true })
    f.request.budgetMode = 'hard'; f.request.budgetCents = 5000
    expect(p!.planCityRecovery(f.request, [unknown, priced], f).plans.map(c => c.id)).toEqual(['priced'])
    unknown.costs[0].cents = 1; unknown.costs[0].currency = 'EUR'
    expect(p!.planCityRecovery(f.request, [unknown], f).rejected[0].priceComplete).toBe(false)
    f.request.budgetCents = 4999
    expect(p!.planCityRecovery(f.request, [priced], f).plans).toHaveLength(0)
  })

  it('applies hard cross-zone deadlines and driving permission including embedded drive legs', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const f = await fixture(), c = f.candidates[0]
    f.request.deadlineAt = iso(c.legs.at(-1)!.endAt, -1)
    expect(p!.planCityRecovery(f.request, [c], f).plans).toHaveLength(0)
    f.request.deadlineAt = c.legs.at(-1)!.endAt
    expect(p!.planCityRecovery(f.request, [c], f).plans).toHaveLength(1)
    f.request.drivingAllowed = false; c.legs[0].mode = 'drive'
    expect(p!.planCityRecovery(f.request, [c], f).plans).toHaveLength(0)
  })

  it('keeps long driving informational and short driving subject to confirmation', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const f = await fixture(), c = f.candidates[0]
    c.kind = 'driving_estimate'
    c.legs = [{ ...c.legs[0], mode: 'drive', from: c.legs[0].from, to: c.legs.at(-1)!.to, startAt: f.request.readyAt, endAt: iso(f.request.readyAt, 480), vehicleId: null }]
    expect(p!.planCityRecovery(f.request, [c], f).plans[0]).toMatchObject({ feasibility: 'requires_confirmation', selectable: true })
    c.legs[0].endAt = iso(f.request.readyAt, 481)
    const result = p!.planCityRecovery(f.request, [c], f)
    expect(result.plans).toHaveLength(0)
    expect(result.rejected[0]).toMatchObject({ feasibility: 'requires_confirmation', selectable: false })
    expect(result.rejected[0].warnings.join(' ')).toMatch(/rest|vehicle/i)
  })

  it('allows an initial wait only at the supplied origin and labels traveler locations honestly', async () => {
    const p = await implementation(); expect(p).not.toBeNull()
    const f = await fixture(), c = f.candidates[0]
    c.legs.forEach(l => { l.startAt = iso(l.startAt, 10); l.endAt = iso(l.endAt, 10) })
    let result = p!.planCityRecovery(f.request, [c], f)
    expect(result.plans[0].legs[0].mode).toBe('wait')
    c.legs[0].from = { name: f.origin.name, latitude: null, longitude: null }
    c.evidence[0] = { ...c.evidence[0], type: 'traveler_confirmed', environment: 'production' }
    f.request.mode = 'real'
    result = p!.planCityRecovery(f.request, [c], f)
    expect(result.plans[0].warnings.join(' ')).toMatch(/traveler|location/i)
    expect(result.plans[0].feasibility).toBe('requires_confirmation')
    c.evidence[0].type = 'live'
    expect(p!.planCityRecovery(f.request, [c], f).plans).toHaveLength(0)
  })
})

it('does not mistake only included charges for an explicitly free complete fare', async () => {
  const { planCityRecovery } = await import('@domain/city-planner')
  const f = await fixture(), c = f.candidates[0]
  c.costs = [{ label: 'Included transfer, main fare unknown', cents: 1000, currency: 'USD', includedInOtherCharge: true }]
  expect(planCityRecovery(f.request, [c], f).plans[0]).toMatchObject({ knownCostCents: 0, priceComplete: false })
  f.request.budgetMode = 'hard'; f.request.budgetCents = 0
  expect(planCityRecovery(f.request, [c], f).plans).toHaveLength(0)
})

it('does not let a wait move a traveler to another nearby place', async () => {
  const { planCityRecovery } = await import('@domain/city-planner')
  const f = await fixture(), c = f.candidates[0]
  c.legs[1].to = { ...c.legs[1].to, latitude: c.legs[1].to.latitude! + 0.001 }
  c.legs[2].from = c.legs[1].to
  expect(planCityRecovery(f.request, [c], f).plans).toHaveLength(0)
})

it('covers all named synthetic examples with location-specific departure and arrival zones', async () => {
  const { planCityRecovery } = await import('@domain/city-planner')
  const { namedCityFixtures } = await import('@domain/city-fixtures')
  for (const make of Object.values(namedCityFixtures)) {
    const f = make(), last = f.candidates[0].legs.at(-1)!
    expect(last.departureTimeZone).toBe(f.destination.timeZone)
    expect(last.arrivalTimeZone).toBe(f.destination.timeZone)
    expect(planCityRecovery(f.request, f.candidates, f).plans).toHaveLength(1)
  }
})

it('does not bridge remote known locations with a same-name label-only wait', async () => {
  const { planCityRecovery } = await import('@domain/city-planner')
  const f = await fixture(), c = f.candidates[0]
  const atOrigin = { name: 'Central Station', latitude: f.origin.latitude, longitude: f.origin.longitude }
  const atDestination = { name: 'Central Station', latitude: f.destination.latitude, longitude: f.destination.longitude }
  const labelOnly = { name: 'Central Station', latitude: null, longitude: null }
  c.evidence[0] = { ...c.evidence[0], type: 'traveler_confirmed', environment: 'production' }
  f.request.mode = 'real'
  c.legs[0].to = atOrigin
  c.legs[1].from = labelOnly; c.legs[1].to = labelOnly
  c.legs[2].from = atDestination
  const result = planCityRecovery(f.request, [c], f)
  expect(result.plans).toHaveLength(0)
  expect(result.rejected[0].violations.join(' ')).toMatch(/disconnected|transfer/i)

  // Fully traveler-labeled journeys remain supported with confirmation warnings.
  c.legs[0].from = { name: f.origin.name, latitude: null, longitude: null }
  c.legs[0].to = labelOnly
  c.legs[2].from = labelOnly
  c.legs[2].to = { name: 'Destination Station', latitude: null, longitude: null }
  c.legs[3].from = c.legs[2].to
  c.legs[3].to = { name: f.destination.name, latitude: null, longitude: null }
  expect(planCityRecovery(f.request, [c], f).plans[0]).toMatchObject({ selectable: true, feasibility: 'requires_confirmation' })
})

it('compares a Los Angeles local deadline with a New York departure by exact instant', async () => {
  const { planCityRecovery } = await import('@domain/city-planner')
  const { namedCityFixtures } = await import('@domain/city-fixtures')
  const f = namedCityFixtures.newYork()
  const arrival = f.candidates[0].legs.at(-1)!.endAt
  expect(f.origin.timeZone).toBe('America/New_York')
  expect(f.destination.timeZone).toBe('America/Los_Angeles')
  f.request.deadlineAt = '2026-11-20T07:15:00-08:00'
  expect(Date.parse(f.request.deadlineAt)).toBe(Date.parse(arrival))
  const exact = planCityRecovery(f.request, f.candidates, f)
  expect(exact.plans).toHaveLength(1)
  expect(exact.plans[0].finalArrivalAt).toBe(arrival)
  expect(exact.request.readyAt).toBe('2026-11-18T08:00:00-05:00')
  expect(exact.request.deadlineAt).toBe('2026-11-20T07:15:00-08:00')
  f.request.deadlineAt = '2026-11-20T07:14:00-08:00'
  const early = planCityRecovery(f.request, f.candidates, f)
  expect(early.plans).toHaveLength(0)
  expect(early.rejected[0].violations.join(' ')).toMatch(/hard destination deadline/i)
  expect(early.request.deadlineAt).toBe('2026-11-20T07:14:00-08:00')
})
