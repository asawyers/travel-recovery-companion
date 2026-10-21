import { describe, expect, it, vi } from 'vitest'
import { createRecoveryHandler } from '../../supabase/functions/_shared/server/handlers.ts'
import { disabledProviders } from '../../supabase/functions/_shared/server/providers.ts'
import { RecoveryInputSchema, RecoveryResponseSchema, NormalizedFactsSchema } from '../../supabase/functions/_shared/domain/api.ts'
import { daytimeFixture, overnightFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import type { TripRequest } from '../../supabase/functions/_shared/domain/schemas.ts'

const now = '2026-10-21T12:00:00Z'
const origin = 'http://127.0.0.1:5173'
const input = () => ({ request: daytimeFixture().request, investigate: false })
const handler = () => createRecoveryHandler({ now: () => now, allowedOrigins: [origin], providers: disabledProviders })
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
    const run = createRecoveryHandler({ now: () => now, allowedOrigins: [origin], providers: { gatherPermittedFacts } })
    expect((await run(post(input()))).status).toBe(200)
    expect(gatherPermittedFacts).not.toHaveBeenCalled()
  })

  it('keeps useful manual results when optional providers fail, without leaking errors', async () => {
    const run = createRecoveryHandler({ now: () => now, allowedOrigins: [origin], providers: { gatherPermittedFacts: async () => { throw new Error('SECRET provider payload') } } })
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

  it('allows only configured browser origins and includes CORS on allowed-origin errors', async () => {
    const run = handler()
    const options = await run(new Request('http://localhost/recovery', { method: 'OPTIONS', headers: { Origin: origin } }))
    expect(options.status).toBe(204); expect(options.headers.get('access-control-allow-origin')).toBe(origin)
    expect(options.headers.get('access-control-allow-credentials')).toBeNull()
    expect((await run(post(input(), { Origin: 'https://unlisted.example' }))).status).toBe(403)
    const wrong = await run(new Request('http://localhost/recovery', { headers: { Origin: origin } }))
    expect(wrong.status).toBe(405); expect(wrong.headers.get('Allow')).toContain('POST')
    expect(wrong.headers.get('access-control-allow-origin')).toBe(origin)
    expect(wrong.headers.get('content-type')).toContain('application/json')
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
    expect(response.status).toBe(413); expect(response.headers.get('access-control-allow-origin')).toBe(origin)
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
      const run = createRecoveryHandler({ now: () => now, allowedOrigins: [origin], providers: { gatherPermittedFacts: () => new Promise(() => {}) } })
      const providerPending = run(post({ ...input(), investigate: true }))
      await vi.advanceTimersByTimeAsync(10_001)
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
    const run = createRecoveryHandler({ now: () => now, allowedOrigins: [origin], providers: { gatherPermittedFacts: async () => ({ candidates: [candidate], arrival, arrivalEvidence: [providerEvidence], warnings: [] }) } })
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
    const run = createRecoveryHandler({ now: () => now, allowedOrigins: [origin], providers: { gatherPermittedFacts: async () => ({ candidates: [candidate], arrival: { arrivalAt: request.arrivalAt, arrivalBasis: 'actual_gate' }, arrivalEvidence: [], warnings: [] }) } })
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
