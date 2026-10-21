import { Temporal } from '@js-temporal/polyfill'
import { HotelOptionSchema } from '../domain/schemas.ts'
import type { CostLine, HotelOption, SourceEvidence, TripRequest } from '../domain/schemas.ts'
import { toInstantMillis } from '../domain/time.ts'
import { providerJson } from './provider-http.ts'
import type { ProviderAdapterOptions, ProviderContext, ProviderResult } from './provider-types.ts'

export type HotelFacts = { offers: HotelOption[] }
const RATES_URL = 'https://api.liteapi.travel/v3.0/hotels/rates'
const DETAIL_URL = 'https://api.liteapi.travel/v3.0/data/hotel'
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown, limit = 500): string | null => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit ? value.trim() : null
const unavailable = (reason: string, retryable = false): ProviderResult<HotelFacts> => ({ status: 'unavailable', reason, retryable })

/** Decimal parsing avoids rounding fractional cents into a price we did not receive. */
function cents(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) return null
  const amount = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount <= 100_000_000 ? amount : null
}
function usd(value: unknown): number | null {
  const money = record(value)
  return money?.currency === 'USD' ? cents(money.amount) : null
}
function oneNight(request: TripRequest): boolean {
  const stay = request.stay
  if (!stay || stay.adults !== 1 || stay.rooms !== 1 || !/^[A-Z]{2}$/.test(stay.guestNationality ?? '')) return false
  try { return Temporal.PlainDate.from(stay.checkin, { overflow: 'reject' }).add({ days: 1 }).toString() === stay.checkout } catch { return false }
}
function approvedOrigin(origin?: string): boolean {
  if (!origin) return false
  try { const url = new URL(origin); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && (origin === url.origin || origin === `${url.origin}/`) } catch { return false }
}
function feeLines(value: unknown): CostLine[] {
  // The official rates structure defines null as all taxes/fees included. Missing/empty data has no such guarantee.
  if (value === null) return []
  const unknown: CostLine = { label: 'Additional hotel taxes or fees unconfirmed', cents: null, currency: 'USD', includedInOtherCharge: false }
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return [unknown]
  return value.map(item => {
    const fee = record(item)
    if (!fee || typeof fee.included !== 'boolean') return unknown
    const amount = fee.currency === 'USD' ? cents(fee.amount) : null
    return { label: text(fee.description) ?? 'Hotel tax or fee', cents: amount, currency: 'USD', includedInOtherCharge: fee.included }
  })
}
function cancellation(value: unknown): HotelOption['cancellation'] {
  const policy = record(value)
  if (!policy) return null
  const infos = Array.isArray(policy.cancelPolicyInfos) ? policy.cancelPolicyInfos.slice(0, 16).map(record).filter((item): item is Record<string, unknown> => item !== undefined) : []
  const notes: string[] = []
  const tag = text(policy.refundableTag, 100)
  if (tag) notes.push(`Refundability: ${tag}.`)
  if (Array.isArray(policy.hotelRemarks)) notes.push(...policy.hotelRemarks.slice(0, 8).map(v => text(v, 200)).filter((v): v is string => v !== null))
  let deadlineAt: string | null = null
  let penalty: string | null = null
  for (const info of infos) {
    const time = text(info.cancelTime, 40); const zone = text(info.timezone, 80)
    const amount = cents(info.amount); const currency = text(info.currency, 3); const type = text(info.type, 30)
    const fee = amount !== null && currency && type === 'amount' ? `${(amount / 100).toFixed(2)} ${currency}` : null
    const rawAmount = typeof info.amount === 'number' && Number.isFinite(info.amount) ? String(info.amount) : text(info.amount, 40)
    notes.push([time, zone, type, fee ?? [rawAmount, currency].filter(Boolean).join(' ')].filter(Boolean).join(' ') || 'Cancellation terms require confirmation.')
    // Only a single explicit amount policy in supported UTC/GMT has an unambiguous normalized deadline here.
    if (infos.length === 1 && time && /^(?:UTC|GMT)$/.test(zone ?? '') && type === 'amount' && fee) {
      const candidate = `${time.replace(' ', 'T')}Z`
      try { toInstantMillis(candidate); deadlineAt = candidate; penalty = fee } catch { /* retain source text */ }
    }
  }
  return notes.length ? { deadlineAt, penalty, text: notes.join(' ').slice(0, 4000) } : null
}
type RateFact = { id: string; room: string | null; board: string | null; costs: CostLine[]; cancellation: HotelOption['cancellation'] }
function rateFact(value: unknown): RateFact | undefined {
  const hotel = record(value); const id = text(hotel?.hotelId, 100)
  if (!id || !Array.isArray(hotel?.roomTypes) || hotel.roomTypes.length === 0) return undefined
  const offer = record(hotel.roomTypes[0])
  if (!offer || !text(offer.offerId, 10000) || !Array.isArray(offer.rates) || offer.rates.length !== 1) return undefined
  const rate = record(offer.rates[0]); const retail = record(rate?.retailRate)
  if (!rate || rate.adultCount !== 1 || rate.childCount !== 0 || rate.occupancyNumber !== 1 || !Array.isArray(retail?.total) || retail.total.length !== 1) return undefined
  const total = usd(retail.total[0])
  if (total === null) return undefined
  // Offer totals are optional but must agree with the single room total when present.
  if (offer.offerRetailRate !== undefined && usd(offer.offerRetailRate) !== total) return undefined
  for (const parent of [offer, rate]) {
    if (parent.suggestedSellingPrice === undefined || parent.suggestedSellingPrice === null) continue
    const prices = parent === offer && record(parent.suggestedSellingPrice) ? [parent.suggestedSellingPrice] : parent.suggestedSellingPrice
    if (!Array.isArray(prices) || prices.length === 0 || prices.length > 8 || prices.some(price => usd(price) === null || usd(price)! > total)) return undefined
  }
  return { id, room: text(rate.name), board: text(rate.boardName), costs: [{ label: 'Hotel room total', cents: total, currency: 'USD', includedInOtherCharge: false }, ...feeLines(retail.taxesAndFees)], cancellation: cancellation(rate.cancellationPolicies) }
}
function property(value: unknown, id: string): { name: string; address: string } | undefined {
  const item = record(value)
  if (item?.id !== id) return undefined
  const name = text(item.name); const address = text(item.address)
  return name && address ? { name, address } : undefined
}

