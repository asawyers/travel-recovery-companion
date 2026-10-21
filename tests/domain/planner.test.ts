import { describe, expect, it } from 'vitest'
import { daytimeFixture } from '@domain/fixtures'
import { RecoveryResultSchema } from '@domain/schemas'
import { planRecovery } from '@domain/planner'
import { minutesBetween } from '@domain/time'
import type { TransitOption, CarOption } from '@domain/schemas'

const day = () => daytimeFixture()
const busOf = (f: ReturnType<typeof day>) => f.candidates.find(c => c.kind === 'bus') as TransitOption
const run = (f: ReturnType<typeof day>) => planRecovery({ ...f.request, confirmedOptions: [] }, f.candidates, { now: f.now })

describe('whole-journey recovery', () => {
  it('reproduces daytime facts and returns schema-valid connected journeys', () => {
    const r = run(day())
    expect(r.originalConnection.shortfallMinutes).toBe(15)
    expect(r.plans.map(p => p.id)).toEqual(['car', 'bus', 'train'])
    expect(r.plans.find(p => p.id === 'train')).toMatchObject({ knownCostCents: 7200, durationMinutes: 290, finalArrivalAt: '2026-11-18T12:50:00-05:00', hotel: null })
    expect(r.plans.find(p => p.id === 'bus')).toMatchObject({ knownCostCents: 4700, durationMinutes: 250 })
    expect(r.plans[0]).toMatchObject({ knownCostCents: 14500, durationMinutes: 225, feasibility: 'requires_confirmation' })
    expect(RecoveryResultSchema.parse(r)).toEqual(r)
    for (const p of r.plans) {
      expect(p.legs[0].startAt).toBe(r.request.arrivalAt)
      expect(p.legs.at(-1)?.to).toBe(r.request.destination)
      for (let i = 1; i < p.legs.length; i++) {
        expect(p.legs[i].from).toBe(p.legs[i - 1].to)
        expect(minutesBetween(p.legs[i - 1].endAt, p.legs[i].startAt)).toBe(0)
      }
    }
  })
  it('passes the exact boarding cutoff, rejects one minute late and never makes negative waits', () => {
    const f = day(); f.request.drivingAllowed = false
    busOf(f).boardingMinutes = 30
    busOf(f).departureAt = '2026-11-18T09:30:00-05:00'
    expect(run(f).plans.some(p => p.id === 'bus')).toBe(true)
    busOf(f).departureAt = '2026-11-18T09:29:00-05:00'
    expect(run(f).plans.some(p => p.id === 'bus')).toBe(false)
    expect(JSON.stringify(run(f))).toMatch(/boarding|cutoff/i)
    busOf(f).departureAt = '2026-11-18T09:20:00-05:00'
    expect(run(f).plans.some(p => p.id === 'bus')).toBe(false)
  })
  it('honors driving and recomputes cheapest and fewest-transfer ranking', () => {
    const f = day(); f.request.drivingAllowed = false
    expect(run(f).plans[0].id).toBe('bus')
    f.request.drivingAllowed = true; f.request.priority = 'cheapest'
    expect(run(f).plans[0].id).toBe('bus')
    f.request.priority = 'fewest_transfers'
    const car = f.candidates.find(c => c.kind === 'car') as CarOption
    car.access.kind = 'walk'
    expect(run(f).plans[0].id).toBe('car')
    expect(run(f).plans[0].transfers).toBe(0)
  })
  it('rejects final-destination deadline failures even if the intercity ride arrives earlier', () => {
    const f = day(); const train = f.candidates[0] as TransitOption
    train.departureAt = '2026-11-18T13:00:00-05:00'; train.arrivalAt = '2026-11-18T15:30:00-05:00'
    expect(run(f).rejected.find(p => p.id === 'train')?.violations.join()).toMatch(/deadline/i)
  })
  it('applies hard versus soft budgets without treating unknown fares as free', () => {
    const f = day(); f.request.budgetCents = 4700; f.request.budgetMode = 'hard'
    expect(run(f).plans.map(p => p.id)).toEqual(['bus'])
    busOf(f).fareCents = null
    expect(run(f).plans).toHaveLength(0)
    expect(JSON.stringify(run(f))).toMatch(/price|budget/i)
    f.request.budgetMode = 'soft'
    expect(run(f).plans.find(p => p.id === 'bus')).toMatchObject({ priceComplete: false, knownCostCents: 1200 })
    expect(run(f).plans.find(p => p.id === 'car')?.warnings.join()).toMatch(/budget/i)
    busOf(f).fareCents = 0; f.request.budgetMode = 'hard'
    expect(run(f).plans.find(p => p.id === 'bus')).toMatchObject({ priceComplete: true, knownCostCents: 1200 })
  })
  it('keeps incomplete and unsupported-currency prices behind complete cheapest prices', () => {
    const f = day(); f.request.priority = 'cheapest'
    const car = f.candidates.find(c => c.kind === 'car') as CarOption
    car.costs = [{ label: 'Unconverted rental', cents: 1, currency: 'EUR', includedInOtherCharge: false }]
    expect(run(f).plans.map(p => p.id)).toEqual(['bus', 'train', 'car'])
    expect(run(f).plans.at(-1)).toMatchObject({ knownCostCents: 0, priceComplete: false })
    expect(run(f).plans.at(-1)?.warnings.join()).toMatch(/currency/i)
  })
  it('uses stable IDs for ties independent of input ordering', () => {
    const f = day(); const a = structuredClone(busOf(f)); a.id = 'a'; const z = structuredClone(a); z.id = 'z'
    f.candidates = [z, a]
    expect(run(f).plans.map(p => p.id)).toEqual(['a', 'z'])
    f.candidates.reverse()
    expect(run(f).plans.map(p => p.id)).toEqual(['a', 'z'])
  })
  it('omits duplicate IDs, disconnected endpoints, and malformed facts with clear diagnostics', () => {
    const f = day(); f.candidates.push(structuredClone(busOf(f)))
    expect(run(f).plans.map(p => p.id)).toEqual(['car', 'train'])
    expect(run(f).warnings.join()).toMatch(/duplicate.*bus/i)
    const g = day(); busOf(g).access.from = 'Unrelated airport'
    expect(run(g).plans.some(p => p.id === 'bus')).toBe(false)
    expect(run(g).warnings.join()).toMatch(/connect/i)
    const h = day(); (busOf(h).access as unknown as { minutes: undefined }).minutes = undefined
    expect(run(h).plans.some(p => p.id === 'bus')).toBe(false)
    expect(run(h).warnings.join()).toMatch(/invalid|missing/i)
  })
  it('checks candidate evidence mode, service dates and expiry without refreshing them', () => {
    const f = day(); busOf(f).evidence[0].serviceDate = '2026-11-17'
    expect(run(f).plans.some(p => p.id === 'bus')).toBe(false)
    const g = day(); busOf(g).evidence[0].expiresAt = '2026-11-18T07:00:00-05:00'
    expect(run(g).plans.some(p => p.id === 'bus')).toBe(false)
    expect(run(g).rejected.find(p => p.id === 'bus')).toMatchObject({ selectable: false, feasibility: 'infeasible' })
    expect(run(g).rejected.find(p => p.id === 'bus')?.violations.join()).toMatch(/expired/i)
    expect(run(g).rejected.find(p => p.id === 'bus')?.legs.flatMap(l => l.evidence).some(e => e.expiresAt === '2026-11-18T07:00:00-05:00')).toBe(true)
    const h = day(); busOf(h).evidence[0] = { ...busOf(h).evidence[0], type: 'live', environment: 'production' }
    expect(run(h).plans.some(p => p.id === 'bus')).toBe(false)
    expect(run(h).warnings.join()).toMatch(/mode|environment/i)
  })
  it('explains an infeasible request without silently relaxing constraints', () => {
    const f = day(); f.request.deadlineAt = '2026-11-18T08:01:00-05:00'
    const r = run(f)
    expect(r.plans).toHaveLength(0); expect(r.rejected).toHaveLength(3)
    expect(r.warnings.join()).toMatch(/no feasible/i)
    expect(r.request.deadlineAt).toBe(f.request.deadlineAt)
    expect(() => planRecovery({ ...f.request, arrivalAt: '2026-11-01T01:30' }, [], { now: f.now })).toThrow()
  })
})

