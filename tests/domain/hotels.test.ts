import { describe, expect, it } from 'vitest'
import { buildHotelRecovery } from '../../supabase/functions/_shared/domain/hotel-recovery.ts'
import { overnightFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { OvernightOptionSchema, type HotelOption, type TripRequest } from '../../supabase/functions/_shared/domain/schemas.ts'
import { planRecovery } from '../../supabase/functions/_shared/domain/planner.ts'
function fixture() {
  const original = overnightFixture(); const overnight = original.request.confirmedOptions[0]
  if (overnight.kind !== 'overnight') throw new Error('expected fixture')
  const transit = structuredClone(overnight.nextDayTransit); transit.access.from = 'BOS terminal exit'
  const request: TripRequest = { ...original.request, confirmedOptions: [transit], hotelSelection: { hotelId: overnight.hotel.id, nextDayTransitId: transit.id, checkinMinutes: 15, leaveHotelAt: overnight.leaveHotelAt, hotelAccess: { minutes: 20, costCents: 2000, kind: 'transfer', checkedAt: original.now }, stationAccess: { minutes: 25, costCents: 1500, kind: 'transfer', checkedAt: original.now } } }
  return { request, hotel: structuredClone(overnight.hotel), transit, now: original.now }
}
describe('hotel and actual next-day transit pairing', () => {
  it('binds traveler transfers to the exact property and preserves the supplied timetable and final mile', () => {
    const { request, hotel, transit, now } = fixture(); const result = buildHotelRecovery(request, [hotel], now)
    expect(result.candidates).toHaveLength(1); const candidate = result.candidates[0]
    expect(OvernightOptionSchema.safeParse(candidate).success).toBe(true)
    expect(candidate.hotel).toEqual(hotel)
    expect(candidate.hotelAccess).toMatchObject({ from: 'BOS terminal exit', to: hotel.name, minutes: 20, costCents: 2000 })
    expect(candidate.nextDayTransit).toEqual({ ...transit, access: expect.objectContaining({ from: hotel.name, to: transit.access.to, minutes: 25, costCents: 1500 }) })
    expect(candidate.hotelAccess.evidence[0]).toMatchObject({ type: 'synthetic', environment: 'synthetic', serviceDate: hotel.checkin })
    expect(candidate.nextDayTransit.access.evidence[0]).toMatchObject({ serviceDate: hotel.checkout })
    const planned = planRecovery(request, result.candidates, { now }); expect(planned.plans).toHaveLength(1)
    const legs = planned.plans[0].legs
    expect(legs.every((leg, i) => i === 0 || (leg.from === legs[i - 1].to && leg.startAt === legs[i - 1].endAt))).toBe(true)
    expect(planned.plans[0].knownCostCents).toBe(20200)
    expect(JSON.stringify(candidate)).toMatch(/confirm/i)
  })
  it('does not turn unselected hotel availability into a recovery card', () => {
    const { request, hotel, now } = fixture(); request.hotelSelection = null
    const result = buildHotelRecovery(request, [hotel], now); expect(result.candidates).toEqual([]); expect(result.warnings.join(' ')).toMatch(/select|transfer|next.day/i)
  })
  it.each(['wrong-hotel', 'wrong-transit', 'same-day-transit', 'wrong-stay', 'two-nights', 'nonpositive-stay', 'expired-hotel', 'expired-evidence', 'future-transfer', 'duplicate-hotel', 'duplicate-transit', 'wrong-final-destination'])('does not invent a recovery for %s facts', scenario => {
    const { request, hotel, transit, now } = fixture(); const hotels: HotelOption[] = [hotel]
    if (scenario === 'wrong-hotel') request.hotelSelection!.hotelId = 'other'
    if (scenario === 'wrong-transit') request.hotelSelection!.nextDayTransitId = 'other'
    if (scenario === 'same-day-transit') transit.departureAt = '2026-11-18T08:00:00-05:00'
    if (scenario === 'wrong-stay') hotel.checkout = '2026-11-20'
    if (scenario === 'two-nights') { request.stay!.checkout = '2026-11-20'; hotel.checkout = '2026-11-20' }
    if (scenario === 'nonpositive-stay') request.hotelSelection!.leaveHotelAt = '2026-11-18T22:10:00-05:00'
    if (scenario === 'expired-hotel') hotel.quoteExpiresAt = now
    if (scenario === 'expired-evidence') hotel.evidence[0].expiresAt = now
    if (scenario === 'future-transfer') request.hotelSelection!.stationAccess.checkedAt = '2026-11-20T12:00:00Z'
    if (scenario === 'duplicate-hotel') hotels.push(structuredClone(hotel))
    if (scenario === 'duplicate-transit') request.confirmedOptions.push(structuredClone(transit))
    if (scenario === 'wrong-final-destination') transit.finalTransfer.to = 'Another city'
    const result = buildHotelRecovery(request, hotels, now); expect(result.candidates).toEqual([]); expect(result.warnings.length).toBeGreaterThan(0)
  })
  it('lets the pure planner enforce deadline and budget without changing transit times', () => {
    const { request, hotel, transit, now } = fixture(); request.deadlineAt = '2026-11-19T09:00:00-05:00'; request.budgetMode = 'hard'; request.budgetCents = 100
    const paired = buildHotelRecovery(request, [hotel], now); expect(paired.candidates).toHaveLength(1)
    expect(paired.candidates[0].nextDayTransit.departureAt).toBe(transit.departureAt)
    const planned = planRecovery(request, paired.candidates, { now }); expect(planned.plans).toHaveLength(0); expect(planned.rejected).toHaveLength(1)
    expect(planned.rejected[0].violations.join(' ')).toMatch(/budget/); expect(planned.rejected[0].violations.join(' ')).toMatch(/deadline/)
  })
  it('does not mutate supplied offers or manual options', () => {
    const { request, hotel, now } = fixture(); const before = JSON.stringify({ request, hotel }); buildHotelRecovery(request, [hotel], now); expect(JSON.stringify({ request, hotel })).toBe(before)
  })
})