/** Optional availability only. All gates are server-owned; no prebook, booking or payment is invoked. */
export function createLiteApiAdapter(options: ProviderAdapterOptions & { environment: 'production' | 'sandbox'; publicRatesApproved?: boolean; bookingOrigin?: string }) {
  return async (request: TripRequest, context: ProviderContext): Promise<ProviderResult<HotelFacts>> => {
    const sandbox = options.environment === 'sandbox'
    const sandboxKey = /^(?:sand_|sandbox_)/i.test(options.apiKey?.trim() ?? '')
    if (!options.enabled || !options.apiKey?.trim() || (sandbox ? !sandboxKey : !options.publicRatesApproved || sandboxKey)) return unavailable(sandbox ? 'Hotel sandbox is unavailable without an enabled dedicated sandbox key.' : 'Hotel availability is disabled or lacks approved production/public-rate configuration.')
    const permittedMode = sandbox ? request.mode === 'synthetic' && request.hotelDataMode === 'sandbox' && context.hotelSandbox === true : request.mode === 'real' && request.hotelDataMode === undefined
    if (!permittedMode || !request.overnightAllowed || !oneNight(request)) return unavailable(sandbox ? 'Hotel sandbox requires explicit synthetic test mode, server permission, overnight permission and an explicit one-adult, one-room, one-night stay with guest nationality.' : 'Hotel availability requires real mode, overnight permission and an explicit one-adult, one-room, one-night stay with guest nationality.')
    if (context.signal.aborted) return unavailable('Hotel availability was cancelled.')
    const now = options.now(); let expiresAt: string
    try { expiresAt = new Date(toInstantMillis(now) + 300_000).toISOString() } catch { return unavailable('Hotel availability clock is invalid.') }
    const fetcher = options.fetcher ?? fetch
    const headers = { 'X-API-Key': options.apiKey.trim(), 'Content-Type': 'application/json', Accept: 'application/json' }
    const stay = request.stay!
    const result = await providerJson(fetcher, RATES_URL, { method: 'POST', headers, body: JSON.stringify({ checkin: stay.checkin, checkout: stay.checkout, currency: 'USD', guestNationality: stay.guestNationality, occupancies: [{ adults: 1, children: [] }], iataCode: 'BOS', limit: 3, maxRatesPerHotel: 1, includeHotelData: true, timeout: 6 }) }, context.signal)
    if (!result.ok) return unavailable(`Hotel availability request failed (${result.kind}${result.status ? `; HTTP ${result.status}` : ''}); supplied options were retained.`, ['timeout', 'network', 'rate_limited'].includes(result.kind))
    const body = record(result.body)
    if (!body || body.sandbox !== sandbox) return unavailable(sandbox ? 'Hotel sandbox lacked explicit sandbox:true provenance; production or unmarked rates were omitted.' : 'Hotel availability lacked explicit production provenance; sandbox or unmarked rates were omitted.')
    if (!Array.isArray(body.data) || body.data.length > 200) return unavailable('Hotel availability response was malformed; supplied options were retained.')
    const evidence: SourceEvidence = { type: sandbox ? 'estimated' : 'live', provider: sandbox ? 'Nuitee LiteAPI sandbox — test data' : 'Nuitee LiteAPI', sourceUrl: 'https://docs.liteapi.travel/reference/post_hotels-rates', checkedAt: now, serviceDate: stay.checkin, providerUpdatedAt: null, expiresAt, environment: sandbox ? 'sandbox' : 'production', warnings: ['Five-minute app evidence freshness policy; this is not a provider quote expiry.', sandbox ? 'Sandbox test data; no live availability or bookable rate. No booking can be made from this demo.' : 'Availability and price must be rechecked with the hotel booking provider; the hosted payable price is not guaranteed.'] }
    const hotels = Array.isArray(body.hotels) && body.hotels.length <= 200 ? body.hotels : []
    const facts = body.data.slice(0, 3).map(rateFact).filter((item): item is RateFact => item !== undefined)
    const seen = new Set<string>(); const offers: HotelOption[] = []
    for (let index = 0; index < facts.length; index++) {
      const fact = facts[index]
      if (seen.has(fact.id)) continue
      seen.add(fact.id)
      const matches = hotels.filter(item => record(item)?.id === fact.id)
      let details = matches.length === 1 ? property(matches[0], fact.id) : undefined
      // One content request, only for the leading usable rate. Never follow provider-supplied URLs.
      if (!details && index === 0 && matches.length <= 1 && !context.signal.aborted) {
        const detail = await providerJson(fetcher, `${DETAIL_URL}?hotelId=${encodeURIComponent(fact.id)}`, { method: 'GET', headers }, context.signal)
        if (detail.ok) details = property(record(detail.body)?.data, fact.id)
      }
      if (!details) continue
      const parsed = HotelOptionSchema.safeParse({ id: fact.id, ...details, room: fact.room, board: fact.board, checkin: stay.checkin, checkout: stay.checkout, adults: 1, rooms: 1, timeZone: 'America/New_York', costs: fact.costs, cancellation: fact.cancellation, lateCheckinConfirmed: false, quoteExpiresAt: null, evidence: [evidence], handoffId: !sandbox && approvedOrigin(options.bookingOrigin) ? 'nuitee-hotel' : 'hotel-search' })
      if (parsed.success) offers.push(parsed.data)
    }
    if (!offers.length) return unavailable(sandbox ? 'No supported sandbox hotel test offers with complete property identity and USD pricing were available.' : 'No supported production hotel room offers with complete property identity and public-safe USD pricing were available.')
    return { status: 'ok', data: { offers }, evidence: [evidence], warnings: sandbox ? ['Sandbox test data; no live availability or bookings. Select a property and supply fictional transfers and next-day train or bus to complete this demo journey.', 'Late check-in and transfer service are unconfirmed test assumptions.'] : ['Hotel availability alone is not a complete recovery journey; select a property and supply its transfers and actual next-day train or bus.', 'Late check-in, transfer service and hosted checkout prices need confirmation.'] }
  }
}
