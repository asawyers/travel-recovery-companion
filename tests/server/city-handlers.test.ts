import { afterEach, describe, expect, it, vi } from 'vitest'
import { cityFixture, namedCityFixtures } from '../../supabase/functions/_shared/domain/city-fixtures.ts'
import { CityRecoveryResponseSchema, cityClarificationQuestion } from '../../supabase/functions/_shared/domain/city-contracts.ts'
import type { CityTripRequest } from '../../supabase/functions/_shared/domain/city-contracts.ts'
import type { CityAgentExecutor, CityProviderFacts } from '../../supabase/functions/_shared/server/city-agent-contracts.ts'
import { createCityRecoveryHandler } from '../../supabase/functions/_shared/server/city-handlers.ts'

const fixture = cityFixture()
const now = () => fixture.now
function realRequest(): CityTripRequest {
  const request = structuredClone(fixture.request)
  request.mode = 'real'
  for (const candidate of request.confirmedOptions) for (const evidence of candidate.evidence) {
    evidence.type = 'live'; evidence.environment = 'production'; evidence.provider = 'Forged server provider'
    evidence.sourceUrl = 'https://example.test/route?key=PRIVATE_KEY'
  }
  return request
}
const request = realRequest()
const post = (body: unknown, signal?: AbortSignal) => new Request('https://edge.test/recovery/city', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
const findCity = (id: string) => [fixture.origin, fixture.destination].find(city => city.id === id) ?? null
function setup(extra = {}) {
  const provider = vi.fn(async (): Promise<CityProviderFacts> => ({ candidates: [], warnings: [] }))
  return { provider, handler: createCityRecoveryHandler({ now, findCity, provider, ...extra }) }
}
afterEach(() => vi.useRealTimers())

describe('city HTTP boundary', () => {
  it('returns canonical city v2 results and sanitized browser evidence', async () => {
    const { handler, provider } = setup()
    const response = await handler(post({ request, investigate: false }))
    expect(response.status).toBe(200)
    const body = CityRecoveryResponseSchema.parse(await response.json())
    expect(body.version).toBe(2)
    expect(body.result.origin).toEqual(fixture.origin)
    expect(body.facts.candidates).toEqual(body.result.request.confirmedOptions)
    expect(body.facts.adapterRevision).toBe('public-city-v1')
    expect(body.facts.candidates[0].evidence[0]).toMatchObject({ type: 'estimated', environment: 'production', sourceUrl: null, provider: 'Traveler input (not server verified)' })
    expect(body.result.request.readyAt).toBe(request.readyAt)
    expect(provider).not.toHaveBeenCalled()
    expect(Date.parse(body.facts.expiresAt)).toBeLessThanOrEqual(Date.parse(body.facts.checkedAt) + 300_000)
  })
  it('supports public preflight without credentials', async () => {
    const { handler } = setup()
    const response = await handler(new Request('https://edge.test/recovery/city', { method: 'OPTIONS' }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
  })
  it('rejects other methods with Allow and safe CORS', async () => {
    const response = await setup().handler(new Request('https://edge.test/recovery/city'))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })
  it.each([
    { request: { ...request, originCityId: 'geonames:999999999' }, investigate: true },
    { request: { ...request, destinationCityId: 'geonames:999999999' }, investigate: true },
    { request: { ...request, latitude: 10 }, investigate: true },
    { request, investigate: true, origin: fixture.origin },
    { request, investigate: true, refinement: 'x'.repeat(501) },
    { request, investigate: true, conversation: { turnId: 't', baseRevision: 0, history: Array.from({ length: 9 }, () => ({ role: 'user', content: 'x'.repeat(1000) })) } },
  ])('rejects unknown cities and strict bounded input before external calls %#', async body => {
    const { handler, provider } = setup()
    expect((await handler(post(body))).status).toBe(400)
    expect(provider).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON, wrong content type and oversize body', async () => {
    const { handler } = setup()
    for (const [body, headers, status] of [['{', { 'content-type': 'application/json' }, 400], ['{}', {}, 400], [' '.repeat(65537), { 'content-type': 'application/json' }, 413]] as const) {
      expect((await handler(new Request('https://edge.test/recovery/city', { method: 'POST', body, headers }))).status).toBe(status)
    }
  })
  it('times out a stalled body after five seconds', async () => {
    vi.useFakeTimers()
    const stream = new ReadableStream({ start() {} })
    const input = new Request('https://edge.test/recovery/city', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit)
    const pending = setup().handler(input)
    await vi.advanceTimersByTimeAsync(5001)
    expect((await pending).status).toBe(408)
  })
  it('isolates synthetic mode from provider and agent calls', async () => {
    const agent = vi.fn<CityAgentExecutor>()
    const { handler, provider } = setup({ agent })
    const response = await handler(post({ request: fixture.request, investigate: true, refinement: 'Compare' }))
    expect(response.status).toBe(200)
    expect((await response.json()).assistance.status).toBe('unavailable')
    expect(agent).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })
  it('memoizes the complete provider promise and preserves manual ID collisions', async () => {
    const candidate = { ...structuredClone(request.confirmedOptions[0]), title: 'Provider cannot replace manual' }
    const provider = vi.fn(async () => ({ candidates: [candidate, { ...candidate, id: 'provider-two' }], warnings: [] }))
    const agent: CityAgentExecutor = async ({ tools }) => {
      await tools.findTransport(); await tools.findTransport(); await tools.findHotels()
      const assessed = await tools.assess({})
      return { status: 'completed', summary: 'Verified', appliedPreferences: {}, selectedPlanId: assessed.result.plans[0].id, activity: [] }
    }
    const { handler } = setup({ provider, agent })
    const body = await (await handler(post({ request, investigate: true, refinement: 'Compare' }))).json()
    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider.mock.calls[0][0]).toMatchObject({ originCityId: fixture.origin.id, destinationCityId: fixture.destination.id })
    expect(body.facts.candidates).toHaveLength(2)
    expect(body.facts.candidates[0].title).toBe(request.confirmedOptions[0].title)
    expect(body.result.warnings.join(' ')).toContain('duplicate')
  })
  it.each([
    ['I can drive', { drivingAllowed: true }, { drivingAllowed: false, priority: 'earliest' as const }],
    ['Prioritize fewest transfers', { priority: 'fewest_transfers' as const }, { drivingAllowed: true, priority: 'earliest' as const }],
  ])('uses explicitly requested soft preferences in the single provider lookup: %s', async (refinement, patch, originalPreferences) => {
    const original = { ...realRequest(), ...originalPreferences }
    const provider = vi.fn(async () => ({ candidates: [], warnings: [] }))
    const agent: CityAgentExecutor = async ({ tools }) => {
      await tools.findTransport(); await tools.findTransport()
      const assessed = await tools.assess(patch)
      return { status: 'completed', summary: 'Assessed', appliedPreferences: patch, selectedPlanId: assessed.result.plans[0].id, activity: [] }
    }
    const response = await setup({ agent, provider }).handler(post({ request: original, investigate: true, refinement }))
    expect(response.status).toBe(200)
    const body = CityRecoveryResponseSchema.parse(await response.json())
    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider.mock.calls[0][0]).toEqual({ ...body.result.request, confirmedOptions: provider.mock.calls[0][0].confirmedOptions })
    expect(provider.mock.calls[0][0]).toMatchObject(patch)
    expect(body.result.request).toMatchObject(patch)
    for (const key of ['originCityId', 'destinationCityId', 'readyAt', 'deadlineAt', 'budgetCents', 'budgetMode'] as const) expect(provider.mock.calls[0][0][key]).toEqual(original[key])
  })
  it('uses requested discovery preferences without applying them after limited assistance', async () => {
    const original = { ...realRequest(), drivingAllowed: false }
    const provider = vi.fn(async () => ({ candidates: [], warnings: [] }))
    const agent: CityAgentExecutor = async ({ tools }) => {
      await tools.findTransport()
      return { status: 'limited', summary: 'Incomplete', appliedPreferences: {}, selectedPlanId: null, activity: [] }
    }
    const response = await setup({ provider, agent }).handler(post({ request: original, investigate: true, refinement: 'I can drive and prioritize fewest transfers' }))
    const body = CityRecoveryResponseSchema.parse(await response.json())
    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider.mock.calls[0][0]).toMatchObject({ drivingAllowed: true, priority: 'fewest_transfers' })
    expect(body.result.request).toMatchObject({ drivingAllowed: false, priority: 'earliest' })
    expect(body.assistance).toMatchObject({ status: 'limited', appliedPreferences: {}, selectedPlanId: null })
  })
  it.each(['Do not allow driving', 'I cannot enable driving', 'Choose earliest or cheapest', 'Maybe allow driving'])('retains original discovery settings for negated or ambiguous wording: %s', async refinement => {
    const original = { ...realRequest(), drivingAllowed: false }
    const provider = vi.fn(async () => ({ candidates: [], warnings: [] }))
    const agent: CityAgentExecutor = async ({ tools }) => {
      await tools.findTransport()
      return { status: 'limited', summary: 'Needs clarification', appliedPreferences: {}, selectedPlanId: null, activity: [] }
    }
    const response = await setup({ provider, agent }).handler(post({ request: original, investigate: true, refinement }))
    expect(response.status).toBe(200)
    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider.mock.calls[0][0]).toMatchObject({ drivingAllowed: false, priority: 'earliest' })
  })
  it('clarifies inline with exact echo, no redundant provider discovery and no saved history', async () => {
    const clarification = { field: 'hotel' as const, reason: 'unsupported' as const }
    const agent: CityAgentExecutor = async () => ({ status: 'limited', summary: 'MODEL PRIVATE TEXT', appliedPreferences: {}, selectedPlanId: null, activity: [], clarification })
    const { handler, provider } = setup({ agent })
    const conversation = { turnId: 'turn-7', baseRevision: 6, history: [{ role: 'user', content: 'PRIVATE_HISTORY' }] }
    const body = await (await handler(post({ request, investigate: true, refinement: 'Find hotel', conversation }))).json()
    expect(body.assistance).toMatchObject({ summary: cityClarificationQuestion(clarification), clarification, selectedPlanId: null, appliedPreferences: {} })
    expect(body.conversation).toEqual({ turnId: 'turn-7', baseRevision: 6 })
    expect(JSON.stringify(body)).not.toContain('PRIVATE_HISTORY')
    expect(JSON.stringify(body)).not.toContain('MODEL PRIVATE TEXT')
    expect(provider).not.toHaveBeenCalled()
  })
  it('keeps national hotel lookup honest without invoking the transport provider', async () => {
    let hotelFacts: CityProviderFacts | undefined
    const agent: CityAgentExecutor = async ({ tools }) => {
      hotelFacts = await tools.findHotels()
      return { status: 'limited', summary: 'Unavailable', appliedPreferences: {}, selectedPlanId: null, activity: [], clarification: { field: 'hotel', reason: 'unsupported' } }
    }
    const { handler, provider } = setup({ agent })
    await handler(post({ request, investigate: true, refinement: 'Find hotel' }))
    expect(hotelFacts).toEqual({ candidates: [], warnings: [expect.stringContaining('National hotel')] })
    expect(provider).not.toHaveBeenCalled()
  })
  it('retains original evidence checks and earliest expiry when sanitizing browser facts', async () => {
    const input = realRequest()
    const evidence = input.confirmedOptions[0].evidence[0]
    evidence.checkedAt = '2026-11-18T07:54:00-05:00'
    evidence.expiresAt = '2026-11-18T07:56:00-05:00'
    const body = await (await setup().handler(post({ request: input, investigate: false }))).json()
    expect(body.facts.candidates[0].evidence[0]).toMatchObject({ checkedAt: evidence.checkedAt, expiresAt: evidence.expiresAt })
    expect(Date.parse(body.facts.expiresAt)).toBe(Date.parse(evidence.expiresAt))
  })
  it('refreshes collection expiry for old manual checks without inventing a source expiry', async () => {
    const input = realRequest()
    const originalCheck = new Date(Date.parse(now()) - 6 * 60_000).toISOString()
    const evidence = input.confirmedOptions[0].evidence[0]
    evidence.type = 'traveler_confirmed'; evidence.checkedAt = originalCheck; evidence.expiresAt = null
    const response = await setup().handler(post({ request: input, investigate: false }))
    expect(response.status).toBe(200)
    const body = CityRecoveryResponseSchema.parse(await response.json())
    expect(body.result.plans[0]).toMatchObject({ selectable: true, evidenceExpiresAt: null })
    expect(body.facts.candidates[0].evidence[0]).toMatchObject({ checkedAt: originalCheck, expiresAt: null })
    expect(Date.parse(body.facts.checkedAt)).toBe(Date.parse(now()))
    expect(Date.parse(body.facts.expiresAt)).toBe(Date.parse(now()) + 300_000)
  })
  it('bounds refreshed old manual facts by fresh provider explicit expiry without renewing either source', async () => {
    const input = realRequest()
    const originalCheck = new Date(Date.parse(now()) - 6 * 60_000).toISOString()
    const manualEvidence = input.confirmedOptions[0].evidence[0]
    manualEvidence.type = 'traveler_confirmed'; manualEvidence.checkedAt = originalCheck; manualEvidence.expiresAt = null
    const candidate = { ...structuredClone(request.confirmedOptions[0]), id: 'fresh-provider' }
    const providerExpiry = new Date(Date.parse(now()) + 120_000).toISOString()
    candidate.evidence[0] = { ...candidate.evidence[0], provider: 'Google Maps Routes API', sourceUrl: 'https://routes.googleapis.com/', checkedAt: now(), expiresAt: providerExpiry }
    const provider = vi.fn(async () => ({ candidates: [candidate], warnings: [] }))
    const response = await setup({ provider }).handler(post({ request: input, investigate: true }))
    expect(response.status).toBe(200)
    const body = CityRecoveryResponseSchema.parse(await response.json())
    expect(body.facts.candidates[0].evidence[0]).toMatchObject({ checkedAt: originalCheck, expiresAt: null })
    expect(body.facts.candidates[1].evidence[0]).toMatchObject({ checkedAt: now(), expiresAt: providerExpiry })
    expect(Date.parse(body.facts.expiresAt)).toBe(Date.parse(providerExpiry))
    expect(Date.parse(body.facts.expiresAt)).toBeGreaterThan(Date.parse(now()))
  })
  it('rejects unrequested preference mutations even from an injected agent', async () => {
    const agent: CityAgentExecutor = async ({ tools }) => {
      const assessed = await tools.assess({ priority: 'cheapest' })
      return { status: 'completed', summary: 'Forged', appliedPreferences: { priority: 'cheapest' }, selectedPlanId: assessed.result.plans[0].id, activity: [] }
    }
    const body = await (await setup({ agent }).handler(post({ request, investigate: false, refinement: 'Compare' }))).json()
    expect(body.result.request.priority).toBe('earliest')
    expect(body.assistance).toMatchObject({ status: 'limited', appliedPreferences: {}, selectedPlanId: null })
  })
  it.each([
    ['Do not allow driving', { drivingAllowed: true }],
    ['I cannot enable driving', { drivingAllowed: true }],
    ['I do not want the cheapest option', { priority: 'cheapest' as const }],
  ])('retains canonical preferences when the agent contradicts %s', async (refinement, patch) => {
    const original = { ...realRequest(), drivingAllowed: false }
    const agent: CityAgentExecutor = async ({ tools }) => {
      const assessed = await tools.assess(patch)
      return { status: 'completed', summary: 'Contradicted', appliedPreferences: patch, selectedPlanId: assessed.result.plans[0].id, activity: [] }
    }
    const response = await setup({ agent }).handler(post({ request: original, investigate: false, refinement }))
    expect(response.status).toBe(200)
    const body = CityRecoveryResponseSchema.parse(await response.json())
    expect(body.result.request.drivingAllowed).toBe(false)
    expect(body.result.request.priority).toBe('earliest')
    expect(body.assistance).toMatchObject({ status: 'limited', appliedPreferences: {}, selectedPlanId: null })
  })
  it('invalidates an injected agent assessment after discovery', async () => {
    const agent: CityAgentExecutor = async ({ tools }) => {
      const assessed = await tools.assess({ priority: 'cheapest' }); await tools.findTransport()
      return { status: 'completed', summary: 'Stale', appliedPreferences: { priority: 'cheapest' }, selectedPlanId: assessed.result.plans[0].id, activity: [] }
    }
    const body = await (await setup({ agent }).handler(post({ request, investigate: true, refinement: 'Choose cheapest' }))).json()
    expect(body.assistance.status).toBe('limited')
    expect(body.result.request.priority).toBe('earliest')
  })
  it('invalidates an assessment taken while transport discovery is still pending', async () => {
    const provider = vi.fn(async () => ({ candidates: [], warnings: [] }))
    const agent: CityAgentExecutor = async ({ tools }) => {
      const discovery = tools.findTransport()
      const assessed = await tools.assess({ priority: 'cheapest' })
      await discovery
      return { status: 'completed', summary: 'Stale', appliedPreferences: { priority: 'cheapest' }, selectedPlanId: assessed.result.plans[0].id, activity: [] }
    }
    const body = await (await setup({ provider, agent }).handler(post({ request, investigate: true, refinement: 'Choose cheapest' }))).json()
    expect(body.assistance.status).toBe('limited')
    expect(body.result.request.priority).toBe('earliest')
  })
  it('bounds a provider that ignores abort at fifteen seconds and keeps manual facts', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const provider = vi.fn((_request, context) => { signal = context.signal; return new Promise<CityProviderFacts>(() => {}) })
    const pending = setup({ provider }).handler(post({ request, investigate: true }))
    await vi.advanceTimersByTimeAsync(15001)
    const response = await pending
    expect(response.status).toBe(200)
    expect(signal?.aborted).toBe(true)
    const body = await response.json()
    expect(body.facts.candidates).toHaveLength(1)
    expect(body.result.warnings.join(' ')).toContain('unavailable')
  })
  it('bounds an abort-ignoring agent within thirty seconds', async () => {
    vi.useFakeTimers()
    const agent: CityAgentExecutor = () => new Promise(() => {})
    const pending = setup({ agent }).handler(post({ request, investigate: false, refinement: 'Compare' }))
    await vi.advanceTimersByTimeAsync(30001)
    expect((await pending).status).toBe(500)
  })
  it('cancels an abort-ignoring provider and does not leak its error', async () => {
    let started = false
    const provider = vi.fn(async () => { started = true; return await new Promise<CityProviderFacts>(() => {}) })
    const controller = new AbortController()
    const pending = setup({ provider }).handler(post({ request, investigate: true }, controller.signal))
    await vi.waitFor(() => expect(started).toBe(true))
    controller.abort()
    const response = await pending
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Recovery planning is temporarily unavailable.' })
  })
  it('includes body reading in the thirty-second total budget', async () => {
    vi.useFakeTimers()
    let enqueue!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(controller) { enqueue = controller } })
    const input = new Request('https://edge.test/recovery/city', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit)
    const agent: CityAgentExecutor = () => new Promise(() => {})
    const pending = setup({ agent }).handler(input)
    await vi.advanceTimersByTimeAsync(4000)
    enqueue.enqueue(new TextEncoder().encode(JSON.stringify({ request, investigate: false, refinement: 'Compare' }))); enqueue.close()
    await vi.advanceTimersByTimeAsync(26001)
    expect((await pending).status).toBe(500)
  })
  it('memoizes failed investigation and hides raw exception content', async () => {
    const provider = vi.fn(async () => { throw new Error('PRIVATE_API_KEY=https://private.test/?secret=TOKEN') })
    const agent: CityAgentExecutor = async ({ tools }) => {
      await tools.findTransport(); await tools.findTransport()
      return { status: 'limited', summary: 'Cannot complete', appliedPreferences: {}, selectedPlanId: null, activity: [] }
    }
    const response = await setup({ provider, agent }).handler(post({ request, investigate: true, refinement: 'Compare' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(provider).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(body)).not.toContain('PRIVATE_API_KEY')
    expect(JSON.stringify(body)).not.toContain('private.test')
    expect(body.facts.candidates).toHaveLength(1)
  })
  it('rejects provider synthetic evidence in real mode and keeps original manual facts', async () => {
    const provider = vi.fn(async () => ({ candidates: fixture.request.confirmedOptions, warnings: [] }))
    const response = await setup({ provider }).handler(post({ request, investigate: true }))
    const body = CityRecoveryResponseSchema.parse(await response.json())
    expect(body.facts.candidates[0].evidence[0].type).toBe('estimated')
    expect(body.result.warnings.join(' ')).toContain('unavailable')
  })
  it('caps total candidates at twelve with original manual options first', async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(request.confirmedOptions[0]), id: `provider-${index}` }))
    const provider = vi.fn(async () => ({ candidates, warnings: [] }))
    const body = await (await setup({ provider }).handler(post({ request, investigate: true }))).json()
    expect(body.facts.candidates).toHaveLength(12)
    expect(body.facts.candidates[0].id).toBe(request.confirmedOptions[0].id)
    expect(body.result.warnings.join(' ')).toContain('12-option')
  })
  it('uses authoritative default city resolution beyond the demo corridor', async () => {
    const west = namedCityFixtures.losAngeles()
    const handler = createCityRecoveryHandler({ now })
    const response = await handler(post({ request: west.request, investigate: false }))
    expect(response.status).toBe(200)
    const body = CityRecoveryResponseSchema.parse(await response.json())
    expect(body.result.origin.name).toBe('Los Angeles')
    expect(body.result.destination.id).toBe(west.destination.id)
  })
})
