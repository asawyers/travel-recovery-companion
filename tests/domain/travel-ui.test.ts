import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { travelFixture, overnightTravelFixture } from '@domain/travel-fixtures'
import { travelRequestBinding, type TravelOnwardOffer, type TravelLeg } from '@domain/travel-contracts'
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
  it('attributes the source label and checked timestamp to every actual leg in the full journey details', async () => {
    const ui = await journeyUI(); expect(ui).not.toBeNull()
    const f = travelFixture(), journey = composeTravelJourney(f.input, f.flight, null, f)
    const html = renderToStaticMarkup(createElement(ui!.TravelJourneyCard, { journey, onSelect: () => {} }))
    const fullDetails = html.slice(html.indexOf('>Transfer details</summary>'))
    const legRegions = fullDetails.split(/data-source-leg="[^"]+"/).slice(1)
    expect(legRegions).toHaveLength(journey.legs.length)
    journey.legs.forEach((leg, index) => {
      for (const evidence of leg.evidence) {
        expect(legRegions[index]).toContain(evidence.provider)
        expect(legRegions[index]).toContain(`dateTime="${evidence.checkedAt}"`)
        expect(legRegions[index]).toContain("Last checked")
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
    expect(html).toContain('Costs and source for this leg')
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

describe('nearby onward planning presentation', () => {
  it('uses the explicit onward arrival allowance and omits an invented final city transfer', async () => {
    const ui = await factsUI(); expect(ui).not.toBeNull()
    const f = travelFixture()
    const onward = { arrivalProcessingMinutes: 45, destinationName: 'Portland, ME', kind: 'transit' as const }
    const draft = ui!.createJourneyFactsDraft(f.flight, null, null, onward)
    expect(draft.arrivalProcessingMinutes).toBe('45')
    expect(draft.destinationMinutes).toBe('1')
    const html = renderToStaticMarkup(createElement(ui!.JourneyFactsForm, { flight: f.flight, onward, onConfirm: () => {} }))
    expect(html).toContain('45-minute arrival allowance')
    expect(html).toContain('Portland, ME')
    expect(html).not.toContain('Destination transfer minutes')
  })
  it('shows actual onward legs, final city arrival and gated drive estimates', async () => {
    const ui = await import('../../src/features/travel/OnwardOffers').catch(() => null); expect(ui).not.toBeNull()
    const f = travelFixture()
    const offer = { id: 'route', flightOfferId: f.flight.id, flightFingerprint: f.flight.fingerprint, arrivalAirportIata: 'BOS', destinationCityId: f.destination.id, airportReadyAt: f.now, kind: 'drive' as const,
      legs: [{ id: 'leg', mode: 'drive' as const, from: { name: 'Boston Logan', latitude: null, longitude: null }, to: { name: 'Portland, ME', latitude: null, longitude: null }, startAt: f.now, endAt: '2026-11-18T17:00:00Z', departureTimeZone: 'America/New_York', arrivalTimeZone: 'America/New_York', operator: null, service: 'Road route estimate', vehicleId: null, assumptions: [] }], costs: f.flight.costs, evidence: f.flight.evidence, confirmations: [] }
    const html = renderToStaticMarkup(createElement(ui!.OnwardOffers, { offers: [offer], onChoose: () => {} }))
    expect(html).toContain('Final city arrival')
    expect(html).toContain('Portland, ME')
    expect(html).toContain('Driving estimate')
    expect(html).toContain('I have confirmed a vehicle and driver')
    expect(html).toMatch(/<button[^>]*disabled/)
  })
})

it('attributes Google onward content visibly and builds a canonical airport-to-city handoff with its actual travel mode', async () => {
  const ui = await import('../../src/features/travel/OnwardOffers')
  const origin = { latitude: 42.3656, longitude: -71.0096 }, destination = { latitude: 43.6591, longitude: -70.2568 }
  const href = ui.mapsRouteLink(origin, destination, 'transit')
  const url = new URL(href!)
  expect(url.origin).toBe('https://www.google.com')
  expect(url.searchParams.get('origin')).toBe('42.3656,-71.0096')
  expect(url.searchParams.get('destination')).toBe('43.6591,-70.2568')
  expect(url.searchParams.get('travelmode')).toBe('transit')
  expect(ui.mapsRouteLink({ latitude: null, longitude: null }, destination, 'drive')).toBeNull()
  const html = renderToStaticMarkup(createElement(ui.GoogleRouteAttribution, { href, fresh: () => true }))
  for (const text of ['Google Maps', 'Current tab only', 'Maps terms', 'Privacy', 'Open onward route in Google Maps']) expect(html).toContain(text)
  expect(html).toContain('rel="noopener noreferrer"')
})

it('offers BOS alongside the nearest Portland airports and retains it after explicit selection', async () => {
  const ui = await import('../../src/features/travel/TravelRecoveryPanel')
  const f = travelFixture()
  for (const to of ['PWM', 'BOS']) {
    const html = renderToStaticMarkup(createElement(ui.AirportChoices, { origin: f.origin, destination: f.destination, from: 'SAN', to, onChange: () => {} }))
    for (const airport of ['PWM', 'PSM', 'AUG', 'BOS']) expect(html).toContain(`value="${airport}"`)
    if (to === 'BOS') expect(html).toContain('value="BOS" selected=""')
  }
})


function withoutClosedDetails(html: string): string {
  let depth = 0
  return html.split(/(<details\b[^>]*>|<\/details>)/g).map(part => {
    if (/^<details\b/.test(part)) { depth++; return '' }
    if (part === '</details>') { depth--; return '' }
    return depth === 0 ? part : ''
  }).join('')
}
function walkingOnwardFixture(): TravelOnwardOffer {
  const f = travelFixture()
  const airport = { name: 'Airport terminal', latitude: 42.36, longitude: -71.01 }
  const station = { name: 'Airport bus station', latitude: 42.37, longitude: -71.02 }
  const stop = { name: 'Portland bus terminal', latitude: 43.66, longitude: -70.25 }
  const city = { name: 'Portland city center', latitude: 43.67, longitude: -70.26 }
  const leg = (id: string, mode: TravelOnwardOffer['legs'][number]['mode'], from: typeof airport, to: typeof airport, startAt: string, endAt: string, service: string) => ({
    id, mode, from, to, startAt, endAt, departureTimeZone: 'America/New_York', arrivalTimeZone: 'America/New_York',
    operator: mode === 'bus' ? 'Concord Coach' : null, service, vehicleId: mode === 'bus' ? 'coach-1' : null, assumptions: ['Check station access with luggage'],
  })
  return { id: 'walking-route', flightOfferId: f.flight.id, flightFingerprint: f.flight.fingerprint, arrivalAirportIata: 'BOS', destinationCityId: f.destination.id,
    airportReadyAt: '2026-11-19T19:30:00-05:00', kind: 'transit', legs: [
      leg('access-walk', 'walk', airport, station, '2026-11-19T19:30:00-05:00', '2026-11-19T19:37:00-05:00', 'Walk along terminal walkway'),
      leg('coach-wait', 'wait', station, station, '2026-11-19T19:37:00-05:00', '2026-11-19T19:45:00-05:00', 'Wait for coach'),
      leg('coach', 'bus', station, stop, '2026-11-19T19:45:00-05:00', '2026-11-19T21:45:00-05:00', 'Portland Express 42'),
      leg('final-walk', 'walk', stop, city, '2026-11-19T21:45:00-05:00', '2026-11-19T21:49:00-05:00', 'Walk to city center'),
    ], costs: [{ label: 'Onward coach fare', cents: 2800, currency: 'USD', includedInOtherCharge: false }], evidence: f.flight.evidence, confirmations: ['Confirm current service before travel'] }
}

describe('simplified onward route presentation', () => {
  it('shows the main coach and walking total while retaining the original route in closed transfer details', async () => {
    const ui = await import('../../src/features/travel/OnwardOffers')
    const offer = walkingOnwardFixture()
    const html = renderToStaticMarkup(createElement(ui.OnwardOffers, { offers: [offer], onChoose: () => {} }))
    const visible = withoutClosedDetails(html)
    expect(visible).toContain('Bus')
    expect(visible).toContain('Concord Coach')
    expect(visible).toContain('Portland Express 42')
    expect(visible).toContain('7:45 PM')
    expect(visible).toContain('9:45 PM')
    expect(visible).toContain('Final city arrival')
    expect(visible).toContain('Portland city center')
    expect(visible).toContain('9:49 PM')
    expect(visible).toContain('11 min walking')
    expect(visible).toContain('$28.00')
    expect(visible).toContain('2 hr 19 min')
    expect(visible).toContain('Nov 19, 2026')
    expect(visible).not.toContain('Check station access with luggage')
    expect(visible).not.toContain('Confirm current service before travel')
    expect(html.match(/Check station access with luggage/g)).toHaveLength(1)
    const routeNotes = html.match(/<details[^>]*><summary[^>]*>Route notes<\/summary>([\s\S]*?)<\/details>/)?.[1] ?? ''
    expect(routeNotes).toContain('Check station access with luggage')
    expect(routeNotes).toContain('Confirm current service before travel')
    for (const leg of offer.legs) {
      expect(html).toContain(`dateTime="${leg.startAt}"`)
      expect(html).toContain(`dateTime="${leg.endAt}"`)
    }
    for (const service of ['Walk along terminal walkway', 'Wait for coach', 'Walk to city center']) expect(visible).not.toContain(service)
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Transfer details<\/summary>/)
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|>)/)
    const details = html.slice(html.indexOf('>Transfer details</summary>'))
    for (const leg of offer.legs) expect(details).toContain(leg.service)
    expect(details).toContain('7:30 PM')
    expect(details).toContain('7:37 PM')
    expect(details.indexOf('Walk along terminal walkway')).toBeLessThan(details.indexOf('Wait for coach'))
    expect(details.indexOf('Wait for coach')).toBeLessThan(details.indexOf('Portland Express 42'))
    expect(details.indexOf('Portland Express 42')).toBeLessThan(details.indexOf('Walk to city center'))
  })
  it('uses the same concise journey timeline and keeps transfer costs, evidence, chronology and final arrival', async () => {
    const ui = await journeyUI(); expect(ui).not.toBeNull()
    const f = overnightTravelFixture(), offer = walkingOnwardFixture()
    const journey = composeTravelJourney(f.input, f.flight, f.hotel, f)
    const onward: TravelLeg[] = offer.legs.map((leg, index) => ({ ...leg, kind: leg.mode,
      from: { ...leg.from, timeZone: leg.departureTimeZone }, to: { ...leg.to, timeZone: leg.arrivalTimeZone },
      boardingId: leg.vehicleId, costs: index === 0 ? offer.costs : [], evidence: offer.evidence,
    }))
    journey.legs.splice(-1, 1, ...onward)
    journey.finalArrivalAt = offer.legs.at(-1)!.endAt
    const html = renderToStaticMarkup(createElement(ui!.TravelJourneyCard, { journey, onSelect: () => {} }))
    const visible = withoutClosedDetails(html)
    expect(visible).toContain('Portland Express 42')
    expect(visible).toContain('Concord Coach')
    expect(visible).toContain('11 min walking')
    expect(visible).toContain('9:49 PM')
    expect(visible).toContain('Example San Diego Hotel')
    expect(visible).toContain('American')
    expect(visible).toContain('processing')
    for (const service of ['Walk along terminal walkway', 'Wait for coach', 'Walk to city center']) expect(visible).not.toContain(service)
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Transfer details<\/summary>/)
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|>)/)
    const details = html.slice(html.indexOf('>Transfer details</summary>'))
    for (const leg of offer.legs) expect(details).toContain(leg.service)
    expect(details).toContain('Onward coach fare: $28.00 USD')
    expect(details).toContain('Check station access with luggage')
    expect(details).toContain(f.flight.evidence[0].provider)
    expect(details).toContain('7:37 PM')
    expect(details.indexOf('Walk along terminal walkway')).toBeLessThan(details.indexOf('Wait for coach'))
    expect(details.indexOf('Wait for coach')).toBeLessThan(details.indexOf('Portland Express 42'))
  })
})


