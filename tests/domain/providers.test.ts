import { describe, expect, it, vi } from 'vitest'
import { FlightStatusReportSchema } from '../../supabase/functions/_shared/domain/schemas.ts'
import { RecoveryResponseSchema } from '../../supabase/functions/_shared/domain/api.ts'
import { daytimeFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { createRecoveryHandler } from '../../supabase/functions/_shared/server/handlers.ts'
import { createProviderRegistry, disabledProviders } from '../../supabase/functions/_shared/server/providers.ts'

export const flightReport = { ident: 'JBU123', faFlightId: 'JBU123-1', scheduledIn: '2026-10-21T12:00:00Z', estimatedIn: null, actualIn: null, actualOn: null, outcome: 'gate_available' as const }
describe('flight report contract', () => {
  it('requires strict fields and explicit timestamp offsets', () => {
    expect(FlightStatusReportSchema.safeParse(flightReport).success).toBe(true)
    expect(FlightStatusReportSchema.safeParse({ ...flightReport, secret: 'x' }).success).toBe(false)
    expect(FlightStatusReportSchema.safeParse({ ...flightReport, actualIn: '2026-10-21T12:00:00' }).success).toBe(false)
  })
  it('preserves equal optional reports and rejects disagreeing copies', async () => {
    const run = createRecoveryHandler({ now: () => '2026-10-21T12:00:00Z', providers: disabledProviders })
    const response = await run(new Request('http://localhost/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: daytimeFixture().request, investigate: false }) }))
    const body = await response.json()
    expect(RecoveryResponseSchema.safeParse(body).success).toBe(true)
    const withReport = { result: { ...body.result, flightStatus: flightReport }, facts: { ...body.facts, flightStatus: flightReport } }
    const parsed = RecoveryResponseSchema.safeParse(withReport)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.result.flightStatus).toEqual(flightReport)
    expect(RecoveryResponseSchema.safeParse({ ...withReport, facts: body.facts }).success).toBe(false)
    expect(RecoveryResponseSchema.safeParse({ ...withReport, facts: { ...withReport.facts, flightStatus: { ...flightReport, outcome: 'cancelled' } } }).success).toBe(false)
  })
})

describe('provider registry orchestration', () => {
  const realRequest = () => ({ ...daytimeFixture().request, mode: 'real' as const, confirmedOptions: [], arrivalBasis: 'estimated_gate' as const })
  const evidence = { type: 'live' as const, environment: 'production' as const, provider: 'Test flight provider', sourceUrl: null, checkedAt: '2026-10-21T12:00:00Z', serviceDate: '2026-10-21', providerUpdatedAt: null, expiresAt: '2026-10-21T12:05:00Z', warnings: [] }
  const context = () => ({ signal: new AbortController().signal })
  it('calls flight then routes once with the accepted flight arrival', async () => {
    const calls: string[] = []
    const request = realRequest()
    const arrival = { arrivalAt: request.arrivalAt, arrivalBasis: 'actual_gate' as const }
    const flight = vi.fn(async () => { calls.push('flight'); return { status: 'ok' as const, data: { arrival, report: flightReport }, evidence: [evidence], warnings: ['Flight checked'] } })
    const routes = vi.fn(async (received) => { calls.push('routes'); expect(received.arrivalBasis).toBe('actual_gate'); return { status: 'ok' as const, data: { candidates: [] }, evidence: [], warnings: [] } })
    const facts = await createProviderRegistry({ flight, routes }).gatherPermittedFacts(request, context())
    expect(calls).toEqual(['flight', 'routes'])
    expect(flight).toHaveBeenCalledTimes(1); expect(routes).toHaveBeenCalledTimes(1)
    expect(facts.arrival).toEqual(arrival); expect(facts.flightStatus).toEqual(flightReport)
  })
  it('keeps traveler-confirmed arrival centrally and still returns flight status', async () => {
    const request = { ...realRequest(), arrivalBasis: 'traveler_confirmed' as const }
    const flight = vi.fn(async () => ({ status: 'ok' as const, data: { arrival: { arrivalAt: request.arrivalAt, arrivalBasis: 'actual_gate' as const }, report: flightReport }, evidence: [evidence], warnings: [] }))
    const routes = vi.fn(async (received) => { expect(received.arrivalBasis).toBe('traveler_confirmed'); return { status: 'unavailable' as const, reason: 'No routes configured', retryable: false } })
    const facts = await createProviderRegistry({ flight, routes }).gatherPermittedFacts(request, context())
    expect(facts.arrival).toBeUndefined(); expect(facts.flightStatus).toEqual(flightReport)
  })
  it('makes no calls in synthetic mode or after parent cancellation', async () => {
    const flight = vi.fn(); const routes = vi.fn()
    const registry = createProviderRegistry({ flight, routes })
    expect((await registry.gatherPermittedFacts(daytimeFixture().request, context())).warnings.join(' ')).toMatch(/fictional|synthetic/i)
    const controller = new AbortController(); controller.abort()
    await registry.gatherPermittedFacts(realRequest(), { signal: controller.signal })
    expect(flight).not.toHaveBeenCalled(); expect(routes).not.toHaveBeenCalled()
  })
  it('keeps route candidates when flight fails and sanitizes thrown errors', async () => {
    const candidate = daytimeFixture().request.confirmedOptions[0]
    const facts = await createProviderRegistry({
      flight: async () => { throw new Error('SECRET') },
      routes: async () => ({ status: 'ok', data: { candidates: [candidate] }, evidence: [], warnings: ['Routes checked'] }),
    }).gatherPermittedFacts(realRequest(), context())
    expect(facts.candidates).toEqual([candidate]); expect(facts.warnings.join(' ')).toMatch(/unavailable/i)
    expect(JSON.stringify(facts)).not.toContain('SECRET')
  })
  it('rejects invalid arrival provenance before routing and reports disabled providers honestly', async () => {
    const request = realRequest()
    const routes = vi.fn(async (received) => { expect(received.arrivalBasis).toBe(request.arrivalBasis); return { status: 'unavailable' as const, reason: 'No routes configured', retryable: false } })
    const facts = await createProviderRegistry({
      flight: async () => ({ status: 'ok', data: { arrival: { arrivalAt: request.arrivalAt, arrivalBasis: 'actual_gate' }, report: flightReport }, evidence: [], warnings: [] }), routes,
    }).gatherPermittedFacts(request, context())
    expect(facts.arrival).toBeUndefined(); expect(facts.warnings.join(' ')).toMatch(/arrival.*unavailable/i)
    expect((await createProviderRegistry({}).gatherPermittedFacts(request, context())).warnings.join(' ')).toMatch(/Flight.*unavailable.*Routes.*unavailable/i)
  })
})

describe('provider arrivals beyond the hard deadline', () => {
  it.each(['2026-11-18T14:00:00-05:00', '2026-11-18T15:00:00-05:00'])('retains trusted arrival %s and skips pointless route queries', async arrivalAt => {
    const request = { ...daytimeFixture().request, mode: 'real' as const, confirmedOptions: [] }
    const evidence = { type: 'live' as const, environment: 'production' as const, provider: 'Test provider', sourceUrl: null, checkedAt: '2026-10-21T12:00:00Z', serviceDate: '2026-11-18', providerUpdatedAt: null, expiresAt: null, warnings: [] }
    const routes = vi.fn(async () => ({ status: 'ok' as const, data: { candidates: [] }, evidence: [], warnings: [] }))
    const facts = await createProviderRegistry({ flight: async () => ({ status: 'ok', data: { arrival: { arrivalAt, arrivalBasis: 'actual_gate' }, report: { ...flightReport, actualIn: arrivalAt } }, evidence: [evidence], warnings: [] }), routes }).gatherPermittedFacts(request, { signal: new AbortController().signal })
    expect(facts.arrival).toEqual({ arrivalAt, arrivalBasis: 'actual_gate' })
    expect(routes).not.toHaveBeenCalled()
    expect(facts.warnings.join(' ')).toMatch(/deadline/i)
  })
})
