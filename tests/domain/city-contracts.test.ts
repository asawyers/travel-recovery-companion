import { describe, expect, it } from 'vitest'

const contracts = () => import('@domain/city-contracts').catch(() => null)
const fixture = async () => (await import('@domain/city-fixtures')).cityFixture()

describe('national city contracts', () => {
  it('exports strict version two city contracts', async () => {
    const c = await contracts()
    expect(c, 'city contracts must exist').not.toBeNull()
    const f = await fixture()
    expect(c!.CityTripRequestSchema.parse(f.request)).toEqual(f.request)
    expect(c!.CitySchema.parse(f.origin)).toEqual(f.origin)
    for (const patch of [{ version: 1 }, { originCityId: 'Boston' }, { destinationCityId: f.origin.id }, { readyAt: '2026-11-18T08:00' }, { budgetCents: -1 }, { airport: 'BOS' }, { confirmedOptions: Array(13).fill(f.candidates[0]) }]) {
      expect(c!.CityTripRequestSchema.safeParse({ ...f.request, ...patch }).success).toBe(false)
    }
    expect(c!.CitySchema.safeParse({ ...f.origin, timeZone: 'America/Unknown' }).success).toBe(false)
    expect(c!.CitySchema.safeParse({ ...f.origin, timeZone: '+05:00' }).success).toBe(false)
  })

  it('requires paired bounded coordinates, explicit costs and bounded legs', async () => {
    const c = await contracts(); expect(c).not.toBeNull()
    const f = await fixture(), candidate = f.candidates[0]
    expect(c!.CityPlaceSchema.safeParse({ name: 'Traveler location', latitude: null, longitude: null }).success).toBe(true)
    for (const place of [{ name: 'A', latitude: 12, longitude: null }, { name: 'A', latitude: 91, longitude: 0 }]) expect(c!.CityPlaceSchema.safeParse(place).success).toBe(false)
    for (const patch of [{ costs: [] }, { legs: [] }, { legs: Array(97).fill(candidate.legs[0]) }, { rawProvider: {} }]) expect(c!.CityCandidateSchema.safeParse({ ...candidate, ...patch }).success).toBe(false)
    expect(c!.CityCandidateSchema.safeParse({ ...candidate, costs: [{ label: 'Unknown fare', cents: null, currency: 'USD', includedInOtherCharge: false }] }).success).toBe(true)
  })

  it('enforces source mode and original evidence expiry throughout facts and snapshots', async () => {
    const c = await contracts(); expect(c).not.toBeNull()
    const f = await fixture()
    expect(c!.CityTripRequestSchema.safeParse({ ...f.request, mode: 'real' }).success).toBe(false)
    const facts = { candidates: f.candidates, checkedAt: f.now, expiresAt: new Date(Date.parse(f.now) + 300000).toISOString(), adapterRevision: 'public-city-v1' }
    expect(c!.CityFactsSchema.safeParse(facts).success).toBe(true)
    expect(c!.CityFactsSchema.safeParse({ ...facts, expiresAt: new Date(Date.parse(f.now) + 300001).toISOString() }).success).toBe(false)
    f.candidates[0].evidence[0].expiresAt = new Date(Date.parse(f.now) + 60000).toISOString()
    expect(c!.CityFactsSchema.safeParse(facts).success).toBe(false)
    f.candidates[0].evidence[0].checkedAt = new Date(Date.parse(f.now) + 1000).toISOString()
    expect(c!.CityFactsSchema.safeParse({ ...facts, expiresAt: f.now }).success).toBe(false)
  })

  it('keeps clarification patches empty and conversation history bounded', async () => {
    const c = await contracts(); expect(c).not.toBeNull()
    const f = await fixture()
    const clarification = { field: 'origin', reason: 'ambiguous' }
    const assistance = { status: 'limited', summary: 'Please choose an origin.', appliedPreferences: {}, selectedPlanId: null, activity: [], clarification }
    expect(c!.CityAssistanceSchema.safeParse(assistance).success).toBe(true)
    for (const patch of [{ status: 'completed' }, { appliedPreferences: { drivingAllowed: false } }, { selectedPlanId: 'any' }]) expect(c!.CityAssistanceSchema.safeParse({ ...assistance, ...patch }).success).toBe(false)
    expect(c!.cityClarificationQuestion(clarification)).not.toMatch(/Boston|Portland/)
    expect(c!.cityClarificationQuestion({ field: 'hotel', reason: 'unsupported' })).toMatch(/unavailable/i)
    const input = { request: f.request, investigate: false, conversation: { turnId: 'turn', baseRevision: 0, history: [] } }
    expect(c!.CityRecoveryInputSchema.safeParse(input).success).toBe(true)
    expect(c!.CityRecoveryInputSchema.safeParse({ ...input, conversation: { ...input.conversation, history: Array(9).fill({ role: 'user', content: 'x'.repeat(1000) }) } }).success).toBe(false)
  })

  it('binds response facts, selections and snapshot evidence to the exact request', async () => {
    const c = await contracts(); expect(c).not.toBeNull()
    const { planCityRecovery } = await import('@domain/city-planner')
    const f = await fixture(), result = planCityRecovery(f.request, f.candidates, f)
    const facts = { candidates: f.candidates, checkedAt: f.now, expiresAt: new Date(Date.parse(f.now) + 300000).toISOString(), adapterRevision: 'public-city-v1' }
    const response = { version: 2, result, facts, conversation: { turnId: 'turn', baseRevision: 3 } }
    expect(c!.CityRecoveryResponseSchema.parse(response).conversation).toEqual(response.conversation)
    expect(c!.CityRecoveryResponseSchema.safeParse({ ...response, facts: { ...facts, candidates: [] } }).success).toBe(false)
    const snapshot = { schemaVersion: 2, request: f.request, plan: result.plans[0], origin: f.origin, destination: f.destination, generatedAt: f.now, selectedAt: f.now }
    expect(c!.CitySavedSelectionSchema.safeParse(snapshot).success).toBe(true)
    for (const location of ['plan', 'request'] as const) {
      const dirty = structuredClone(snapshot)
      const evidence = location === 'plan' ? dirty.plan.evidence[0] : dirty.request.confirmedOptions[0].evidence[0]
      evidence.provider = 'Google Maps Routes API'
      expect(c!.CitySavedSelectionSchema.safeParse(dirty).success).toBe(false)
    }
    const dirty = structuredClone(snapshot)
    dirty.plan.evidence[0].sourceUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes'
    expect(c!.CitySavedSelectionSchema.safeParse(dirty).success).toBe(false)
    expect(c!.CitySavedSelectionSchema.safeParse({ ...snapshot, selectedAt: '2026-11-18T08:00' }).success).toBe(false)
  })
})

it('rejects a saved selection whose evidence was already expired when selected', async () => {
  const { CitySavedSelectionSchema } = await import('@domain/city-contracts')
  const { planCityRecovery } = await import('@domain/city-planner')
  const f = await fixture()
  f.candidates[0].evidence[0].expiresAt = new Date(Date.parse(f.now) + 60000).toISOString()
  const result = planCityRecovery(f.request, f.candidates, f)
  const saved = { schemaVersion: 2, request: result.request, plan: result.plans[0], origin: f.origin, destination: f.destination,
    generatedAt: f.now, selectedAt: f.candidates[0].evidence[0].expiresAt }
  expect(CitySavedSelectionSchema.safeParse(saved).success).toBe(false)
})
