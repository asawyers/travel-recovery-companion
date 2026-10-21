import { describe, expect, it, vi } from 'vitest'
import { createRecoveryHandler } from '../../supabase/functions/_shared/server/handlers.ts'
import { disabledProviders } from '../../supabase/functions/_shared/server/providers.ts'
import { RecoveryInputSchema, RecoveryResponseSchema, NormalizedFactsSchema } from '../../supabase/functions/_shared/domain/api.ts'
import { daytimeFixture, overnightFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import type { TripRequest } from '../../supabase/functions/_shared/domain/schemas.ts'

const now = '2026-10-21T12:00:00Z'
const origin = 'http://127.0.0.1:5173'
const input = () => ({ request: daytimeFixture().request, investigate: false })
const handler = () => createRecoveryHandler({ now: () => now, providers: disabledProviders })
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
function real(request: TripRequest): TripRequest {
  return JSON.parse(JSON.stringify({ ...request, mode: 'real' }).replaceAll('"synthetic"', '"production"').replaceAll('"type":"production"', '"type":"live"'))
}
function allEvidence(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(allEvidence)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return [...('environment' in record && 'type' in record ? [record] : []), ...Object.values(record).flatMap(allEvidence)]
  }
  return []
}

describe('public stateless recovery handler', () => {
  it('returns a validated deterministic response without credentials', async () => {
    const response = await handler()(post(input()))
    expect(response.status).toBe(200)
    const body = RecoveryResponseSchema.parse(await response.json())
    expect(body.result.plans.length).toBeGreaterThan(0)
    expect(body.facts.candidates).toHaveLength(3)
    expect(body.facts.checkedAt).toBe(now)
    expect(Date.parse(body.facts.expiresAt)).toBe(Date.parse(now) + 300_000)
    expect(body.facts.arrival.arrivalAt).toBe(input().request.arrivalAt)
    expect(allEvidence(body).every(e => e.type === 'synthetic' && e.environment === 'synthetic')).toBe(true)
    expect(await (await handler()(post(input()))).json()).toEqual(body)
  })

  it('recursively strips browser provider claims while preserving original evidence times', async () => {
    const request = real(overnightFixture().request)
    request.arrivalBasis = 'actual_gate'
    for (const e of allEvidence(request)) {
      e.provider = 'API checked secret'; e.sourceUrl = 'https://provider.example/?token=private'
      e.checkedAt = '2026-10-21T10:00:00Z'; e.providerUpdatedAt = '2026-10-21T09:00:00Z'; e.expiresAt = '2026-10-21T11:00:00Z'
      e.warnings = Array.from({ length: 32 }, (_, i) => `Original warning ${i}`)
    }
    const response = await handler()(post({ request, investigate: false }))
    expect(response.status).toBe(200)
    const body = RecoveryResponseSchema.parse(await response.json())
    expect(body.result.request.arrivalBasis).toBe('traveler_confirmed')
    expect(body.facts.arrivalEvidence[0].provider).toMatch(/traveler/i)
    const evidence = allEvidence(body.facts.candidates)
    expect(evidence.length).toBeGreaterThan(6)
    for (const e of evidence) {
      expect(e.type).toBe('estimated'); expect(e.environment).toBe('production')
      expect(e.provider).toMatch(/traveler/i); expect(e.provider).not.toMatch(/API checked secret/)
      expect(e.sourceUrl).toBeNull(); expect(e.checkedAt).toBe('2026-10-21T10:00:00Z')
      expect(e.providerUpdatedAt).toBe('2026-10-21T09:00:00Z'); expect(e.expiresAt).toBe('2026-10-21T11:00:00Z')
      expect((e.warnings as string[]).length).toBeLessThanOrEqual(32)
      expect((e.warnings as string[]).join(' ')).toMatch(/not verified/i)
    }
    expect(body.facts.expiresAt).toBe('2026-10-21T11:00:00Z')
  })

  it('preserves honest traveler-confirmed and estimated evidence types', async () => {
    const request = real(daytimeFixture().request)
    const evidence = allEvidence(request)
    evidence[0].type = 'traveler_confirmed'; evidence[1].type = 'estimated'
    const body = RecoveryResponseSchema.parse(await (await handler()(post({ request, investigate: false }))).json())
    const normalized = allEvidence(body.facts.candidates)
    expect(normalized[0].type).toBe('traveler_confirmed'); expect(normalized[1].type).toBe('estimated')
  })

  it('makes zero provider calls when investigation is off', async () => {
    const gatherPermittedFacts = vi.fn(() => { throw new Error('must not run') })
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts } })
    expect((await run(post(input()))).status).toBe(200)
    expect(gatherPermittedFacts).not.toHaveBeenCalled()
  })

  it('keeps useful manual results when optional providers fail, without leaking errors', async () => {
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: async () => { throw new Error('SECRET provider payload') } } })
    const response = await run(post({ ...input(), investigate: true }))
    expect(response.status).toBe(200)
    const body = RecoveryResponseSchema.parse(await response.json())
    expect(body.result.plans.length).toBeGreaterThan(0)
    expect(body.result.warnings.join(' ')).toMatch(/unavailable/i)
    expect(JSON.stringify(body)).not.toContain('SECRET')
  })

  it('reports disabled investigation and no feasible options honestly as HTTP 200', async () => {
    const response = await handler()(post({ request: { ...real(daytimeFixture().request), confirmedOptions: [] }, investigate: true }))
    expect(response.status).toBe(200)
    const body = RecoveryResponseSchema.parse(await response.json())
    expect(body.result.plans).toEqual([]); expect(body.facts.candidates).toEqual([])
    expect(body.result.warnings.join(' ')).toMatch(/unavailable/i)
    expect(body.result.warnings.join(' ')).toMatch(/No feasible/)
  })

  it('normalizes duplicate candidates before returning facts', async () => {
    const value = input(); value.request.confirmedOptions[1].id = value.request.confirmedOptions[0].id
    const body = RecoveryResponseSchema.parse(await (await handler()(post(value))).json())
    expect(body.facts.candidates).toHaveLength(1)
    expect(body.result.warnings.join(' ')).toMatch(/Duplicate/)
  })

  it('caps cache lifetime at the earliest nested hotel quote even if already expired', async () => {
    const request = overnightFixture().request
    if (request.confirmedOptions[0].kind !== 'overnight') throw new Error('fixture')
    request.confirmedOptions[0].hotel.quoteExpiresAt = '2026-10-21T11:50:00Z'
    const body = RecoveryResponseSchema.parse(await (await handler()(post({ request, investigate: false }))).json())
    expect(body.facts.expiresAt).toBe('2026-10-21T11:50:00Z')
  })

  it.each([origin, 'https://arbitrary.example', 'null', null])('serves any origin with wildcard CORS and no credentials (%s)', async requestOrigin => {
    const run = handler()
    const headers = requestOrigin === null ? {} : { Origin: requestOrigin }
    const options = await run(new Request('http://localhost/recovery', { method: 'OPTIONS', headers }))
    const success = await run(post(input(), headers))
    const wrong = await run(new Request('http://localhost/recovery', { headers }))
    expect(options.status).toBe(204)
    expect(success.status).toBe(200)
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('Allow')).toContain('POST')
    for (const response of [options, success, wrong]) {
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
      expect(response.headers.get('access-control-allow-headers')).toBe('content-type')
      expect(response.headers.get('access-control-allow-credentials')).toBeNull()
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it.each([null, {}, { ...input(), owner: 'forbidden' }, { ...input(), facts: {} }, { ...input(), request: { ...input().request, session: 'x' } }, { ...input(), request: { ...input().request, mode: 'real' } }])('rejects invalid or extra browser fields', async value => {
    expect((await handler()(post(value))).status).toBe(400)
  })

  it('rejects malformed JSON, non-JSON content and excessive streamed or declared bodies', async () => {
    expect((await handler()(new Request('http://localhost/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status).toBe(400)
    expect((await handler()(new Request('http://localhost/recovery', { method: 'POST', body: JSON.stringify(input()) }))).status).toBe(400)
    expect((await handler()(post(input(), { 'Content-Length': '65537' }))).status).toBe(413)
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(65537))); controller.close() } })
    const streamed = new Request('http://localhost/recovery', { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin }, body: stream, duplex: 'half' } as RequestInit)
    const response = await handler()(streamed)
    expect(response.status).toBe(413); expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).not.toContain(' '.repeat(100))
  })

  it('bounds stalled request bodies and optional provider execution', async () => {
    vi.useFakeTimers()
    try {
      const stream = new ReadableStream({ start() {} })
      const stalled = new Request('http://localhost/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit)
      const pending = handler()(stalled)
      await vi.advanceTimersByTimeAsync(10_001)
      expect((await pending).status).toBe(408)
      const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: () => new Promise(() => {}) } })
      const providerPending = run(post({ request: real(input().request), investigate: true }))
      let completed = false
      void providerPending.then(() => { completed = true })
      await vi.advanceTimersByTimeAsync(14_999)
      expect(completed).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      expect((await providerPending).status).toBe(200)
    } finally { vi.useRealTimers() }
  })

  it('returns validation issues instead of throwing on malformed response timestamps', async () => {
    const body = await (await handler()(post(input()))).json()
    expect(() => NormalizedFactsSchema.safeParse({ ...body.facts, checkedAt: 'invalid' })).not.toThrow()
    expect(NormalizedFactsSchema.safeParse({ ...body.facts, checkedAt: 'invalid' }).success).toBe(false)
    expect(() => RecoveryResponseSchema.safeParse({ ...body, facts: { ...body.facts, expiresAt: 'invalid' } })).not.toThrow()
  })

  it('validates trusted injected adapter arrival and preserves original timestamps without secret URL parameters', async () => {
    const request = real(daytimeFixture().request)
    request.confirmedOptions = []
    const candidate = real(daytimeFixture().request).confirmedOptions[0]
    for (const e of allEvidence(candidate)) {
      e.sourceUrl = 'https://provider.example/public-schedule?token=secret#secret'
      e.checkedAt = '2026-10-21T11:57:00Z'; e.providerUpdatedAt = '2026-10-21T11:55:00Z'
      e.expiresAt = '2026-10-21T12:02:00Z'
    }
    const arrival = { arrivalAt: request.arrivalAt, arrivalBasis: 'actual_gate' as const }
    const providerEvidence = { ...candidate.evidence[0], provider: 'Injected test provider' }
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: async () => ({ candidates: [candidate], arrival, arrivalEvidence: [providerEvidence], warnings: [] }) } })
    const response = await run(post({ request, investigate: true }))
    expect(response.status).toBe(200)
    const body = RecoveryResponseSchema.parse(await response.json())
    expect(body.facts.arrival.arrivalBasis).toBe('actual_gate')
    expect(body.facts.arrivalEvidence[0].checkedAt).toBe('2026-10-21T11:57:00Z')
    expect(body.facts.arrivalEvidence[0].providerUpdatedAt).toBe('2026-10-21T11:55:00Z')
    expect(body.facts.expiresAt).toBe('2026-10-21T12:02:00Z')
    expect(allEvidence(body.facts).every(e => e.sourceUrl === 'https://provider.example/public-schedule')).toBe(true)
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('retains valid candidates when a separate adapter arrival fails provenance validation', async () => {
    const request = real(daytimeFixture().request)
    const candidate = request.confirmedOptions[0]
    request.confirmedOptions = []
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: async () => ({ candidates: [candidate], arrival: { arrivalAt: request.arrivalAt, arrivalBasis: 'actual_gate' }, arrivalEvidence: [], warnings: [] }) } })
    const body = RecoveryResponseSchema.parse(await (await run(post({ request, investigate: true }))).json())
    expect(body.facts.candidates).toHaveLength(1)
    expect(body.facts.arrival.arrivalBasis).toBe('estimated_gate')
    expect(body.result.warnings.join(' ')).toMatch(/arrival.*unavailable/i)
  })

  it('runtime-validates response lifetime and input envelope strictness', async () => {
    const body = await (await handler()(post(input()))).json()
    expect(RecoveryResponseSchema.safeParse({ ...body, facts: { ...body.facts, expiresAt: '2026-10-22T00:00:00Z' } }).success).toBe(false)
    expect(RecoveryInputSchema.safeParse({ ...input(), cache: {} }).success).toBe(false)
  })
})


