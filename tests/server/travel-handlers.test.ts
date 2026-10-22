import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTravelRecoveryHandler } from '../../supabase/functions/_shared/server/travel-handlers.ts'
import { overnightTravelFixture, travelFixture } from '../../supabase/functions/_shared/domain/travel-fixtures.ts'
import {
  flightOfferFingerprint,
  TravelRecoveryResponseSchema,
  travelRequestBinding,
} from '../../supabase/functions/_shared/domain/travel-contracts.ts'
import type {
  TravelRecoveryInput,
  TravelSourceStatus,
} from '../../supabase/functions/_shared/domain/travel-contracts.ts'
import type { TravelProvider } from '../../supabase/functions/_shared/server/serpapi-travel.ts'
import type { TravelAgentExecutor } from '../../supabase/functions/_shared/server/travel-agent-contracts.ts'
const fixture = travelFixture()
const post = (input: unknown, signal?: AbortSignal) =>
  new Request('https://edge.test/recovery/travel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
function setup(
  options: {
    provider?: TravelProvider
    agent?: TravelAgentExecutor
    now?: () => string
    findCity?: Parameters<typeof createTravelRecoveryHandler>[0]['findCity']
    findAirport?: Parameters<typeof createTravelRecoveryHandler>[0]['findAirport']
  } = {},
  f = travelFixture(),
) {
  const status = (source: TravelSourceStatus['source']): TravelSourceStatus => ({
    source,
    status: 'available',
    message: 'Quotes returned',
    checkedAt: f.now,
    expiresAt: f.flight.evidence[0].expiresAt,
  })
  const provider = options.provider ??
    {
      flights: vi.fn(async () => ({
        offers: [structuredClone(f.flight)],
        sourceStatus: status('flights'),
        warnings: [],
      })),
      hotels: vi.fn(async () => ({ offers: [structuredClone(f.hotel)], sourceStatus: status('hotels'), warnings: [] })),
    }
  const airports = f.flight.segments.flatMap((s) => [s.originAirport, s.destinationAirport])
  const handler = createTravelRecoveryHandler({
    now: () => f.now,
    findCity: (id) => [f.origin, f.destination].find((c) => c.id === id) ?? null,
    findAirport: (iata) => airports.find((a) => a.iata === iata),
    ...options,
    provider,
  })
  return { handler, provider, input: { ...structuredClone(f.input), investigate: true } }
}
const bodyOf = async (response: Response) => {
  expect(response.status).toBe(200)
  return TravelRecoveryResponseSchema.parse(await response.json())
}
afterEach(() => vi.useRealTimers())
describe('public travel recovery handler', () => {
  it('serves public POST and exact binding with authoritative locations and unmodified quote evidence', async () => {
    const { handler, input, provider } = setup()
    const response = await handler(post(input))
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    const body = await bodyOf(response)
    expect(body.request).toEqual(travelRequestBinding(input))
    expect(body.origin).toEqual(fixture.origin)
    expect(body.journey?.selectable).toBe(true)
    expect(body.flightOffers[0].evidence).toEqual(fixture.flight.evidence)
    expect(provider.flights).toHaveBeenCalledTimes(1)
    expect(provider.hotels).not.toHaveBeenCalled()
    expect(Date.parse(body.expiresAt)).toBe(Date.parse(fixture.flight.evidence[0].expiresAt!))
  })
  it('responds to OPTIONS and rejects unsupported methods without invoking dependencies', async () => {
    const { handler, provider } = setup()
    expect((await handler(new Request('https://edge.test/recovery/travel', { method: 'OPTIONS' }))).status).toBe(204)
    const response = await handler(new Request('https://edge.test/recovery/travel'))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
    expect(provider.flights).not.toHaveBeenCalled()
  })
  it.each([['unknown field', { ...fixture.input, forged: true }], ['browser metadata', {
    ...fixture.input,
    origin: fixture.origin,
  }], ['noncanonical city', {
    ...fixture.input,
    trip: { ...fixture.input.trip, originCityId: 'geonames:0005391811' },
  }]])('rejects invalid public input: %s', async (_name, input) => {
    expect((await setup().handler(post(input))).status).toBe(400)
  })
  it('rejects aliases returned by city and airport resolvers', async () => {
    expect((await setup({ findCity: () => fixture.destination }).handler(post(fixture.input))).status).toBe(400)
    expect(
      (await setup({ findAirport: () => fixture.flight.segments[0].originAirport }).handler(post(fixture.input)))
        .status,
    ).toBe(400)
  })
  it('does not investigate without explicit opt-in and never invents quotes', async () => {
    const { handler, provider } = setup()
    const body = await bodyOf(await handler(post(fixture.input)))
    expect(provider.flights).not.toHaveBeenCalled()
    expect(provider.hotels).not.toHaveBeenCalled()
    expect(body.flightOffers).toEqual([])
    expect(body.journey).toBeNull()
    expect(body.selectionIssue).toBe('flight_missing')
  })
  it('keeps absent provider configuration honest', async () => {
    const { input } = setup()
    const response = await createTravelRecoveryHandler({ now: () => fixture.now })(post(input))
    const body = await bodyOf(response)
    expect(body.flightOffers).toEqual([])
    expect(body.sourceStatuses[0].status).toBe('unavailable')
  })
  it('limits streamed bodies and requires valid JSON content', async () => {
    const { handler } = setup()
    expect(
      (await handler(
        new Request('https://edge.test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: ' '.repeat(65537),
        }),
      )).status,
    ).toBe(413)
    expect((await handler(new Request('https://edge.test', { method: 'POST', body: '{}' }))).status).toBe(400)
    expect(
      (await handler(
        new Request('https://edge.test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        }),
      )).status,
    ).toBe(400)
  })
})
describe('travel provider boundary and freshness', () => {
  it.each(['binding', 'airport', 'source', 'synthetic', 'future', 'expired', 'malformed'] as const)(
    'turns %s provider data into a fixed unavailable result',
    async (kind) => {
      const f = travelFixture(), offer = structuredClone(f.flight)
      const status: TravelSourceStatus = {
        source: 'flights',
        status: 'available',
        message: 'PRIVATE_PROVIDER_PAYLOAD',
        checkedAt: f.now,
        expiresAt: offer.evidence[0].expiresAt,
      }
      if (kind === 'binding') offer.destinationCityId = f.origin.id
      if (kind === 'airport') {
        offer.segments[0].destinationAirport.latitude = 1
        offer.segments[1].originAirport.latitude = 1
        offer.fingerprint = flightOfferFingerprint(offer)
      }
      if (kind === 'source') status.source = 'hotels'
      if (kind === 'synthetic') Object.assign(offer.evidence[0], { type: 'synthetic', environment: 'synthetic' })
      if (kind === 'future') offer.evidence[0].checkedAt = '2026-11-18T06:01:00-08:00'
      if (kind === 'expired') offer.evidence[0].expiresAt = f.now
      const provider = {
        flights: vi.fn(async () =>
          kind === 'malformed'
            ? { PRIVATE_PROVIDER_PAYLOAD: 'secret' }
            : ({ offers: [offer], sourceStatus: status, warnings: ['PRIVATE_PROVIDER_PAYLOAD'] })
        ),
        hotels: vi.fn(),
      } as unknown as TravelProvider
      const { handler, input } = setup({ provider }, f)
      const body = await bodyOf(await handler(post(input)))
      expect(body.flightOffers).toEqual([])
      expect(body.journey).toBeNull()
      expect(body.sourceStatuses[0].status).toBe('unavailable')
      expect(JSON.stringify(body)).not.toContain('PRIVATE_PROVIDER_PAYLOAD')
      if (kind === 'expired') expect(body.selectionIssue).toBe('expired')
    },
  )
  it('requires reselection after reprice or missing quote', async () => {
    const f = travelFixture()
    f.flight.costs[0].cents = 35000
    f.flight.fingerprint = flightOfferFingerprint(f.flight)
    const { handler, input } = setup({}, f)
    expect((await bodyOf(await handler(post(input)))).selectionIssue).toBe('flight_changed')
    input.selection!.flightOfferId = 'missing'
    expect((await bodyOf(await handler(post(input)))).selectionIssue).toBe('flight_missing')
  })
  it('evaluates original evidence after HTTP completes and retains original observation and expiry', async () => {
    const f = travelFixture()
    let current = f.now
    const provider: TravelProvider = {
      flights: vi.fn(async () => {
        current = '2026-11-18T06:05:01-08:00'
        return {
          offers: [f.flight],
          sourceStatus: {
            source: 'flights',
            status: 'available',
            message: 'Quote',
            checkedAt: f.now,
            expiresAt: f.flight.evidence[0].expiresAt,
          },
          warnings: [],
        }
      }),
      hotels: vi.fn(),
    }
    const body = await bodyOf(
      await setup({ provider, now: () => current }, f).handler(post({ ...f.input, investigate: true })),
    )
    expect(body.selectionIssue).toBe('expired')
    expect(body.flightOffers).toEqual([])
    expect(body.sourceStatuses[0]).toMatchObject({
      status: 'unavailable',
      checkedAt: f.now,
      expiresAt: f.flight.evidence[0].expiresAt,
    })
    expect(Date.parse(body.expiresAt)).toBeLessThanOrEqual(Date.parse(f.flight.evidence[0].expiresAt!))
  })
  it('retains six-minute-old traveler facts with fresh source quotes and rejects unknown hard-budget costs', async () => {
    const f = travelFixture()
    const original = '2026-11-18T05:54:00-08:00'
    f.input.selection!.facts.checkedAt = original
    const { handler, input } = setup({}, f)
    const body = await bodyOf(await handler(post(input)))
    expect(body.journey?.selectable).toBe(true)
    expect(body.request.selection!.facts.checkedAt).toBe(original)
    input.trip.budgetMode = 'hard'
    input.trip.budgetCents = 100000
    input.selection!.facts.destinationTransfer.costCents = null
    const uncertain = await bodyOf(await handler(post(input)))
    expect(uncertain.journey?.selectable).toBe(false)
    expect(uncertain.journey?.priceComplete).toBe(false)
  })
  it('starts explicitly requested flight and hotel discovery concurrently', async () => {
    const f = overnightTravelFixture()
    let flightsStarted = false, hotelsStarted = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const base = setup({}, f)
    const provider: TravelProvider = {
      flights: async (...args) => {
        flightsStarted = true
        await gate
        return base.provider.flights(...args)
      },
      hotels: async (...args) => {
        hotelsStarted = true
        await gate
        return base.provider.hotels(...args)
      },
    }
    const pending = setup({ provider }, f).handler(post(base.input))
    await vi.waitFor(() => {
      expect(flightsStarted).toBe(true)
      expect(hotelsStarted).toBe(true)
    })
    release()
    const body = await bodyOf(await pending)
    expect(body.journey?.hotelOfferId).toBe(f.hotel.id)
    expect(body.journey?.selectable).toBe(true)
  })
})
describe('travel agent authorization', () => {
  it('memoizes repeated discovery including failures and adapts provider sourceStatus for SDK tools', async () => {
    let sdkSource: string | undefined
    const agent: TravelAgentExecutor = async ({ tools }) => {
      const first = await tools.findFlights()
      await tools.findFlights()
      sdkSource = first.status.source
      const assessed = await tools.assess({})
      return {
        status: 'completed',
        summary: 'Verified',
        appliedPreferences: {},
        selectedPlanId: assessed.result.journey!.id,
        activity: [],
      }
    }
    const { handler, input, provider } = setup({ agent })
    const body = await bodyOf(await handler(post({ ...input, refinement: 'Compare' })))
    expect(sdkSource).toBe('flights')
    expect(provider.flights).toHaveBeenCalledTimes(1)
    expect(body.assistance?.status).toBe('completed')
    const broken: TravelProvider = {
      flights: vi.fn(async () => {
        throw new Error('PRIVATE_KEY')
      }),
      hotels: vi.fn(),
    }
    const failedAgent: TravelAgentExecutor = async ({ tools }) => {
      await tools.findFlights()
      await tools.findFlights()
      return { status: 'limited', summary: 'No result', appliedPreferences: {}, selectedPlanId: null, activity: [] }
    }
    const failed = await bodyOf(
      await setup({ agent: failedAgent, provider: broken }).handler(post({ ...input, refinement: 'Compare' })),
    )
    expect(broken.flights).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_KEY')
  })
  it('cannot discover hotels or flights without current request permission', async () => {
    const agent: TravelAgentExecutor = async ({ tools }) => {
      await tools.findFlights()
      await tools.findHotels()
      return { status: 'limited', summary: 'Done', appliedPreferences: {}, selectedPlanId: null, activity: [] }
    }
    const { handler, provider } = setup({ agent })
    await bodyOf(await handler(post({ ...fixture.input, refinement: 'Find hotels' })))
    expect(provider.flights).not.toHaveBeenCalled()
    expect(provider.hotels).not.toHaveBeenCalled()
  })
  it('accepts only an explicitly authorized soft patch after verified assessment with exact echo', async () => {
    const agent: TravelAgentExecutor = async ({ input, tools }) => {
      input.trip.budgetCents = 1
      input.selection!.facts.originTransfer.minutes = 1
      await tools.findFlights()
      const assessed = await tools.assess({ priority: 'cheapest' })
      return {
        status: 'completed',
        summary: 'Assessed',
        appliedPreferences: { priority: 'cheapest' },
        selectedPlanId: assessed.result.journey!.id,
        activity: [],
      }
    }
    const { handler, input } = setup({ agent })
    const conversation = {
      turnId: 'turn-7',
      baseRevision: 6,
      history: [{ role: 'user' as const, content: 'PRIVATE_HISTORY' }],
    }
    const body = await bodyOf(await handler(post({ ...input, refinement: 'Choose cheapest', conversation })))
    expect(body.request.trip).toEqual({ ...input.trip, priority: 'cheapest' })
    expect(body.request.selection).toEqual(input.selection)
    expect(body.conversation).toEqual({ turnId: 'turn-7', baseRevision: 6 })
    expect(JSON.stringify(body)).not.toContain('PRIVATE_HISTORY')
    expect(body.assistance?.status).toBe('completed')
  })
  it.each(['unrequested', 'unknown-plan', 'stale-assessment', 'hard-fact'] as const)(
    'rejects injected %s recommendation and restores original preferences',
    async (kind) => {
      const agent: TravelAgentExecutor = async ({ tools }) => {
        await tools.findFlights()
        const patch = kind === 'hard-fact' ? { budgetCents: 1 } : { priority: 'cheapest' }
        const assessed = await tools.assess(patch as never)
        if (kind === 'stale-assessment') await tools.findFlights()
        return {
          status: 'completed',
          summary: 'Forged',
          appliedPreferences: patch,
          selectedPlanId: kind === 'unknown-plan' ? 'unknown' : assessed.result.journey!.id,
          activity: [],
        } as never
      }
      const { handler, input } = setup({ agent })
      const body = await bodyOf(
        await handler(post({ ...input, refinement: kind === 'unrequested' ? 'Compare' : 'Choose cheapest' })),
      )
      expect(body.request.trip).toEqual(input.trip)
      expect(body.assistance).toMatchObject({ status: 'limited', appliedPreferences: {}, selectedPlanId: null })
    },
  )
  it('uses fixed clarification wording with no hidden searches and exact conversation echo', async () => {
    const agent: TravelAgentExecutor = async () => ({
      status: 'limited',
      summary: 'PRIVATE_MODEL_PAYLOAD',
      appliedPreferences: {},
      selectedPlanId: null,
      activity: [],
      clarification: { field: 'transfer', reason: 'required' },
    })
    const { handler, input, provider } = setup({ agent })
    const body = await bodyOf(
      await handler(
        post({ ...input, refinement: 'Help', conversation: { turnId: 'turn-2', baseRevision: 1, history: [] } }),
      ),
    )
    expect(body.assistance?.summary).toContain('Please confirm the transfer durations')
    expect(JSON.stringify(body)).not.toContain('PRIVATE_MODEL_PAYLOAD')
    expect(provider.flights).not.toHaveBeenCalled()
    expect(body.conversation).toEqual({ turnId: 'turn-2', baseRevision: 1 })
  })
})
describe('travel request time budgets', () => {
  it('bounds abort-ignoring providers at the shared twenty-second budget', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const provider: TravelProvider = {
      flights: (_input, context) => {
        signal = context.signal
        return new Promise(() => {})
      },
      hotels: vi.fn(),
    }
    const { handler, input } = setup({ provider })
    const pending = handler(post(input))
    await vi.advanceTimersByTimeAsync(20001)
    const body = await bodyOf(await pending)
    expect(signal?.aborted).toBe(true)
    expect(body.sourceStatuses[0].status).toBe('unavailable')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('includes body reading in the thirty-second abort-ignoring agent budget', async () => {
    vi.useFakeTimers()
    let writer!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writer = controller
      },
    })
    const agent: TravelAgentExecutor = () => new Promise(() => {})
    const request = new Request(
      'https://edge.test',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit,
    )
    const pending = setup({ agent }).handler(request)
    await vi.advanceTimersByTimeAsync(4000)
    writer.enqueue(new TextEncoder().encode(JSON.stringify({ ...fixture.input, refinement: 'Compare' })))
    writer.close()
    await vi.advanceTimersByTimeAsync(26001)
    expect((await pending).status).toBe(500)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels an abort-ignoring provider and removes timers without leaking exceptions', async () => {
    vi.useFakeTimers()
    let started = false
    const provider: TravelProvider = {
      flights: () => {
        started = true
        return new Promise(() => {})
      },
      hotels: vi.fn(),
    }
    const controller = new AbortController()
    const { handler, input } = setup({ provider })
    const pending = handler(post(input, controller.signal))
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toBe(true)
    controller.abort()
    const response = await pending
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Travel recovery planning is temporarily unavailable.' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('returns the existing five-second body timeout', async () => {
    vi.useFakeTimers()
    const stream = new ReadableStream<Uint8Array>({ start() {} })
    const pending = setup().handler(
      new Request(
        'https://edge.test',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: stream,
          duplex: 'half',
        } as RequestInit,
      ),
    )
    await vi.advanceTimersByTimeAsync(5001)
    expect((await pending).status).toBe(408)
    expect(vi.getTimerCount()).toBe(0)
  })
})
describe('travel integration ordering', () => {
  it('reacquires selected quotes before an assess-first SDK call', async () => {
    const agent: TravelAgentExecutor = async ({ tools }) => {
      const assessed = await tools.assess({})
      return {
        status: 'completed',
        summary: 'Assessed',
        appliedPreferences: {},
        selectedPlanId: assessed.result.journey!.id,
        activity: [],
      }
    }
    const { handler, input, provider } = setup({ agent })
    const body = await bodyOf(await handler(post({ ...input, refinement: 'Compare' })))
    expect(body.assistance?.status).toBe('completed')
    expect(body.journey?.selectable).toBe(true)
    expect(provider.flights).toHaveBeenCalledTimes(1)
  })
  it('never invokes hotel providers for SDK hotel requests without a planned overnight', async () => {
    const agent: TravelAgentExecutor = async ({ tools }) => {
      await tools.findHotels()
      const assessed = await tools.assess({})
      return {
        status: 'completed',
        summary: 'Assessed',
        appliedPreferences: {},
        selectedPlanId: assessed.result.journey!.id,
        activity: [],
      }
    }
    const { handler, input, provider } = setup({ agent })
    await bodyOf(await handler(post({ ...input, refinement: 'Compare' })))
    expect(provider.hotels).not.toHaveBeenCalled()
    expect(provider.flights).toHaveBeenCalledTimes(1)
  })
  it('does not renew a provider budget when the SDK requests another source later', async () => {
    vi.useFakeTimers()
    const f = overnightTravelFixture()
    let hotelSignal: AbortSignal | undefined
    const base = setup({}, f)
    const provider: TravelProvider = {
      flights: (...args) =>
        new Promise((resolve) => setTimeout(() => void base.provider.flights(...args).then(resolve), 19000)),
      hotels: (_input, context) => {
        hotelSignal = context.signal
        return new Promise(() => {})
      },
    }
    const agent: TravelAgentExecutor = async ({ tools }) => {
      await tools.findFlights()
      await tools.findHotels()
      return { status: 'limited', summary: 'Done', appliedPreferences: {}, selectedPlanId: null, activity: [] }
    }
    const pending = setup({ provider, agent }, f).handler(post({ ...base.input, refinement: 'Compare' }))
    await vi.advanceTimersByTimeAsync(20001)
    const body = await bodyOf(await pending)
    expect(hotelSignal?.aborted).toBe(true)
    expect(body.sourceStatuses.find((s) => s.source === 'hotels')?.status).toBe('unavailable')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels a pending body read immediately and clears its five-second timer', async () => {
    vi.useFakeTimers()
    let canceled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true
      },
    })
    const controller = new AbortController()
    const request = new Request(
      'https://edge.test',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stream,
        signal: controller.signal,
        duplex: 'half',
      } as RequestInit,
    )
    const pending = setup().handler(request)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    expect((await pending).status).toBe(500)
    expect(canceled).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
