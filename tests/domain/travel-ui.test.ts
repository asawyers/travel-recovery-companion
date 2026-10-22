import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { travelFixture, overnightTravelFixture } from '@domain/travel-fixtures'
import { travelRequestBinding } from '@domain/travel-contracts'
import { composeTravelJourney } from '@domain/travel-planner'
const api = () => import('../../src/lib/travel-api').catch(() => null)
const flightUI = () => import('../../src/features/travel/FlightOffers').catch(() => null)
const hotelUI = () => import('../../src/features/travel/HotelOffers').catch(() => null)
const factsUI = () => import('../../src/features/travel/JourneyFactsForm').catch(() => null)
const journeyUI = () => import('../../src/features/travel/TravelJourneyCard').catch(() => null)
const endpoint = 'https://example.com/recovery/travel'
function fixtureResponse() {
  const f = travelFixture()
  f.input.selection = null
  return { f, response: { version: 3, request: travelRequestBinding(f.input), origin: f.origin, destination: f.destination,
    generatedAt: f.now, expiresAt: f.flight.evidence[0].expiresAt!, flightOffers: f.flightOffers, hotelOffers: [],
    sourceStatuses: [], journey: null, selectionIssue: null, warnings: [] } }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('travel public client', () => {
  it('derives the endpoint and fails honestly without configured live discovery', async () => {
    const a = await api(); expect(a, 'travel API exists').not.toBeNull()
    expect(a!.travelEndpoint(undefined)).toBeNull()
    expect(a!.travelEndpoint('https://example.com/recovery/')).toBe(endpoint)
    expect(() => a!.travelEndpoint('https://user:secret@x.test')).toThrow(/configuration/i)
    const fetcher = vi.fn()
    await expect(a!.requestTravel(travelFixture().input, { endpoint: null, fetch: fetcher })).rejects.toThrow(/not configured/i)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('posts a strict exact envelope without credentials and validates the response', async () => {
    const a = await api(); expect(a).not.toBeNull()
    const { f, response } = fixtureResponse()
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response)))
    expect(await a!.requestTravel(f.input, { endpoint, fetch: fetcher })).toEqual(response)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'omit' })
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(f.input)
    await expect(a!.requestTravel({ ...f.input, extra: true } as never, { endpoint, fetch: fetcher })).rejects.toThrow(/trip facts/i)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects valid but unrelated request bindings and mismatched or unsolicited conversation echoes', async () => {
    const a = await api(); expect(a).not.toBeNull()
    const { f, response } = fixtureResponse()
    for (const candidate of [
      { ...response, request: { ...response.request, trip: { ...response.request.trip, priority: 'cheapest' } } },
      { ...response, conversation: { turnId: 'unexpected', baseRevision: 0 } },
      { ...response, debug: 'secret' },
    ]) await expect(a!.requestTravel(f.input, { endpoint, fetch: async () => new Response(JSON.stringify(candidate)) })).rejects.toThrow(/invalid|mismatch/i)
    const input = { ...f.input, conversation: { turnId: 'turn-1', baseRevision: 4, history: [] } }
    for (const echo of [undefined, { turnId: 'turn-2', baseRevision: 4 }, { turnId: 'turn-1', baseRevision: 3 }])
      await expect(a!.requestTravel(input, { endpoint, fetch: async () => new Response(JSON.stringify({ ...response, conversation: echo })) })).rejects.toThrow(/invalid|mismatch/i)
    await expect(a!.requestTravel(input, { endpoint, fetch: async () => new Response(JSON.stringify({ ...response, conversation: { turnId: 'turn-1', baseRevision: 4 } })) })).resolves.toHaveProperty('version', 3)
  })
  it('accepts only a completed soft patch authorized by the current refinement while binding hard facts exactly', async () => {
    const a = await api(); expect(a).not.toBeNull()
    const { f, response } = fixtureResponse()
    const input = { ...f.input, refinement: 'Prioritize cheapest and allow driving', conversation: { turnId: 'soft-patch', baseRevision: 2, history: [] } }
    const assistance = { status: 'completed', summary: 'Applied your preferences.', appliedPreferences: { priority: 'cheapest', drivingAllowed: true }, selectedPlanId: null, activity: [] }
    const changed = { ...response, request: { ...response.request, trip: { ...response.request.trip, priority: 'cheapest', drivingAllowed: true } }, assistance, conversation: { turnId: 'soft-patch', baseRevision: 2 } }
    const send = (value: unknown) => ({ endpoint, fetch: async () => new Response(JSON.stringify(value)) })
    await expect(a!.requestTravel(input, send(changed))).resolves.toHaveProperty('request.trip.priority', 'cheapest')
    for (const status of ['limited', 'unavailable']) await expect(a!.requestTravel(input, send({ ...changed, assistance: { ...assistance, status } }))).rejects.toThrow(/invalid|mismatch/i)
    await expect(a!.requestTravel(input, send({ ...changed, assistance: undefined }))).rejects.toThrow(/invalid|mismatch/i)
    for (const refinement of [undefined, 'Do not prioritize cheapest', 'Maybe cheapest if available', 'Show flight information'])
      await expect(a!.requestTravel({ ...input, refinement }, send(changed))).rejects.toThrow(/invalid|mismatch/i)
    for (const request of [
      { ...changed.request, trip: { ...changed.request.trip, readyAt: '2026-11-18T09:00:00-08:00' } },
      { ...changed.request, investigate: true },
      { ...changed.request, departureDate: '2026-11-20' },
      { ...changed.request, originAirportIata: 'LAX' },
      { ...changed.request, selection: travelFixture().input.selection },
    ]) {
      await expect(a!.requestTravel(input, send({ ...changed, request }))).rejects.toThrow(/invalid|mismatch/i)
    }
    const unchanged = { ...response, assistance: { ...assistance, appliedPreferences: { priority: 'earliest' } } }
    await expect(a!.requestTravel(f.input, send(unchanged))).rejects.toThrow(/invalid|mismatch/i)
    await expect(a!.requestTravel(input, send({ ...changed, conversation: { turnId: 'wrong', baseRevision: 2 } }))).rejects.toThrow(/invalid|mismatch/i)
  })
  for (const stage of ['headers', 'body']) it(`bounds stalled ${stage} even when transport ignores abort`, async () => {
    const a = await api(); expect(a).not.toBeNull(); vi.useFakeTimers()
    const fetcher: typeof fetch = async () => stage === 'headers' ? new Promise(() => {}) : new Response(new ReadableStream({ start() {} }))
    const pending = a!.requestTravel(travelFixture().input, { endpoint, fetch: fetcher }).catch(e => e)
    await vi.advanceTimersByTimeAsync(35001)
    expect(await pending).toMatchObject({ message: expect.stringMatching(/timed out/i) })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('settles caller cancellation including already-aborted signals without starting a request', async () => {
    const a = await api(); expect(a).not.toBeNull()
    const controller = new AbortController(), fetcher = vi.fn<typeof fetch>(async () => new Promise(() => {}))
    const pending = a!.requestTravel(travelFixture().input, { endpoint, signal: controller.signal, fetch: fetcher }).catch(e => e)
    controller.abort(); expect((await pending).name).toBe('AbortError')
    const before = fetcher.mock.calls.length
    await expect(a!.requestTravel(travelFixture().input, { endpoint, signal: controller.signal, fetch: fetcher })).rejects.toHaveProperty('name', 'AbortError')
    expect(fetcher).toHaveBeenCalledTimes(before)
  })
  it('bounds response bytes while streaming and hides server and transport details', async () => {
    const a = await api(); expect(a).not.toBeNull()
    for (const fetcher of [
      async () => new Response('SECRET', { status: 500 }),
      async () => { throw new Error('SECRET') },
      async () => new Response(' '.repeat(1_048_577)),
      async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(524288)); c.close() } })),
    ]) await expect(a!.requestTravel(travelFixture().input, { endpoint, fetch: fetcher })).rejects.not.toThrow(/SECRET/)
  })
})
describe('calm quote presentation', () => {
  it('shows every flight segment, connection, local dates/zones, observed charges and only a planning action', async () => {
    const ui = await flightUI(); expect(ui, 'flight presentation exists').not.toBeNull()
    const f = travelFixture()
    const html = renderToStaticMarkup(createElement(ui!.FlightOffers, { offers: [f.flight], onPlan: () => {} }))
    for (const text of ['Plan this flight', 'AA1', 'AA2', 'SAN', 'ORD', 'PWM', 'Connection', '60 minutes between flights', '2026-11-19', 'America/Chicago', 'America/Los_Angeles', 'America/New_York', '$250.00', 'Unknown', 'checked']) expect(html).toContain(text)
    expect(html).not.toMatch(/Choose this journey|Save this journey|href=/)
  })
  it('discloses exact origin stay and estimated hotel zone and unknown policies without inventing times', async () => {
    const ui = await hotelUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    const html = renderToStaticMarkup(createElement(ui!.HotelOffers, { offers: [f.hotel], onPlan: () => {} }))
    for (const text of ['2026-11-18', '2026-11-19', 'estimated', 'America/Los_Angeles', 'Check-in policy unknown', 'Checkout policy unknown', 'Cancellation policy unknown', 'Origin', 'Unknown']) expect(html).toContain(text)
    expect(html).not.toMatch(/15:00|11:00|Save this journey/)
  })
  it('exposes only allowlisted customer handoffs with a booking disclaimer', async () => {
    const ui = await flightUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    for (const [href, allowed] of [['https://www.google.com/travel/flights?q=SAN', true], ['https://evil.test/travel/flights', false], ['https://www.google.com/travel/flights?api_key=secret', false]] as const) {
      f.flight.handoffUrl = href
      const html = renderToStaticMarkup(createElement(ui!.FlightOffers, { offers: [f.flight], onPlan: () => {} }))
      expect(html.includes('target="_blank"')).toBe(allowed)
      expect(html).toContain('does not reserve')
    }
  })
})
describe('progressive journey facts', () => {
  it('starts with one short transfer step and no silent default allowances', async () => {
    const ui = await factsUI(); expect(ui, 'fact form exists').not.toBeNull()
    const f = travelFixture(), draft = ui!.createJourneyFactsDraft(f.flight, null)
    expect(draft.airportProcessingMinutes).toBe('')
    expect(draft.arrivalProcessingMinutes).toBe('')
    expect(() => ui!.buildJourneyFacts(draft, f.flight, null, f.now)).toThrow()
    const html = renderToStaticMarkup(createElement(ui!.JourneyFactsForm, { flight: f.flight, onConfirm: () => {} }))
    expect(html).toContain('Origin transfer minutes')
    expect(html).not.toContain('Hotel arrival')
    expect((html.match(/<input/g) ?? []).length).toBeLessThan(4)
  })
  it('requires explicit transfer and connection minutes, preserves blank costs as null and stamps confirmation once', async () => {
    const ui = await factsUI(); expect(ui).not.toBeNull()
    const f = travelFixture(), draft = ui!.createJourneyFactsDraft(f.flight, null)
    Object.assign(draft, { originMinutes: '30', destinationMinutes: '20', airportProcessingMinutes: '120', arrivalProcessingMinutes: '30' })
    draft.connections[0].allowanceMinutes = '45'
    const facts = ui!.buildJourneyFacts(draft, f.flight, null, f.now)
    expect(facts.originTransfer.costCents).toBeNull()
    expect(facts.destinationTransfer.costCents).toBeNull()
    expect(facts.flightExtrasCents).toBeNull()
    expect(facts.checkedAt).toBe(f.now)
    expect(facts.connections).toEqual([{ afterSegmentId: 'segment-1', allowanceMinutes: 45, airportTransfer: null }])
    const restored = ui!.createJourneyFactsDraft(f.flight, null, facts)
    expect(restored.checkedAt).toBe(f.now)
    draft.connections = []
    expect(() => ui!.buildJourneyFacts(draft, f.flight, null, f.now)).toThrow(/connection/i)
  })
  it('requires an explicit transfer for airport changes and rejects invalid or silently rounded prices', async () => {
    const ui = await factsUI(); expect(ui).not.toBeNull()
    const f = travelFixture(); f.flight.segments[1].originAirport = { ...f.flight.segments[1].originAirport, iata: 'MDW' }
    const draft = ui!.createJourneyFactsDraft(f.flight, null, f.input.selection!.facts)
    expect(() => ui!.buildJourneyFacts(draft, f.flight, null, f.now)).toThrow(/airport transfer/i)
    draft.connections[0].transferMinutes = '50'
    expect(ui!.buildJourneyFacts(draft, f.flight, null, f.now).connections[0].airportTransfer).toEqual({ minutes: 50, costCents: null })
    for (const amount of ['-1', '1.001', 'NaN', '1e2']) {
      draft.flightExtras = amount
      expect(() => ui!.buildJourneyFacts(draft, f.flight, null, f.now)).toThrow(/amount/i)
    }
  })
  it('requires hotel arrangements, exact dates, explicit check-in and strict unambiguous local times', async () => {
    const ui = await factsUI(); expect(ui).not.toBeNull()
    const f = overnightTravelFixture(), draft = ui!.createJourneyFactsDraft(f.flight, f.hotel, f.input.selection!.facts)
    draft.hotelExtras = ''
    expect(ui!.buildJourneyFacts(draft, f.flight, f.hotel, f.now).stay?.extraFeesCents).toBeNull()
    draft.arrangementsConfirmed = false
    expect(() => ui!.buildJourneyFacts(draft, f.flight, f.hotel, f.now)).toThrow(/arrangements/i)
    draft.arrangementsConfirmed = true; draft.hotelArrivalLocal = '2026-11-17T16:00'
    expect(() => ui!.buildJourneyFacts(draft, f.flight, f.hotel, f.now)).toThrow(/date/i)
    const dstHotel = { ...f.hotel, checkin: '2026-11-01', checkout: '2026-11-02' }
    draft.hotelArrivalLocal = '2026-11-01T01:30'; draft.hotelDepartureLocal = '2026-11-02T06:30'
    expect(() => ui!.buildJourneyFacts(draft, f.flight, dstHotel, f.now)).toThrow(/unambiguous/i)
    const gapHotel = { ...f.hotel, checkin: '2026-03-08', checkout: '2026-03-09' }
    draft.hotelArrivalLocal = '2026-03-08T02:30'; draft.hotelDepartureLocal = '2026-03-09T06:30'
    expect(() => ui!.buildJourneyFacts(draft, f.flight, gapHotel, f.now)).toThrow(/unambiguous/i)
  })
})
describe('complete journey presentation', () => {
  it('attributes the source label and checked timestamp to every actual leg', async () => {
    const ui = await journeyUI(); expect(ui).not.toBeNull()
    const f = travelFixture(), journey = composeTravelJourney(f.input, f.flight, null, f)
    const html = renderToStaticMarkup(createElement(ui!.TravelJourneyCard, { journey, onSelect: () => {} }))
    const legsHtml = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? ''
    const legRegions = legsHtml.split(/aria-label="Journey leg \d+"/).slice(1)
    expect(legRegions).toHaveLength(journey.legs.length)
    journey.legs.forEach((leg, index) => {
      for (const evidence of leg.evidence) {
        expect(legRegions[index]).toContain(evidence.provider)
        expect(legRegions[index]).toContain(`checked ${evidence.checkedAt}`)
      }
    })
  })
  it('renders the actual composed legs, costs, evidence, warnings and selectability guard', async () => {
    const ui = await journeyUI(); expect(ui).not.toBeNull()
    const f = travelFixture(), journey = composeTravelJourney(f.input, f.flight, null, f)
    const html = renderToStaticMarkup(createElement(ui!.TravelJourneyCard, { journey, onSelect: () => {} }))
    for (const text of ['AA1', 'AA2', 'Origin city to airport transfer', 'Destination airport to city transfer', 'Test-only quoted inventory', 'not reservations', 'Choose this journey', '$290.00']) expect(html).toContain(text)
    const blocked = renderToStaticMarkup(createElement(ui!.TravelJourneyCard, { journey: { ...journey, selectable: false, violations: ['Insufficient transfer time.'], feasibility: 'infeasible' }, onSelect: () => {} }))
    expect(blocked).toContain('Insufficient transfer time.')
    expect(blocked).toMatch(/<button[^>]*disabled/)
  })
})

