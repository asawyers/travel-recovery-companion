import { describe, expect, it, vi } from 'vitest'
import { createProviderRegistry } from '../../supabase/functions/_shared/server/providers.ts'
import { daytimeFixture, overnightFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import type { HotelOption, TripRequest } from '../../supabase/functions/_shared/domain/schemas.ts'
const context = () => ({ signal: new AbortController().signal })
const request = (): TripRequest => ({ ...overnightFixture().request, mode: 'real', confirmedOptions: [] })
function hotel(): HotelOption {
  const option = overnightFixture().request.confirmedOptions[0]
  if (option.kind !== 'overnight') throw new Error('expected fixture')
  return option.hotel
}
const routesResult = () => ({ status: 'ok' as const, data: { candidates: daytimeFixture().candidates.slice(0, 1) }, evidence: [], warnings: ['Routes checked'] })
const hotelResult = () => ({ status: 'ok' as const, data: { offers: [hotel()] }, evidence: [], warnings: ['Hotel availability checked'] })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
describe('request-scoped provider discovery sessions', () => {
  it('memoizes concurrent and repeated transport/hotel promises and keeps discoveries separate', async () => {
    const transport = deferred<ReturnType<typeof routesResult>>(); const availability = deferred<ReturnType<typeof hotelResult>>()
    const routes = vi.fn(() => transport.promise); const hotels = vi.fn(() => availability.promise)
    const req = request(); const ctx = context(); const registry = createProviderRegistry({ routes, hotels })
    expect(registry.createSession).toBeTypeOf('function')
    const session = registry.createSession!(req, ctx)
    const firstRoute = session.findTransport(); const secondRoute = session.findTransport()
    const firstHotel = session.findHotels(); const secondHotel = session.findHotels()
    expect(firstRoute).toBe(secondRoute); expect(firstHotel).toBe(secondHotel)
    expect(routes).toHaveBeenCalledExactlyOnceWith(req, ctx); expect(hotels).toHaveBeenCalledExactlyOnceWith(req, ctx)
    transport.resolve(routesResult()); availability.resolve(hotelResult())
    const [r, h] = await Promise.all([firstRoute, firstHotel])
    expect(r).toEqual({ candidates: routesResult().data.candidates, offers: [], warnings: ['Routes checked'] })
    expect(h).toEqual({ candidates: [], offers: [hotel()], warnings: ['Hotel availability checked'] })
    expect(await session.findTransport()).toBe(r); expect(await session.findHotels()).toBe(h)
    expect(routes).toHaveBeenCalledTimes(1); expect(hotels).toHaveBeenCalledTimes(1)
  })
  it('memoizes safe failure results so retries do not restart paid provider calls', async () => {
    const routes = vi.fn(async () => { throw new Error('SECRET transport error') })
    const hotels = vi.fn(async () => ({ status: 'error' as const, reason: 'The provider returned a bounded availability failure.', retryable: true }))
    const registry = createProviderRegistry({ routes, hotels }); expect(registry.createSession).toBeTypeOf('function')
    const session = registry.createSession!(request(), context())
    const [first, repeated, hotelFirst, hotelRepeated] = await Promise.all([session.findTransport(), session.findTransport(), session.findHotels(), session.findHotels()])
    expect(first).toBe(repeated); expect(hotelFirst).toBe(hotelRepeated)
    expect(first.candidates).toEqual([]); expect(hotelFirst.offers).toEqual([])
    expect(first.warnings.join(' ')).toMatch(/Routes.*unavailable/); expect(hotelFirst.warnings.join(' ')).toMatch(/Hotel.*error/)
    expect(JSON.stringify([first, hotelFirst])).not.toContain('SECRET')
    expect(routes).toHaveBeenCalledTimes(1); expect(hotels).toHaveBeenCalledTimes(1)
  })
  it('gathers both independently using the same caller signal and combines their distinct facts', async () => {
    const transport = deferred<ReturnType<typeof routesResult>>(); const availability = deferred<ReturnType<typeof hotelResult>>()
    const routes = vi.fn(() => transport.promise); const hotels = vi.fn(() => availability.promise)
    const req = request(); const ctx = context()
    const result = createProviderRegistry({ routes, hotels }).gatherPermittedFacts(req, ctx)
    expect(routes).toHaveBeenCalledExactlyOnceWith(req, ctx); expect(hotels).toHaveBeenCalledExactlyOnceWith(req, ctx)
    transport.resolve(routesResult()); availability.resolve(hotelResult())
    expect(await result).toEqual({ candidates: routesResult().data.candidates, offers: [hotel()], warnings: ['Routes checked', 'Hotel availability checked'] })
  })
  it.each(['synthetic', 'aborted', 'deadline-reached'])('never invokes either provider for %s requests', async scenario => {
    const routes = vi.fn(); const hotels = vi.fn(); const req = request(); const controller = new AbortController()
    if (scenario === 'synthetic') req.mode = 'synthetic'
    if (scenario === 'aborted') controller.abort()
    if (scenario === 'deadline-reached') req.arrivalAt = req.deadlineAt
    const registry = createProviderRegistry({ routes, hotels }); expect(registry.createSession).toBeTypeOf('function')
    const session = registry.createSession!(req, { signal: controller.signal })
    const results = await Promise.all([session.findTransport(), session.findHotels()])
    expect(routes).not.toHaveBeenCalled(); expect(hotels).not.toHaveBeenCalled()
    expect(results.every(result => result.candidates.length === 0 && result.offers?.length === 0 && result.warnings.length > 0)).toBe(true)
  })
  it.each(['not-allowed', 'no-stay'])('skips hotels with %s but retains independent transport', async scenario => {
    const req = request(); if (scenario === 'not-allowed') req.overnightAllowed = false; else req.stay = null
    const routes = vi.fn(async () => routesResult()); const hotels = vi.fn(async () => hotelResult())
    const facts = await createProviderRegistry({ routes, hotels }).gatherPermittedFacts(req, context())
    expect(routes).toHaveBeenCalledTimes(1); expect(hotels).not.toHaveBeenCalled(); expect(facts.candidates).toHaveLength(1)
    expect(facts.warnings.join(' ')).toMatch(/Hotel.*(?:stay|permission|allowed|overnight)/i)
  })
  it('does not start undiscovered hotels after aggregate cancellation while reusing a completed transport result', async () => {
    const routes = vi.fn(async () => routesResult()); const hotels = vi.fn(async () => hotelResult()); const controller = new AbortController()
    const registry = createProviderRegistry({ routes, hotels }); expect(registry.createSession).toBeTypeOf('function')
    const session = registry.createSession!(request(), { signal: controller.signal })
    const first = await session.findTransport(); controller.abort()
    expect(await session.findTransport()).toBe(first)
    const unavailable = await session.findHotels(); expect(unavailable.offers).toEqual([]); expect(unavailable.warnings.join(' ')).toMatch(/cancelled/i)
    expect(hotels).not.toHaveBeenCalled()
  })
  it('keeps separate requests separate while avoiding resets within one session', async () => {
    const routes = vi.fn(async () => routesResult()); const registry = createProviderRegistry({ routes }); expect(registry.createSession).toBeTypeOf('function')
    const first = registry.createSession!(request(), context()); const second = registry.createSession!(request(), context())
    await Promise.all([first.findTransport(), first.findTransport(), second.findTransport()]); expect(routes).toHaveBeenCalledTimes(2)
  })
  it('gather compatibility preserves legacy no-offers keys and honest missing-provider warnings', async () => {
    const facts = await createProviderRegistry({}).gatherPermittedFacts(request(), context())
    expect(Object.keys(facts).sort()).toEqual(['candidates', 'warnings'])
    expect(facts.warnings.join(' ')).toMatch(/Routes.*unavailable/); expect(facts.warnings.join(' ')).toMatch(/Hotel.*unavailable/)
  })
})