describe('provider integration boundaries', () => {
  const report = { ident: 'JBU123', faFlightId: 'JBU123-1', scheduledIn: '2026-10-21T12:00:00Z', estimatedIn: null, actualIn: null, actualOn: null, outcome: 'gate_available' as const }
  it('copies validated flight status into result and facts', async () => {
    const request = real(daytimeFixture().request)
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: async () => ({ candidates: [], flightStatus: report, warnings: [] }) } })
    const body = RecoveryResponseSchema.parse(await (await run(post({ request, investigate: true }))).json())
    expect(body.result.flightStatus).toEqual(report); expect(body.facts.flightStatus).toEqual(report)
  })
  it('retains explicit traveler arrival even for an injected provider override', async () => {
    const request = { ...real(daytimeFixture().request), arrivalBasis: 'traveler_confirmed' as const }
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: async () => ({ candidates: [], flightStatus: report, arrival: { arrivalAt: request.arrivalAt, arrivalBasis: 'actual_gate' }, arrivalEvidence: [request.confirmedOptions[0].evidence[0]], warnings: [] }) } })
    const body = RecoveryResponseSchema.parse(await (await run(post({ request, investigate: true }))).json())
    expect(body.facts.arrival.arrivalBasis).toBe('traveler_confirmed'); expect(body.result.flightStatus).toEqual(report)
  })
  it('never invokes a provider registry for synthetic trips', async () => {
    const gatherPermittedFacts = vi.fn(async () => ({ candidates: [], warnings: [] }))
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts } })
    expect((await run(post({ ...input(), investigate: true }))).status).toBe(200)
    expect(gatherPermittedFacts).not.toHaveBeenCalled()
  })
  it('discards malformed optional flight reports while preserving manual candidates', async () => {
    const request = real(daytimeFixture().request)
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: async () => ({ candidates: [], flightStatus: { ...report, actualOn: 'invalid' }, warnings: [] }) } })
    const body = RecoveryResponseSchema.parse(await (await run(post({ request, investigate: true }))).json())
    expect(body.facts.candidates).toHaveLength(3); expect(body.result.flightStatus).toBeUndefined()
    expect(body.result.warnings.join(' ')).toMatch(/flight status.*unavailable/i)
  })
})