describe('qualified travel summaries', () => {
  it('puts an observed flight fare beside its incomplete journey qualifier', async () => {
    const ui = await flightUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    const html = renderToStaticMarkup(createElement(ui!.FlightOffers, { offers: [f.flight], onPlan: () => {} }))
    expect(html).toContain('Observed flight fare')
    expect(html).toContain('Flight details')
    expect(html).toContain('Journey total still needs transfers and additional fees')
    expect(html).toContain('$250.00')
    for (const segment of f.flight.segments) {
      expect(html).toContain(segment.carrier)
      expect(html).toContain(segment.flightNumber)
      expect(html).toContain(segment.originAirport.timeZone)
      expect(html).toContain(segment.destinationAirport.timeZone)
    }
  })
  it('keeps an entirely unknown quote unknown instead of presenting a zero fare', async () => {
    const ui = await flightUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    f.flight.costs = [{ label: 'Flight fare unknown', cents: null, currency: 'USD', includedInOtherCharge: false }]
    const html = renderToStaticMarkup(createElement(ui!.FlightOffers, { offers: [f.flight], onPlan: () => {} }))
    expect(html).toContain('Observed flight fare')
    expect(html).toContain('Unknown')
    expect(html).not.toContain('$0.00')
  })
  it('qualifies the prominent hotel quote and retains its original charge labels', async () => {
    const ui = await hotelUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    const html = renderToStaticMarkup(createElement(ui!.HotelOffers, { offers: [f.hotel], selectedId: f.hotel.id, onPlan: () => {} }))
    expect(html).toContain('Observed overnight quote')
    expect(html).toContain('One night total quote')
    expect(html).toContain('Selected overnight')
    expect(html).toContain('Property details')
  })
  it('makes the complete journey known amount distinct from its incomplete total', async () => {
    const ui = await journeyUI(); expect(ui).not.toBeNull()
    const f = travelFixture(), journey = composeTravelJourney(f.input, f.flight, null, f)
    journey.priceComplete = false
    const html = renderToStaticMarkup(createElement(ui!.TravelJourneyCard, { journey, onSelect: () => {} }))
    expect(html).toContain('Known costs')
    expect(html).toContain('total incomplete; unknown costs remain')
    expect(html).toContain('Final city arrival')
    expect(html).toContain('Costs, assumptions and source for this leg')
  })
  it('shows a spinner only while the facts form is actually busy', async () => {
    const ui = await factsUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    const render = (busy: boolean) => renderToStaticMarkup(createElement(ui!.JourneyFactsForm, { flight: f.flight, busy, onConfirm: () => {} }))
    expect(render(true)).toContain('companion-spinner')
    expect(render(false)).not.toContain('companion-spinner')
    expect(render(false)).toContain('How long will it take you to reach')
  })
})