describe('final travel response freshness', () => {
  it('withdraws a completed recommendation when its quote expires after assessment and restores original soft preferences', async () => {
    const f = travelFixture()
    let current = '2026-11-18T06:04:59-08:00'
    const agent: TravelAgentExecutor = async ({ tools }) => {
      const assessed = await tools.assess({ priority: 'cheapest' })
      expect(assessed.result.journey?.selectable).toBe(true)
      current = '2026-11-18T06:05:01-08:00'
      return {
        status: 'completed',
        summary: 'Prior recommendation',
        appliedPreferences: { priority: 'cheapest' },
        selectedPlanId: assessed.result.journey!.id,
        activity: [],
      }
    }
    const { handler, input, provider } = setup({ agent, now: () => current }, f)
    const body = await bodyOf(await handler(post({ ...input, refinement: 'Choose cheapest' })))
    expect(body.generatedAt).toBe(current)
    expect(body.request).toEqual(travelRequestBinding(input))
    expect(body.assistance).toMatchObject({ status: 'limited', appliedPreferences: {}, selectedPlanId: null })
    expect(body.journey).toBeNull()
    expect(body.selectionIssue).toBe('expired')
    expect(body.flightOffers).toEqual([])
    expect(body.sourceStatuses[0]).toMatchObject({
      status: 'unavailable',
      checkedAt: f.now,
      expiresAt: f.flight.evidence[0].expiresAt,
    })
    expect(Date.parse(body.expiresAt)).toBeLessThanOrEqual(Date.parse(f.flight.evidence[0].expiresAt!))
    expect(provider.flights).toHaveBeenCalledTimes(1)
  })
})
