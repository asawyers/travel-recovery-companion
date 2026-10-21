import { describe, expect, it } from 'vitest'
import { overnightFixture } from '@domain/fixtures'
import { planRecovery } from '@domain/planner'
import { RecoveryResultSchema } from '@domain/schemas'
import type { OvernightOption } from '@domain/schemas'

const run = (f: ReturnType<typeof overnightFixture>) => planRecovery(f.request, f.candidates, { now: f.now })
const nightOf = (f: ReturnType<typeof overnightFixture>) => f.candidates[0] as OvernightOption

describe('complete overnight journeys', () => {
  it('compares all overnight charges and elapsed time, preserving full hotel metadata', () => {
    const f = overnightFixture(); const n = nightOf(f)
    n.hotel.cancellation = { deadlineAt: '2026-11-18T18:00:00-05:00', penalty: 'First night', text: 'Fictional cancellation policy' }
    const r = run(f); const p = r.plans.find(p => p.id === 'hotel-bus')!
    expect(p).toMatchObject({ knownCostCents: 20200, durationMinutes: 760, finalArrivalAt: '2026-11-19T10:40:00-05:00', feasibility: 'requires_confirmation' })
    expect(p.hotel).toEqual(n.hotel)
    expect(p.warnings.join()).toMatch(/late.*check.?in/i)
    expect(r.plans[0]).toMatchObject({ id: 'car', knownCostCents: 24000, finalArrivalAt: '2026-11-19T01:45:00-05:00' })
    expect(RecoveryResultSchema.parse(r)).toEqual(r)
  })
  it('rejects the entire comparison under a hard $200 limit and no overnight permission', () => {
    const f = overnightFixture(); f.request.budgetCents = 20000; f.request.budgetMode = 'hard'
    expect(run(f).plans).toHaveLength(0)
    f.request.budgetCents = 25000; f.request.overnightAllowed = false
    expect(run(f).plans.map(p => p.id)).toEqual(['car'])
    expect(run(f).rejected.find(p => p.id === 'hotel-bus')?.violations.join()).toMatch(/overnight/i)
  })
  it('does not double-count included hotel taxes', () => {
    const f = overnightFixture(); nightOf(f).hotel.costs[1].includedInOtherCharge = true
    expect(run(f).plans.find(p => p.id === 'hotel-bus')?.knownCostCents).toBe(18200)
  })
  it('requires the intended stay dates and occupancy and next-day service date', () => {
    const f = overnightFixture(); nightOf(f).hotel.checkin = '2026-11-17'
    expect(run(f).plans.some(p => p.id === 'hotel-bus')).toBe(false)
    expect(run(f).warnings.join()).toMatch(/stay/i)
    const g = overnightFixture(); nightOf(g).nextDayTransit.evidence[0].serviceDate = '2026-11-18'
    expect(run(g).plans.some(p => p.id === 'hotel-bus')).toBe(false)
  })
  it('retains an intended prior-night stay for after-midnight arrival and warns about check-in', () => {
    const f = overnightFixture(); f.request.arrivalAt = '2026-11-19T00:00:00-05:00'
    nightOf(f).hotelAccess.evidence[0].serviceDate = '2026-11-19'
    const p = run(f).plans.find(p => p.id === 'hotel-bus')!
    expect(p.hotel?.checkin).toBe('2026-11-18')
    expect(p.warnings.join()).toMatch(/late.*check.?in/i)
    expect(p.durationMinutes).toBe(640)
    const g = overnightFixture(); g.request.arrivalAt = '2026-11-18T22:00:00Z'
    expect(run(g).plans.find(p => p.id === 'hotel-bus')?.hotel?.checkin).toBe('2026-11-18')
  })
  it('does not let confirmation flags excuse leaving before check-in or a disconnected hotel transfer', () => {
    const f = overnightFixture(); nightOf(f).leaveHotelAt = '2026-11-18T22:50:00-05:00'
    expect(run(f).plans.some(p => p.id === 'hotel-bus')).toBe(false)
    const g = overnightFixture(); nightOf(g).nextDayTransit.access.from = 'Other hotel'
    expect(run(g).plans.some(p => p.id === 'hotel-bus')).toBe(false)
    expect(run(g).warnings.join()).toMatch(/connect/i)
  })
  it('rejects expired hotel quotes while preserving the original expiry', () => {
    const f = overnightFixture(); nightOf(f).hotel.quoteExpiresAt = '2026-11-18T07:00:00-05:00'
    const p = run(f).rejected.find(p => p.id === 'hotel-bus')!
    expect(p).toMatchObject({ feasibility: 'infeasible', selectable: false })
    expect(p.violations.join()).toMatch(/expired.*quote|quote.*expired/i)
    expect(p.hotel?.quoteExpiresAt).toBe(nightOf(f).hotel.quoteExpiresAt)
  })
})

describe('hotel midnight service relevance', () => {
  it('uses the actual local transfer day separately from the intended reservation night', () => {
    const f = overnightFixture(); f.request.arrivalAt = '2026-11-19T00:00:00-05:00'
    nightOf(f).hotelAccess.evidence[0].serviceDate = '2026-11-19'
    expect(run(f).plans.find(p => p.id === 'hotel-bus')?.hotel?.checkin).toBe('2026-11-18')
    nightOf(f).hotelAccess.evidence[0].serviceDate = '2026-11-17'
    expect(run(f).plans.some(p => p.id === 'hotel-bus')).toBe(false)
  })
})
