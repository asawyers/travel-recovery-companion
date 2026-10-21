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