describe('Edge entrypoint provider activation', () => {
  it('requires explicit usage approval plus each provider key before enabling an adapter', async () => {
    const flightFactory = vi.fn(() => async () => ({ status: 'unavailable', reason: 'Test disabled', retryable: false }))
    const routesFactory = vi.fn(() => async () => ({ status: 'unavailable', reason: 'Test disabled', retryable: false }))
    vi.doMock('../../supabase/functions/_shared/server/flightaware.ts', () => ({ createFlightAwareAdapter: flightFactory }))
    vi.doMock('../../supabase/functions/_shared/server/google-routes.ts', () => ({ createGoogleRoutesAdapter: routesFactory }))
    try {
      for (const [approved, flightKey, routesKey, enabledFlight, enabledRoutes] of [
        [undefined, 'fake-flight', 'fake-routes', false, false], ['false', 'fake-flight', 'fake-routes', false, false],
        ['true', undefined, undefined, false, false], ['true', 'fake-flight', undefined, true, false], ['true', 'fake-flight', 'fake-routes', true, true],
      ] as const) {
        vi.resetModules()
        const values = { RECOVERY_PROVIDER_USAGE_APPROVED: approved, FLIGHTAWARE_API_KEY: flightKey, GOOGLE_ROUTES_API_KEY: routesKey }
        vi.stubGlobal('Deno', { env: { get: (name: keyof typeof values) => values[name] }, serve: vi.fn() })
        await import('../../supabase/functions/recovery/index.ts')
        expect(flightFactory.mock.lastCall?.[0]).toMatchObject({ enabled: enabledFlight })
        expect(routesFactory.mock.lastCall?.[0]).toMatchObject({ enabled: enabledRoutes })
      }
    } finally {
      vi.unstubAllGlobals()
      vi.doUnmock('../../supabase/functions/_shared/server/flightaware.ts')
      vi.doUnmock('../../supabase/functions/_shared/server/google-routes.ts')
      vi.resetModules()
    }
  })
})