describe('travel request activity', () => {
  it('does not animate a disabled fact form when no request is pending', async () => {
    const ui = await factsUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    const html = renderToStaticMarkup(createElement(ui!.JourneyFactsForm, { flight: f.flight, busy: true, pending: false, onConfirm: () => {} }))
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('companion-spinner')
    expect(html).not.toContain('aria-busy="true"')
  })
})

describe('flight overview dates', () => {
  it('shows the overnight arrival local date without opening any disclosure', async () => {
    const ui = await flightUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    // The source instant is Nov 21 in UTC, but arrival is Nov 20 in New York.
    f.flight.segments.at(-1)!.arrivalAt = '2026-11-21T02:30:00Z'
    const html = renderToStaticMarkup(createElement(ui!.FlightOffers, { offers: [f.flight], onPlan: () => {} }))
    const visibleOverview = html.replace(/<details\b[\s\S]*?<\/details>/g, '').replace(/<[^>]*>/g, '')
    expect(visibleOverview).toContain('2026-11-19')
    expect(visibleOverview).toContain('2026-11-20')
    expect(visibleOverview).not.toContain('2026-11-21')
    expect(visibleOverview).toContain('21:30')
    expect(visibleOverview).toContain('Arrival local time')
    expect(html).toContain('2026-11-20 21:30 -05:00 · America/New_York')
  })
})