describe('planner boundary invariants', () => {
  it('treats original-connection exact readiness as reachable and one minute later as missed', () => {
    const f = day(); f.request.originalDepartureAt = '2026-11-18T09:30:00-05:00'
    expect(run(f).originalConnection).toMatchObject({ marginMinutes: 0, shortfallMinutes: 0, missed: false })
    f.request.arrivalAt = '2026-11-18T08:01:00-05:00'
    expect(run(f).originalConnection).toMatchObject({ marginMinutes: -1, shortfallMinutes: 1, missed: true })
  })
  it('counts actual vehicle changes while ignoring activities and walking', () => {
    const f = day(); const b = busOf(f)
    b.access.vehicleId = b.id; b.finalTransfer.vehicleId = b.id
    expect(run(f).plans.find(p => p.id === 'bus')?.transfers).toBe(0)
    b.finalTransfer.vehicleId = 'other-vehicle'
    expect(run(f).plans.find(p => p.id === 'bus')?.transfers).toBe(1)
  })
  it('uses elapsed minutes across an explicit-offset DST jump', () => {
    const f = day(); f.request.arrivalAt = '2026-03-08T01:00:30-05:00'; f.request.deadlineAt = '2026-03-08T12:00:00-04:00'; f.request.originalDepartureAt = '2026-03-08T03:00:00-04:00'
    const b = busOf(f); b.departureAt = '2026-03-08T03:30:00-04:00'; b.arrivalAt = '2026-03-08T05:50:00-04:00'
    b.evidence[0].serviceDate = '2026-03-08'; b.access.evidence[0].serviceDate = '2026-03-08'; b.finalTransfer.evidence[0].serviceDate = '2026-03-08'
    f.candidates = [b]
    expect(run(f).plans[0]).toMatchObject({ finalArrivalAt: '2026-03-08T06:10:00-04:00', durationMinutes: 249.5 })
  })
  it('returns at most three choices and rejects malformed requests or clock inputs', () => {
    const f = day(); const b = busOf(f); f.candidates = ['d', 'c', 'b', 'a'].map(id => ({ ...structuredClone(b), id }))
    expect(run(f).plans.map(p => p.id)).toEqual(['a', 'b', 'c'])
    expect(() => planRecovery({ ...f.request, airport: 'JFK' } as never, f.candidates, { now: f.now })).toThrow()
    expect(() => planRecovery(f.request, f.candidates, { now: '2026-11-18T07:55' })).toThrow()
  })
})