describe('trusted late arrivals and optional candidate collisions', () => {
  it.each(['2026-11-18T14:00:00-05:00', '2026-11-18T15:00:00-05:00'])('plans honestly from arrival %s after the deadline becomes unreachable', async arrivalAt => {
    const request = real(daytimeFixture().request)
    const evidence = request.confirmedOptions[0].evidence[0]
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: async () => ({ candidates: [], arrival: { arrivalAt, arrivalBasis: 'actual_gate' }, arrivalEvidence: [evidence], warnings: [] }) } })
    const response = await run(post({ request, investigate: true }))
    expect(response.status).toBe(200)
    const body = RecoveryResponseSchema.parse(await response.json())
    expect(body.facts.arrival).toEqual({ arrivalAt, arrivalBasis: 'actual_gate' })
    expect(body.result.request.deadlineAt).toBe(request.deadlineAt)
    expect(body.facts.candidates).toHaveLength(3)
    expect(body.result.plans).toEqual([])
    expect(body.result.warnings.join(' ')).toMatch(/No feasible/i)
  })
  it('retains the manual option when an optional provider candidate has the same ID', async () => {
    const request = real(daytimeFixture().request)
    const manual = request.confirmedOptions[0]
    const duplicate = { ...manual, title: 'Optional duplicate' }
    const run = createRecoveryHandler({ now: () => now, providers: { gatherPermittedFacts: async () => ({ candidates: [duplicate], warnings: [] }) } })
    const body = RecoveryResponseSchema.parse(await (await run(post({ request, investigate: true }))).json())
    expect(body.facts.candidates).toHaveLength(3)
    expect(body.facts.candidates.find(candidate => candidate.id === manual.id)?.title).toBe(manual.title)
    expect(body.result.warnings.join(' ')).toMatch(/provider.*duplicate|optional.*duplicate/i)
  })
})
