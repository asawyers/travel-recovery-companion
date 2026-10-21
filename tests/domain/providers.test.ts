import { describe, expect, it, vi } from 'vitest'
import { TripRequestSchema } from '../../supabase/functions/_shared/domain/schemas.ts'
import { ADAPTER_REVISION, RecoveryResponseSchema } from '../../supabase/functions/_shared/domain/api.ts'
import { daytimeFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { createRecoveryHandler } from '../../supabase/functions/_shared/server/handlers.ts'
import { createProviderRegistry, disabledProviders, providerCapabilities } from '../../supabase/functions/_shared/server/providers.ts'

describe('routes-only response contract', () => {
  it('invalidates facts collected with the retired provider integration', () => {
    expect(ADAPTER_REVISION).toBe('public-recovery-v4')
    expect(providerCapabilities).toEqual({ transit: 'optional', hotel: 'unavailable', model: 'disabled' })
  })
  it('rejects retired flight reports in normalized facts and results', async () => {
    const run = createRecoveryHandler({ now: () => '2026-10-21T12:00:00Z', providers: disabledProviders })
    const response = await run(new Request('http://localhost/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: daytimeFixture().request, investigate: false }) }))
    const body = await response.json()
    const report = { ident: 'JBU123', faFlightId: 'JBU123-1', scheduledIn: '2026-10-21T12:00:00Z', estimatedIn: null, actualIn: null, actualOn: null, outcome: 'gate_available' }
    expect(RecoveryResponseSchema.safeParse(body).success).toBe(true)
    expect(RecoveryResponseSchema.safeParse({ result: { ...body.result, flightStatus: report }, facts: { ...body.facts, flightStatus: report } }).success).toBe(false)
    expect(RecoveryResponseSchema.safeParse({ ...body, result: { ...body.result, flightStatus: report } }).success).toBe(false)
    expect(RecoveryResponseSchema.safeParse({ ...body, facts: { ...body.facts, flightStatus: report } }).success).toBe(false)
  })
  it('preserves legacy flight metadata in saved requests', () => {
    const request = { ...daytimeFixture().request, flight: { ident: 'AS390', departureDate: '2026-10-21' } }
    expect(TripRequestSchema.parse(request).flight).toEqual(request.flight)
  })
})

describe('routes provider orchestration', () => {
  const realRequest = () => ({ ...daytimeFixture().request, mode: 'real' as const, confirmedOptions: [], arrivalBasis: 'traveler_confirmed' as const })
  const context = () => ({ signal: new AbortController().signal })
  it('uses the traveler arrival and returns route candidates without flight investigation warnings', async () => {
    const request = { ...realRequest(), flight: { ident: 'AS390', departureDate: '2026-10-21' } }
    const candidate = daytimeFixture().request.confirmedOptions[0]
    const routes = vi.fn(async () => ({ status: 'ok' as const, data: { candidates: [candidate] }, evidence: [], warnings: ['Routes checked'] }))
    const facts = await createProviderRegistry({ routes }).gatherPermittedFacts(request, context())
    expect(routes).toHaveBeenCalledExactlyOnceWith(request, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(facts.candidates).toEqual([candidate])
    expect(facts.warnings.join(' ')).toContain('Routes checked')
    expect(facts.warnings.join(' ')).not.toMatch(/flight|arrival.*unavailable/i)
    expect(Object.keys(facts).sort()).toEqual(['candidates', 'warnings'])
  })
  it('makes no calls in synthetic mode or after parent cancellation', async () => {
    const routes = vi.fn()
    const registry = createProviderRegistry({ routes })
    expect((await registry.gatherPermittedFacts(daytimeFixture().request, context())).warnings.join(' ')).toMatch(/fictional|synthetic/i)
    const controller = new AbortController(); controller.abort()
    await registry.gatherPermittedFacts(realRequest(), { signal: controller.signal })
    expect(routes).not.toHaveBeenCalled()
  })
  it('sanitizes thrown route errors and reports missing routes honestly', async () => {
    const facts = await createProviderRegistry({ routes: async () => { throw new Error('SECRET') } }).gatherPermittedFacts(realRequest(), context())
    expect(facts.candidates).toEqual([])
    expect(facts.warnings.join(' ')).toMatch(/Routes.*unavailable/i)
    expect(JSON.stringify(facts)).not.toContain('SECRET')
    const disabled = await disabledProviders.gatherPermittedFacts(realRequest(), context())
    expect(disabled.warnings.join(' ')).toMatch(/Routes.*unavailable/i)
    expect(disabled.warnings.join(' ')).not.toMatch(/flight/i)
  })
  it.each(['2026-11-18T14:00:00-05:00', '2026-11-18T15:00:00-05:00'])('skips routes when traveler arrival %s reaches the deadline', async arrivalAt => {
    const routes = vi.fn()
    const facts = await createProviderRegistry({ routes }).gatherPermittedFacts({ ...realRequest(), arrivalAt }, context())
    expect(routes).not.toHaveBeenCalled()
    expect(facts.warnings.join(' ')).toMatch(/deadline/i)
  })
})
