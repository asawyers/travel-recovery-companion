import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { overnightTravelFixture, travelFixture } from '@domain/travel-fixtures'
import { composeTravelJourney } from '@domain/travel-planner'
import { travelRequestBinding, TravelRecoveryResponseSchema, type TravelRecoveryResponse } from '@domain/travel-contracts'
import { cityFixture } from '@domain/city-fixtures'
import { planCityRecovery } from '@domain/city-planner'
import { daytimeFixture } from '@domain/fixtures'
import { planRecovery } from '@domain/planner'
import { SAVED_PLAN_KEY, readSavedSelection, writeSavedSelection } from '../../src/features/recovery/savedSelection'
import { citySnapshot, readCityHistory, writeCitySelection } from '../../src/features/city/savedSelection'
const implementation = () => import('../../src/features/travel/savedSelection').catch(() => null)
function response(overnight = false): TravelRecoveryResponse {
  const f = overnight ? overnightTravelFixture() : travelFixture()
  return TravelRecoveryResponseSchema.parse({
    version: 3, request: travelRequestBinding(f.input), origin: f.origin, destination: f.destination,
    generatedAt: f.now, expiresAt: '2026-11-18T06:05:00-08:00',
    flightOffers: [f.flight], hotelOffers: overnight ? [f.hotel] : [], sourceStatuses: [],
    journey: composeTravelJourney(f.input, f.flight, overnight ? f.hotel : null, f), selectionIssue: null, warnings: [],
  })
}
function memory(raw: string | null = null) {
  const calls: string[] = []
  return { calls, getItem: () => raw, setItem: (key: string, value: string) => { calls.push(key); raw = value }, removeItem: () => { raw = null } }
}
function oldSelections() {
  const f = daytimeFixture(), result = planRecovery(f.request, f.candidates, { now: f.now })
  const legacy = { schemaVersion: 1 as const, request: result.request, plan: result.plans[0], generatedAt: f.now, selectedAt: f.now }
  const c = cityFixture(), cityResult = planCityRecovery(c.request, c.candidates, { ...c, now: c.now })
  const city = citySnapshot(cityResult, cityResult.plans[0].id, c.now)
  if (!city.ok) throw Error(city.message)
  return { legacy, city: city.value }
}
describe('version 3 saved complete journeys', () => {
  it.each([false, true])('persists only the selected complete journey and exact source-bound original facts (hotel=%s)', async overnight => {
    const api = await implementation(); expect(api, 'history module exists').not.toBeNull()
    const r = response(overnight), before = JSON.stringify(r)
    const saved = api!.travelSnapshot(r, r.generatedAt)
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw Error(saved.message)
    expect(saved.value).toEqual({ schemaVersion: 3, request: r.request, origin: r.origin, destination: r.destination, generatedAt: r.generatedAt, expiresAt: r.expiresAt, selectedAt: r.generatedAt, selectedFlight: r.flightOffers[0], selectedHotel: r.hotelOffers[0] ?? null, journey: r.journey })
    const storage = memory()
    expect(api!.writeTravelSelection(storage, saved.value)).toEqual(saved)
    expect(api!.readTravelHistory(storage)).toEqual(saved)
    expect(storage.calls).toEqual([SAVED_PLAN_KEY])
    expect(JSON.stringify(r)).toBe(before)
    for (const forbidden of ['flightOffers', 'hotelOffers', 'conversation', 'refinement', 'rawResponse', 'apiKey']) expect(storage.getItem()).not.toContain(`"${forbidden}"`)
  })
  it('restores expired history with zero network and returns an isolated original request on explicit refresh', async () => {
    const api = await implementation(); expect(api).not.toBeNull()
    const r = response(true), saved = api!.travelSnapshot(r, r.generatedAt)
    if (!saved.ok) throw Error(saved.message)
    const storage = memory(JSON.stringify(saved.value)), original = storage.getItem(), post = vi.fn()
    vi.stubGlobal('fetch', post)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2028-01-01T00:00:00Z'))
    try {
      expect(api!.readTravelHistory(storage)).toEqual(saved)
      const refreshed = api!.refreshTravelRequest(saved.value)
      expect(refreshed).toEqual(r.request)
      refreshed.trip.readyAt = '2028-01-01T00:00:00Z'
      expect(saved.value.request).toEqual(r.request)
      expect(storage.getItem()).toBe(original)
      expect(post).not.toHaveBeenCalled()
      const panel = await import('../../src/features/travel/TravelHistoryPanel').catch(() => null)
      expect(panel, 'history panel exists').not.toBeNull()
      const html = renderToStaticMarkup(createElement(panel!.TravelHistoryPanel, { history: saved.value, onRefresh: vi.fn(), onDelete: vi.fn() }))
      expect(html).toContain('Saved planning estimate')
      expect(html).toContain('Prices and availability may have changed')
      expect(html).toContain(r.request.departureDate)
      expect(html).toContain(r.request.trip.readyAt)
      expect(html).toContain(r.generatedAt)
      expect(html).toContain('Refresh this plan')
      expect(html).not.toContain('Choose this journey')
      expect(post).not.toHaveBeenCalled()
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() }
  })
  it('retains older quotes when saving but rejects missing, unselectable or invalid selection times', async () => {
    const api = await implementation(); expect(api).not.toBeNull()
    const r = response()
    for (const altered of [ { ...r, journey: null }, { ...r, journey: { ...r.journey!, selectable: false } } ]) expect(api!.travelSnapshot(altered, r.generatedAt).ok).toBe(false)
    const aged = api!.travelSnapshot(r, '2026-11-18T06:30:00-08:00')
    expect(aged.ok).toBe(true)
    if (aged.ok) {
      expect(aged.value.selectedFlight).toEqual(r.flightOffers[0])
      expect(aged.value.expiresAt).toBe(r.expiresAt)
    }
    expect(api!.travelSnapshot(r, '2026-11-18T05:59:59-08:00').ok).toBe(false)
    expect(api!.travelSnapshot(r, '2026-11-19T10:00:00-08:00').ok).toBe(false)
    const future = structuredClone(r); future.flightOffers[0].evidence[0].checkedAt = r.expiresAt
    expect(api!.travelSnapshot(future, r.generatedAt).ok).toBe(false)
  })
  it('reads original versions without migration and allows explicit replacement in every direction', async () => {
    const api = await implementation(); expect(api).not.toBeNull()
    const r = response(), saved = api!.travelSnapshot(r, r.generatedAt)
    if (!saved.ok) throw Error(saved.message)
    const { legacy, city } = oldSelections()
    for (const old of [legacy, city]) {
      const s = memory(JSON.stringify(old))
      expect(api!.readTravelHistory(s)).toEqual({ ok: true, value: old })
      expect(api!.writeTravelSelection(s, saved.value).ok).toBe(true)
      expect(readSavedSelection(s)).toEqual({ ok: true, value: null })
      expect(readCityHistory(s)).toEqual({ ok: true, value: null })
    }
    const s = memory(JSON.stringify(saved.value))
    expect(writeSavedSelection(s, legacy).ok).toBe(true)
    s.setItem(SAVED_PLAN_KEY, JSON.stringify(saved.value))
    expect(writeCitySelection(s, city).ok).toBe(true)
  })
  it('protects malformed and future records against every writer until explicit deletion', async () => {
    const api = await implementation(); expect(api).not.toBeNull()
    const r = response(), saved = api!.travelSnapshot(r, r.generatedAt)
    if (!saved.ok) throw Error(saved.message)
    const { legacy, city } = oldSelections()
    const malformed = structuredClone(saved.value); malformed.journey.legs.find(l => l.kind === 'flight')!.service = 'fabricated'
    for (const raw of ['{', '{"schemaVersion":3}', '{"schemaVersion":4}', JSON.stringify(malformed), JSON.stringify({ ...saved.value, rawResponse: {} }), JSON.stringify({ ...saved.value, selectedAt: '2026-11-18T05:59:59-08:00' })]) {
      const s = memory(raw)
      expect(api!.readTravelHistory(s).ok).toBe(false)
      expect(readSavedSelection(s).ok).toBe(false)
      expect(readCityHistory(s).ok).toBe(false)
      expect(api!.writeTravelSelection(s, saved.value).ok).toBe(false)
      expect(writeSavedSelection(s, legacy).ok).toBe(false)
      expect(writeCitySelection(s, city).ok).toBe(false)
      expect(s.getItem()).toBe(raw)
    }
  })
  it('rejects Google Maps content and URLs while retaining distinct Google Travel source evidence', async () => {
    const api = await implementation(); expect(api).not.toBeNull()
    const r = response(), saved = api!.travelSnapshot(r, r.generatedAt)
    if (!saved.ok) throw Error(saved.message)
    for (const value of ['Google Maps Routes API', 'https://routes.googleapis.com/directions/v2:computeRoutes', 'https://maps.google.com/maps']) {
      const invalid = structuredClone(saved.value); invalid.journey.warnings.push(value)
      const s = memory(JSON.stringify(saved.value)), before = s.getItem()
      expect(api!.writeTravelSelection(s, invalid).ok).toBe(false)
      expect(s.getItem()).toBe(before)
    }
    const travel = structuredClone(r)
    for (const e of [ ...travel.flightOffers[0].evidence, ...travel.flightOffers[0].segments.flatMap(s => s.evidence), ...travel.journey!.evidence, ...travel.journey!.legs.flatMap(l => l.evidence) ]) if (e.provider === 'Test-only quoted inventory') e.provider = 'SerpAPI Google Travel'
    expect(api!.travelSnapshot(travel, r.generatedAt).ok).toBe(true)
  })
  it.each([
    'https://maps.app.goo.gl/exampleRoute',
    'https://maps.google.com./maps',
    'https://www.google.com./maps',
    'https://www.google.co.uk/maps/dir/San+Diego/Portland',
    'https://maps.google.co.uk/maps?daddr=Portland',
  ])('rejects selected original Maps source URL %s from snapshot, write and every reader', async sourceUrl => {
    const api = await implementation(); expect(api).not.toBeNull()
    const original = response(), saved = api!.travelSnapshot(original, original.generatedAt)
    if (!saved.ok) throw Error(saved.message)
    const f = travelFixture()
    f.flight.evidence[0].sourceUrl = sourceUrl
    const altered = TravelRecoveryResponseSchema.parse({
      ...original, flightOffers: [f.flight], journey: composeTravelJourney(f.input, f.flight, null, f),
    })
    expect(api!.travelSnapshot(altered, altered.generatedAt).ok).toBe(false)
    const forged = { ...saved.value, selectedFlight: altered.flightOffers[0], journey: altered.journey! }
    const storage = memory(JSON.stringify(saved.value)), before = storage.getItem()
    expect(api!.writeTravelSelection(storage, forged).ok).toBe(false)
    expect(storage.getItem()).toBe(before)
    storage.setItem(SAVED_PLAN_KEY, JSON.stringify(forged))
    expect(api!.readTravelHistory(storage).ok).toBe(false)
    expect(readSavedSelection(storage).ok).toBe(false)
    expect(readCityHistory(storage).ok).toBe(false)
  })
  it('retains Google Travel source URLs and provider provenance in the selected quote', async () => {
    const api = await implementation(); expect(api).not.toBeNull()
    const f = travelFixture(), original = response()
    f.flight.evidence[0].provider = 'SerpAPI Google Travel'
    f.flight.evidence[0].sourceUrl = 'https://www.google.com/travel/flights'
    const travel = TravelRecoveryResponseSchema.parse({
      ...original, flightOffers: [f.flight], journey: composeTravelJourney(f.input, f.flight, null, f),
    })
    const saved = api!.travelSnapshot(travel, travel.generatedAt)
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw Error(saved.message)
    const storage = memory()
    expect(api!.writeTravelSelection(storage, saved.value).ok).toBe(true)
    expect(api!.readTravelHistory(storage)).toEqual(saved)
    expect(storage.getItem()).toContain('https://www.google.com/travel/flights')
  })
  it('retains prior history on read and write storage failures', async () => {
    const api = await implementation(); expect(api).not.toBeNull()
    const r = response(), saved = api!.travelSnapshot(r, r.generatedAt)
    if (!saved.ok) throw Error(saved.message)
    const s = memory(JSON.stringify(saved.value)), original = s.getItem()
    expect(api!.writeTravelSelection({ ...s, setItem() { throw Error('quota') } }, saved.value).ok).toBe(false)
    expect(api!.writeTravelSelection({ ...s, getItem() { throw Error('blocked') } }, saved.value).ok).toBe(false)
    expect(s.getItem()).toBe(original)
  })
})