describe('itinerary price and duration integrity', () => {
  it('keeps an unknown onward fare unknown and qualifies a partially known fare', async () => {
    const ui = await import('../../src/features/travel/OnwardOffers')
    const offer = walkingOnwardFixture()
    const unknown = { label: 'Station transfer fare', cents: null, currency: 'USD', includedInOtherCharge: false }
    const render = () => renderToStaticMarkup(createElement(ui.OnwardOffers, { offers: [offer], onChoose: () => {} }))
    offer.costs = [unknown]
    const allUnknown = withoutClosedDetails(render())
    expect(allUnknown).toContain('Price unknown')
    expect(allUnknown).toContain('total incomplete; unknown costs remain')
    expect(allUnknown).not.toContain('$0.00')
    offer.costs.push({ ...unknown, label: 'Coach fare', cents: 2800 })
    const partial = withoutClosedDetails(render())
    expect(partial).toContain('$28.00')
    expect(partial).toContain('total incomplete; unknown costs remain')
    expect(partial).toContain('2 hr 19 min')
    expect(partial).not.toContain('free')
  })

  it('retains supplied whole-journey duration and the blocked-journey guard with selected presentation', async () => {
    const ui = await journeyUI(); expect(ui).not.toBeNull()
    const f = overnightTravelFixture(), journey = composeTravelJourney(f.input, f.flight, f.hotel, f)
    const before = JSON.stringify(journey)
    const selected = renderToStaticMarkup(createElement(ui!.TravelJourneyCard, { journey, selected: true, onSelect: () => {} }))
    expect(selected).toContain('Chosen journey')
    expect(selected).toContain('Total travel time')
    expect(selected).toContain('Example San Diego Hotel')
    expect(selected).toContain(`dateTime="${journey.finalArrivalAt}"`)
    expect(JSON.stringify(journey)).toBe(before)
    const blocked = renderToStaticMarkup(createElement(ui!.TravelJourneyCard, { journey: { ...journey, selectable: false, feasibility: 'infeasible', violations: ['Connection is too short.'] }, onSelect: () => {} }))
    expect(blocked).toContain('Connection is too short.')
    expect(blocked).toMatch(/<button[^>]*disabled/)
  })
})