describe('bounded diagnostics', () => {
  it('keeps supported journeys when valid provider notes reach schema bounds', () => {
    const f = day(); busOf(f).confirmations = Array.from({ length: 32 }, (_, i) => `Confirm fact ${i + 1}`)
    const r = run(f); const b = r.plans.find(p => p.id === 'bus')
    expect(b?.selectable).toBe(true)
    expect(b?.warnings.length).toBeLessThanOrEqual(32)
    expect(b?.warnings.join()).toMatch(/additional.*notes/i)
    expect(RecoveryResultSchema.safeParse(r).success).toBe(true)
  })
})

describe('precise gate-arrival timestamps', () => {
  it('preserves second-level elapsed durations without discarding scheduled journeys', () => {
    const f = day(); f.request.arrivalAt = '2026-11-18T08:00:30-05:00'
    const r = run(f)
    expect(r.plans.map(p => p.id)).toEqual(['car', 'bus', 'train'])
    expect(r.plans.find(p => p.id === 'train')).toMatchObject({ durationMinutes: 289.5, finalArrivalAt: '2026-11-18T12:50:00-05:00' })
    expect(r.plans.find(p => p.id === 'bus')).toMatchObject({ durationMinutes: 249.5, finalArrivalAt: '2026-11-18T12:10:00-05:00' })
    expect(r.originalConnection).toMatchObject({ marginMinutes: -15.5, shortfallMinutes: 15.5, readyAt: '2026-11-18T09:15:30-05:00' })
    expect(RecoveryResultSchema.safeParse(r).success).toBe(true)
  })
})
