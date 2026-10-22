import { describe, expect, it } from 'vitest'
import { daytimeFixture, overnightFixture } from '@domain/fixtures'
import { planRecovery } from '@domain/planner'
import { RecoveryResultSchema, TripRequestSchema } from '@domain/schemas'
import type { TransitOption, TripRequest } from '@domain/schemas'

const asap = (): { request: TripRequest; fixture: ReturnType<typeof daytimeFixture> } => {
  const fixture = daytimeFixture()
  return { request: { ...fixture.request, originalDepartureAt: null, deadlineAt: null }, fixture }
}

describe('arrival and ASAP planning', () => {
  it('plans supplied candidates without inventing an original departure or hard deadline', () => {
    const { request, fixture } = asap()
    const result = planRecovery(TripRequestSchema.parse(request), fixture.candidates, { now: fixture.now })
    expect(result.originalConnection).toBeNull()
    expect(result.request).toMatchObject({ originalDepartureAt: null, deadlineAt: null, stay: null, flight: null })
    expect(result.plans.map(plan => plan.id)).toEqual(['car', 'bus', 'train'])
    expect(result.plans.flatMap(plan => plan.violations)).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/24.hour.*search|search.*24.hour/i)
    expect(result.warnings.join(' ')).toMatch(/coverage|limited|bounded/i)
    expect(result.warnings.join(' ')).not.toMatch(/deadline.*exceed|exceed.*deadline/i)
    expect(RecoveryResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result)
  })

  it('includes a complete journey at the 24-hour boundary and omits a final transfer beyond it', () => {
    const { request, fixture } = asap()
    const bus = fixture.candidates.find(candidate => candidate.kind === 'bus') as TransitOption
    bus.departureAt = '2026-11-18T23:30:00-05:00'
    bus.arrivalAt = '2026-11-19T07:40:00-05:00'
    bus.finalTransfer.evidence[0].serviceDate = '2026-11-19'
    const boundary = planRecovery(request, [bus], { now: fixture.now })
    expect(boundary.plans[0]).toMatchObject({ finalArrivalAt: '2026-11-19T08:00:00-05:00', durationMinutes: 1440 })
    bus.finalTransfer.minutes = 21
    const outside = planRecovery(request, [bus], { now: fixture.now })
    expect(outside.plans).toEqual([])
    expect(outside.rejected).toEqual([])
    expect(outside.warnings.join(' ')).toMatch(/bus.*outside.*search window/i)
    expect(outside.warnings.join(' ')).not.toMatch(/deadline/i)
    expect(outside.request.deadlineAt).toBeNull()
  })

  it('preserves an explicit hard deadline with an unknown original connection', () => {
    const { request, fixture } = asap()
    request.deadlineAt = '2026-11-18T12:00:00-05:00'
    const result = planRecovery(request, fixture.candidates, { now: fixture.now })
    expect(result.originalConnection).toBeNull()
    expect(result.plans.map(plan => plan.id)).toEqual(['car'])
    expect(result.rejected.map(plan => plan.id)).toEqual(['bus', 'train'])
    expect(result.rejected.every(plan => plan.violations.some(note => /deadline/i.test(note)))).toBe(true)
    expect(result.warnings.join(' ')).not.toMatch(/24.hour/i)
  })

  it('accepts overnight permission without creating an exact hotel stay or transfer facts', () => {
    const fixture = overnightFixture()
    const request = { ...fixture.request, originalDepartureAt: null, deadlineAt: null, overnightAllowed: true, stay: null }
    expect(TripRequestSchema.parse(request).stay).toBeNull()
    const result = planRecovery(request, fixture.candidates, { now: fixture.now })
    expect(result.plans.map(plan => plan.id)).toEqual(['car'])
    expect(result.warnings.join(' ')).toMatch(/hotel-bus.*stay dates or occupancy/i)
    expect(result.request.stay).toBeNull()
  })
})


describe('search window policy', () => {
  it('uses exactly 24 elapsed hours for ASAP and preserves explicit deadline text', async () => {
    const { searchEndAt } = await import('@domain/search-policy')
    const arrivalAt = '2026-11-18T08:00:00-05:00'
    expect(searchEndAt({ arrivalAt, deadlineAt: null })).toBe('2026-11-19T08:00:00-05:00')
    const deadlineAt = '2026-11-20T14:00:00Z'
    expect(searchEndAt({ arrivalAt, deadlineAt })).toBe(deadlineAt)
    expect(searchEndAt({ arrivalAt: '2026-03-08T01:30:30-05:00', deadlineAt: null })).toBe('2026-03-09T02:30:30-04:00')
  })
})
