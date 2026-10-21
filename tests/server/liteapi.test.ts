import { describe, expect, it, vi } from 'vitest'
import { createLiteApiAdapter } from '../../supabase/functions/_shared/server/liteapi.ts'
import { overnightFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { HotelOptionSchema } from '../../supabase/functions/_shared/domain/schemas.ts'
import { sumCosts } from '../../supabase/functions/_shared/domain/time.ts'
const NOW = '2026-11-19T02:55:00Z'
const signal = () => new AbortController().signal
const request = () => ({ ...overnightFixture().request, mode: 'real' as const, confirmedOptions: [] })
function reply() {
  return { sandbox: false, data: [{ hotelId: 'lp-hotel', roomTypes: [{ offerId: 'private-offer-token', offerRetailRate: { amount: 125.25, currency: 'USD' }, suggestedSellingPrice: [{ amount: 120, currency: 'USD' }], rates: [{ name: 'Standard queen', boardName: 'Room Only', adultCount: 1, childCount: 0, occupancyNumber: 1, retailRate: { total: [{ amount: 125.25, currency: 'USD' }], taxesAndFees: null as unknown }, cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [{ cancelTime: '2026-11-18 20:00:00', amount: 125.25, currency: 'USD', type: 'amount', timezone: 'GMT' }] } }] }] }], hotels: [{ id: 'lp-hotel', name: 'Airport Hotel', address: '1 Airport Road, Boston, MA' }] }
}
function fetcher(replies: unknown[] = [reply()]) { return vi.fn<typeof fetch>(async () => Response.json(replies.shift() ?? {})) }
const adapter = (fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) => createLiteApiAdapter({ enabled: true, apiKey: 'prod-fixture-key', environment: 'production', publicRatesApproved: true, now: () => NOW, fetcher: fetch, ...extra })
async function offers(body = reply(), extra: Record<string, unknown> = {}) {
  const result = await adapter(fetcher([body]), extra)(request(), { signal: signal() })
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') throw new Error('expected hotel facts')
  return result
}
// Invented response fixtures only: these tests never contact a hotel provider.
describe('bounded LiteAPI availability adapter', () => {
  it('searches exactly one adult room night at BOS and preserves rate, room, cancellation and provenance', async () => {
    const fetch = fetcher(); const result = await adapter(fetch)(request(), { signal: signal() })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('expected facts')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.liteapi.travel/v3.0/hotels/rates')
    expect(init?.method).toBe('POST'); expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('X-API-Key')).toBe('prod-fixture-key')
    expect(JSON.parse(String(init?.body))).toEqual({ checkin: '2026-11-18', checkout: '2026-11-19', currency: 'USD', guestNationality: 'US', occupancies: [{ adults: 1, children: [] }], iataCode: 'BOS', limit: 3, maxRatesPerHotel: 1, includeHotelData: true, timeout: 6 })
    expect(result.data.offers).toHaveLength(1)
    const hotel = result.data.offers[0]
    expect(HotelOptionSchema.safeParse(hotel).success).toBe(true)
    expect(hotel).toMatchObject({ id: 'lp-hotel', room: 'Standard queen', board: 'Room Only', lateCheckinConfirmed: false, quoteExpiresAt: null, handoffId: 'hotel-search', cancellation: { deadlineAt: '2026-11-18T20:00:00Z' } })
    expect(hotel.evidence[0]).toMatchObject({ type: 'live', environment: 'production', checkedAt: NOW, serviceDate: '2026-11-18', providerUpdatedAt: null, expiresAt: '2026-11-19T03:00:00.000Z' })
    expect(hotel.evidence[0].warnings.join(' ')).toMatch(/app.*freshness|application.*freshness/i)
    expect(sumCosts(hotel.costs)).toMatchObject({ knownCostCents: 12525, priceComplete: true })
    expect(JSON.stringify(result)).not.toMatch(/prod-fixture-key|private-offer-token/)
  })
  it.each([{ enabled: false }, { apiKey: undefined }, { apiKey: ' ' }, { apiKey: 'sand_fixture' }, { apiKey: 'sandbox_fixture' }, { environment: 'sandbox' }, { publicRatesApproved: false }])('does not call without production activation and public pricing approval: %j', async extra => {
    const fetch = fetcher(); expect((await adapter(fetch, extra)(request(), { signal: signal() })).status).toBe('unavailable'); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['synthetic', 'disallowed', 'no-stay', 'two-nights', 'missing-nationality', 'two-adults', 'two-rooms'])('does not call for unsupported request %s', async scenario => {
    const req = request()
    if (scenario === 'synthetic') req.mode = 'synthetic' as never
    if (scenario === 'disallowed') req.overnightAllowed = false
    if (scenario === 'no-stay') req.stay = null
    if (scenario === 'two-nights') req.stay!.checkout = '2026-11-20'
    if (scenario === 'missing-nationality') delete (req.stay as { guestNationality?: string }).guestNationality
    if (scenario === 'two-adults') req.stay!.adults = 2 as never
    if (scenario === 'two-rooms') req.stay!.rooms = 2 as never
    const fetch = fetcher(); expect((await adapter(fetch)(req, { signal: signal() })).status).toBe('unavailable'); expect(fetch).not.toHaveBeenCalled()
  })
  it('checks cancellation before making any request', async () => {
    const fetch = fetcher(); const controller = new AbortController(); controller.abort()
    expect((await adapter(fetch)(request(), { signal: controller.signal })).status).toBe('unavailable'); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['true', 'absent'])('rejects %s sandbox provenance', async value => {
    const body = reply(); if (value === 'true') body.sandbox = true; else delete (body as { sandbox?: boolean }).sandbox
    expect((await adapter(fetcher([body]))(request(), { signal: signal() })).status).not.toBe('ok')
  })
  it.each(['no-room', 'two-rates', 'bad-occupancy', 'bad-child', 'bad-room-index', 'contradictory-total', 'non-usd', 'fraction-cent', 'discounted', 'malformed-ssp'])('omits unsafe %s offers', async scenario => {
    const body = reply(); const room = body.data[0].roomTypes[0]; const rate = room.rates[0]
    if (scenario === 'no-room') body.data[0].roomTypes = []
    if (scenario === 'two-rates') room.rates.push(structuredClone(rate))
    if (scenario === 'bad-occupancy') rate.adultCount = 2
    if (scenario === 'bad-child') rate.childCount = 1
    if (scenario === 'bad-room-index') rate.occupancyNumber = 2
    if (scenario === 'contradictory-total') room.offerRetailRate.amount = 100
    if (scenario === 'non-usd') rate.retailRate.total[0].currency = 'EUR'
    if (scenario === 'fraction-cent') rate.retailRate.total[0].amount = 125.251
    if (scenario === 'discounted') room.suggestedSellingPrice[0].amount = 140
    if (scenario === 'malformed-ssp') room.suggestedSellingPrice[0].amount = -1
    const fetch = fetcher([body]); expect((await adapter(fetch)(request(), { signal: signal() })).status).not.toBe('ok'); expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('accepts the documented offer-level SSP object and checks rate-level SSP arrays', async () => {
    const body = reply()
    ;(body.data[0].roomTypes[0] as unknown as Record<string, unknown>).suggestedSellingPrice = { amount: 120, currency: 'USD' }
    const result = await offers(body); expect(result.data.offers).toHaveLength(1)
    ;(body.data[0].roomTypes[0].rates[0] as unknown as Record<string, unknown>).suggestedSellingPrice = [{ amount: 150, currency: 'USD' }]
    expect((await adapter(fetcher([body]))(request(), { signal: signal() })).status).not.toBe('ok')
  })
  it('preserves unsupported cancellation type and amount as text without interpreting a deadline', async () => {
    const body = reply(); const policy = body.data[0].roomTypes[0].rates[0].cancellationPolicies.cancelPolicyInfos[0]
    policy.type = 'percentage'; policy.amount = 80
    const result = await offers(body)
    expect(result.data.offers[0].cancellation).toMatchObject({ deadlineAt: null, penalty: null })
    expect(result.data.offers[0].cancellation?.text).toMatch(/80.*percentage|percentage.*80/)
  })
  it('adds pay-at-property charges once and retains included fee metadata', async () => {
    const body = reply(); body.data[0].roomTypes[0].rates[0].retailRate.taxesAndFees = [{ included: true, description: 'Tax', amount: 12, currency: 'USD' }, { included: false, description: 'Property fee', amount: 5.25, currency: 'USD' }]
    const result = await offers(body); const costs = result.data.offers[0].costs
    expect(costs).toContainEqual({ label: 'Tax', cents: 1200, currency: 'USD', includedInOtherCharge: true })
    expect(sumCosts(costs)).toMatchObject({ knownCostCents: 13050, priceComplete: true })
  })
  it.each([undefined, [], [{ included: false, description: 'Unknown fee' }], [{ included: false, description: 'Foreign fee', amount: 3, currency: 'EUR' }]])('retains incomplete fee information as an unknown payable line: %j', async fees => {
    const body = reply(); body.data[0].roomTypes[0].rates[0].retailRate.taxesAndFees = fees
    const result = await offers(body); expect(sumCosts(result.data.offers[0].costs).priceComplete).toBe(false)
  })
  it('preserves ambiguous cancellation policy text without inventing a timezone', async () => {
    const body = reply(); body.data[0].roomTypes[0].rates[0].cancellationPolicies.cancelPolicyInfos[0].timezone = 'EST'
    const result = await offers(body); expect(result.data.offers[0].cancellation?.deadlineAt).toBeNull(); expect(result.data.offers[0].cancellation?.text).toMatch(/EST/)
  })
  it('does at most one property lookup for the leading otherwise valid hotel and requires matching identity', async () => {
    const body = reply(); body.hotels = []
    const fetch = fetcher([body, { data: { id: 'lp-hotel', name: 'Airport Hotel', address: '1 Airport Road, Boston, MA' } }])
    const result = await adapter(fetch)(request(), { signal: signal() }); expect(result.status).toBe('ok'); expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe('https://api.liteapi.travel/v3.0/data/hotel?hotelId=lp-hotel')
    const wrong = await adapter(fetcher([body, { data: { id: 'other', name: 'Wrong hotel', address: 'Somewhere' } }]))(request(), { signal: signal() })
    expect(wrong.status).not.toBe('ok')
  })
  it('caps normalized output at three hotels and one offer per property', async () => {
    const body = reply(); body.data = Array.from({ length: 6 }, (_, i) => ({ ...structuredClone(body.data[0]), hotelId: `lp-${i}` })); body.hotels = body.data.map(h => ({ id: h.hotelId, name: h.hotelId, address: 'Boston address' }))
    const result = await offers(body); expect(result.data.offers).toHaveLength(3)
  })
  it.each(['https://hotels.example.test', 'https://hotels.example.test/'])('uses hotel-specific handoff only for configured exact HTTPS origin %s', async bookingOrigin => {
    expect((await offers(reply(), { bookingOrigin })).data.offers[0].handoffId).toBe('nuitee-hotel')
  })
  it.each(['http://hotels.example.test', 'https://user:pass@hotels.example.test', 'https://hotels.example.test/path', 'https://hotels.example.test?x=1'])('falls back to hotel search for invalid booking origin %s', async bookingOrigin => {
    expect((await offers(reply(), { bookingOrigin })).data.offers[0].handoffId).toBe('hotel-search')
  })
  it.each([429, 500])('fails safely on HTTP %s without retry or provider payload exposure', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('SECRET', { status }))
    const result = await adapter(fetch)(request(), { signal: signal() }); expect(result.status).toBe('unavailable'); expect(fetch).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toMatch(/SECRET|fixture-key/)
  })
  it('rejects malformed data without leaking provider values', async () => {
    const result = await adapter(fetcher([{ sandbox: false, data: 'SECRET' }]))(request(), { signal: signal() })
    expect(result.status).not.toBe('ok'); expect(JSON.stringify(result)).not.toContain('SECRET')
  })
})


describe('labeled LiteAPI sandbox availability', () => {
  const sandboxRequest = () => ({ ...request(), mode: 'synthetic' as const, hotelDataMode: 'sandbox' as const })
  const sandboxAdapter = (fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) => adapter(fetch, { environment: 'sandbox', apiKey: 'sand_fixture-key', publicRatesApproved: false, ...extra })
  const sandboxReply = () => ({ ...reply(), sandbox: true })
  const sandboxContext = () => ({ signal: signal(), hotelSandbox: true })

  it('normalizes explicit test rates with sandbox provenance, bounded search and no production handoff', async () => {
    const body = sandboxReply(); body.data[0].roomTypes[0].rates[0].retailRate.taxesAndFees = []
    const fetch = fetcher([body])
    const result = await sandboxAdapter(fetch, { bookingOrigin: 'https://hotels.example.test' })(sandboxRequest(), sandboxContext())
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('expected sandbox facts')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://api.liteapi.travel/v3.0/hotels/rates')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ limit: 3, maxRatesPerHotel: 1, includeHotelData: true, occupancies: [{ adults: 1, children: [] }] })
    const hotel = result.data.offers[0]
    expect(hotel.handoffId).toBe('hotel-search')
    expect(hotel.evidence[0]).toMatchObject({ type: 'estimated', environment: 'sandbox', checkedAt: NOW, expiresAt: '2026-11-19T03:00:00.000Z' })
    expect(hotel.evidence[0].provider).toMatch(/sandbox.*test data/i)
    expect(hotel.evidence[0].warnings.join(' ')).toMatch(/test data.*(?:not live|no live)/i)
    expect(result.warnings.join(' ')).toMatch(/sandbox.*test data/i)
    expect(sumCosts(hotel.costs)).toMatchObject({ knownCostCents: 12525, priceComplete: false })
    expect(JSON.stringify(result)).not.toMatch(/sand_fixture-key|private-offer-token|hotels\.example\.test/)
  })
  it.each(['sand_fixture', 'sandbox_fixture'])('accepts only dedicated sandbox credentials such as %s without production approval', async apiKey => {
    const fetch = fetcher([sandboxReply()])
    expect((await sandboxAdapter(fetch, { apiKey })(sandboxRequest(), sandboxContext())).status).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([{ enabled: false }, { apiKey: undefined }, { apiKey: '' }, { apiKey: 'prod-fixture-key' }, { environment: 'production' }])('makes no request without sandbox configuration: %j', async extra => {
    const fetch = fetcher([sandboxReply()])
    expect((await sandboxAdapter(fetch, extra)(sandboxRequest(), sandboxContext())).status).toBe('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['real', 'missing-marker', 'missing-server-permission', 'disallowed', 'no-stay', 'two-nights', 'missing-nationality', 'two-adults', 'two-rooms', 'aborted'])('makes no request for unsupported sandbox input %s', async scenario => {
    const req = sandboxRequest(); const ctx = sandboxContext()
    if (scenario === 'real') req.mode = 'real' as never
    if (scenario === 'missing-marker') delete (req as { hotelDataMode?: string }).hotelDataMode
    if (scenario === 'missing-server-permission') ctx.hotelSandbox = false
    if (scenario === 'disallowed') req.overnightAllowed = false
    if (scenario === 'no-stay') req.stay = null
    if (scenario === 'two-nights') req.stay!.checkout = '2026-11-20'
    if (scenario === 'missing-nationality') delete (req.stay as { guestNationality?: string }).guestNationality
    if (scenario === 'two-adults') req.stay!.adults = 2 as never
    if (scenario === 'two-rooms') req.stay!.rooms = 2 as never
    if (scenario === 'aborted') { const controller = new AbortController(); controller.abort(); ctx.signal = controller.signal }
    const fetch = fetcher([sandboxReply()])
    expect((await sandboxAdapter(fetch)(req, ctx)).status).toBe('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([false, undefined, 'true'])('rejects rates without literal sandbox:true: %j', async sandbox => {
    const fetch = fetcher([{ ...reply(), sandbox }])
    expect((await sandboxAdapter(fetch)(sandboxRequest(), sandboxContext())).status).toBe('unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('preserves the same three-property and single-detail cap for sandbox rates', async () => {
    const body = sandboxReply(); const base = body.data[0]
    body.data = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(base), hotelId: `test-${index}` }))
    body.hotels = body.data.slice(1).map(item => ({ id: item.hotelId, name: 'Test hotel', address: 'Boston address' }))
    const fetch = fetcher([body, { data: { id: 'test-0', name: 'Test hotel', address: 'Boston address' } }])
    const result = await sandboxAdapter(fetch)(sandboxRequest(), sandboxContext())
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('expected sandbox facts')
    expect(result.data.offers).toHaveLength(3)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe('https://api.liteapi.travel/v3.0/data/hotel?hotelId=test-0')
  })
  it.each([
    ['empty', 'empty_results=1'], ['missing-id', 'rate_property_identity=1'], ['no-room', 'rate_room_types=1'],
    ['missing-offer', 'rate_offer_identity=1'], ['two-rates', 'rate_count=1'], ['occupancy', 'rate_occupancy=1'],
    ['total-shape', 'rate_total_structure=1'], ['usd-price', 'rate_total_usd=1'],
    ['offer-total', 'rate_offer_total_mismatch=1'], ['selling-price', 'rate_selling_price=1'],
  ])('reports static sandbox rejection category for %s without leaking provider values', async (scenario, diagnostic) => {
    const body = sandboxReply(); const hotel = body.data[0]; const room = hotel.roomTypes[0]; const rate = room.rates[0]
    hotel.hotelId = 'PRIVATE-PROPERTY'; room.offerId = 'PRIVATE-OFFER'; body.hotels[0].id = hotel.hotelId
    if (scenario === 'empty') body.data = []
    if (scenario === 'missing-id') hotel.hotelId = ''
    if (scenario === 'no-room') hotel.roomTypes = []
    if (scenario === 'missing-offer') room.offerId = ''
    if (scenario === 'two-rates') room.rates.push(structuredClone(rate))
    if (scenario === 'occupancy') rate.occupancyNumber = 9
    if (scenario === 'total-shape') rate.retailRate.total = []
    if (scenario === 'usd-price') rate.retailRate.total[0].currency = 'PRIVATE-CURRENCY'
    if (scenario === 'offer-total') room.offerRetailRate.amount = 77.13
    if (scenario === 'selling-price') room.suggestedSellingPrice[0].amount = 771.13
    const fetch = fetcher([body]); const result = await sandboxAdapter(fetch)(sandboxRequest(), sandboxContext())
    expect(result.status).toBe('unavailable')
    if (result.status === 'ok') throw new Error('expected diagnostics')
    expect(result.reason).toContain(diagnostic)
    expect(result.reason).toContain(`received=${body.data.length}; inspected=${body.data.length}; accepted_rates=0`)
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|771\.13|77\.13|125\.25|sand_fixture|private-offer-token/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['identity', 'detail-request'])('distinguishes missing property identity from %s failure', async scenario => {
    const body = sandboxReply(); body.hotels = []
    const fetch = scenario === 'identity' ? fetcher([body, { data: { id: 'PRIVATE-WRONG-ID', name: 'PRIVATE-NAME', address: 'PRIVATE-ADDRESS' } }]) : vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(new Response('PRIVATE-BODY', { status: 500 }))
    const result = await sandboxAdapter(fetch)(sandboxRequest(), sandboxContext())
    expect(result.status).toBe('unavailable')
    if (result.status === 'ok') throw new Error('expected diagnostics')
    expect(result.reason).toContain('received=1; inspected=1; accepted_rates=1')
    expect(result.reason).toContain('property_identity=1')
    expect(result.reason).toContain(scenario === 'identity' ? 'detail_identity=1' : 'detail_request_failed=1')
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|lp-hotel|125\.25|sand_fixture/)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('reports output schema rejection separately without loosening date validation', async () => {
    const req = sandboxRequest(); req.stay!.checkin += '[u-ca=iso8601]'
    const result = await sandboxAdapter(fetcher([sandboxReply()]))(req, sandboxContext())
    expect(result.status).toBe('unavailable')
    if (result.status === 'ok') throw new Error('expected diagnostics')
    expect(result.reason).toContain('accepted_rates=1')
    expect(result.reason).toContain('output_schema=1')
    expect(result.reason).not.toContain('u-ca')
  })
  it('inspects only three rate rows and aggregates bounded static rejection counts', async () => {
    const body = sandboxReply(); body.data = Array.from({ length: 10 }, () => structuredClone(body.data[0])); body.data.forEach(hotel => { hotel.roomTypes = [] })
    const fetch = fetcher([body]); const result = await sandboxAdapter(fetch)(sandboxRequest(), sandboxContext())
    expect(result.status).toBe('unavailable')
    if (result.status === 'ok') throw new Error('expected diagnostics')
    expect(result.reason).toContain('received=10; inspected=3; accepted_rates=0')
    expect(result.reason).toContain('rate_room_types=3')
    expect(result.reason.length).toBeLessThan(600)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('retains the existing production failure message without sandbox diagnostics', async () => {
    const body = reply(); body.data[0].roomTypes = []
    const result = await adapter(fetcher([body]))(request(), { signal: signal() })
    expect(result).toMatchObject({ status: 'unavailable', reason: 'No supported production hotel room offers with complete property identity and public-safe USD pricing were available.' })
  })

  it.each([true, false])('gives only sandbox rates enough time for the six-second supplier window: sandbox=%s', async sandbox => {
    vi.useFakeTimers()
    try {
      const delayed = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(resolve => setTimeout(() => resolve(Response.json(sandbox ? sandboxReply() : reply())), 4_000)))
      const pending = sandbox ? sandboxAdapter(delayed)(sandboxRequest(), sandboxContext()) : adapter(delayed)(request(), { signal: signal() })
      await vi.advanceTimersByTimeAsync(4_001)
      const result = await pending
      expect(result.status).toBe(sandbox ? 'ok' : 'unavailable')
      if (!sandbox && result.status !== 'ok') expect(result.reason).toContain('timeout')
      expect(delayed).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('keeps the sandbox property-details request at the default three-second deadline', async () => {
    vi.useFakeTimers()
    try {
      const body = sandboxReply(); body.hotels = []
      const delayed = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json(body)).mockImplementationOnce(() => new Promise<Response>(resolve => setTimeout(() => resolve(Response.json({ data: { id: 'lp-hotel', name: 'Hotel', address: 'Boston' } })), 4_000)))
      const pending = sandboxAdapter(delayed)(sandboxRequest(), sandboxContext())
      await vi.advanceTimersByTimeAsync(3_001)
      const result = await pending
      expect(result.status).toBe('unavailable')
      if (result.status !== 'ok') expect(result.reason).toContain('detail_request_failed=1')
      expect(delayed).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

})
