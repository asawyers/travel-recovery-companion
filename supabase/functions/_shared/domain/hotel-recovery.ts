import { Temporal } from '@js-temporal/polyfill'
import { HotelOptionSchema, HotelSelectionSchema, OvernightOptionSchema, TransitOptionSchema } from './schemas.ts'
import type { HotelOption, OvernightOption, SourceEvidence, TransferInput, TripRequest } from './schemas.ts'
import { addMinutes, toInstantMillis, toTripLocalTime } from './time.ts'
const localDate = (time: string) => toTripLocalTime(time).slice(0, 10)

/** Pair a selected live property with actual supplied next-day service; this helper never invents timetables or transfers. */
export function buildHotelRecovery(request: TripRequest, offers: HotelOption[], now: string): { candidates: OvernightOption[]; warnings: string[] } {
  const fail = (warning: string) => ({ candidates: [], warnings: [warning] })
  if (!request.overnightAllowed) return fail('Hotel recovery requires overnight travel permission.')
  const selection = HotelSelectionSchema.safeParse(request.hotelSelection)
  if (!selection.success) return fail('Hotel availability needs a selected property, actual next-day transit, check-in allowance and traveler-confirmed hotel and station transfers before it can form a recovery journey.')
  const stay = request.stay
  try {
    if (!stay || stay.adults !== 1 || stay.rooms !== 1 || Temporal.PlainDate.from(stay.checkin).add({ days: 1 }).toString() !== stay.checkout) return fail('Hotel recovery requires the explicit one-night, one-adult, one-room stay.')
    const selected = offers.filter(offer => offer.id === selection.data.hotelId)
    if (selected.length !== 1) return fail('The selected hotel is missing or ambiguous; refresh availability and choose one exact property.')
    const parsedHotel = HotelOptionSchema.safeParse(selected[0])
    if (!parsedHotel.success) return fail('The selected hotel offer is malformed; refresh availability.')
    const hotel = parsedHotel.data
    if (hotel.checkin !== stay.checkin || hotel.checkout !== stay.checkout || hotel.adults !== stay.adults || hotel.rooms !== stay.rooms) return fail('Selected hotel stay dates or occupancy do not match the intended stay.')
    const nowMillis = toInstantMillis(now)
    if ((hotel.quoteExpiresAt && toInstantMillis(hotel.quoteExpiresAt) <= nowMillis) || hotel.evidence.some(e => (e.expiresAt !== null && toInstantMillis(e.expiresAt) <= nowMillis) || toInstantMillis(e.checkedAt) > nowMillis)) return fail('Selected hotel quote or availability evidence is expired or has a future timestamp; refresh it before pairing.')
    if (hotel.evidence.some(e => e.serviceDate !== hotel.checkin || (request.mode === 'real' ? e.environment !== 'production' || e.type === 'synthetic' : e.environment === 'production'))) return fail('Selected hotel evidence does not match the intended stay date or request mode.')
    const matches = request.confirmedOptions.filter(option => option.id === selection.data.nextDayTransitId && (option.kind === 'train' || option.kind === 'bus'))
    if (matches.length !== 1) return fail('The selected next-day train or bus is missing or ambiguous; supply an actual checkout-date service.')
    const transit = TransitOptionSchema.safeParse(matches[0])
    if (!transit.success || localDate(transit.data.departureAt) !== stay.checkout || transit.data.finalTransfer.to !== request.destination) return fail('Next-day transit must use an actual checkout-date departure and connect to the final destination.')
    const selectionData = selection.data
    if (localDate(selectionData.leaveHotelAt) !== stay.checkout) return fail('Hotel departure must fall on the intended checkout date.')
    if ([selectionData.hotelAccess, selectionData.stationAccess].some(fact => toInstantMillis(fact.checkedAt) > nowMillis)) return fail('Traveler transfer facts have future check timestamps; confirm their timestamps before pairing.')
    const hotelArrival = addMinutes(request.arrivalAt, request.airportExitMinutes + selectionData.hotelAccess.minutes)
    if (localDate(hotelArrival) < stay.checkin || localDate(hotelArrival) > stay.checkout || toInstantMillis(addMinutes(hotelArrival, selectionData.checkinMinutes)) >= toInstantMillis(selectionData.leaveHotelAt)) return fail('Hotel timing must allow completed check-in and a positive stay before checkout-date departure.')
    const transfer = (fact: typeof selectionData.hotelAccess, from: string, to: string, serviceDate: string): TransferInput => {
      const evidence: SourceEvidence = { type: request.mode === 'synthetic' ? 'synthetic' : 'traveler_confirmed', provider: request.mode === 'synthetic' ? 'Fictional traveler transfer input' : 'Traveler-confirmed property transfer', sourceUrl: null, checkedAt: fact.checkedAt, serviceDate, providerUpdatedAt: null, expiresAt: null, environment: request.mode === 'synthetic' ? 'synthetic' : 'production', warnings: ['Traveler-supplied transfer duration and fare; service availability must be confirmed.'] }
      return { from, to, minutes: fact.minutes, costCents: fact.costCents, kind: fact.kind, vehicleId: null, evidence: [evidence], assumptions: ['Transfer is explicitly bound to the selected hotel; no shuttle or transfer service was inferred.'] }
    }
    const candidate = OvernightOptionSchema.safeParse({ kind: 'overnight', id: `hotel-${hotel.id}-${transit.data.id}`.slice(0, 100), title: `${hotel.name} and next-day ${transit.data.kind}`.slice(0, 500), hotel, hotelAccess: transfer(selectionData.hotelAccess, 'BOS terminal exit', hotel.name, localDate(addMinutes(request.arrivalAt, request.airportExitMinutes))), checkinMinutes: selectionData.checkinMinutes, leaveHotelAt: selectionData.leaveHotelAt, nextDayTransit: { ...transit.data, access: transfer(selectionData.stationAccess, hotel.name, transit.data.access.to, stay.checkout) }, confirmations: ['Confirm late check-in, hotel room, property transfers and next-day seat availability before booking.'] })
    if (!candidate.success) return fail('Hotel and next-day transit exceed supported journey bounds; confirm their facts.')
    return { candidates: [candidate.data], warnings: [] }
  } catch { return fail('Hotel recovery timing is invalid; confirm stay dates and property transfer timestamps.') }
}
