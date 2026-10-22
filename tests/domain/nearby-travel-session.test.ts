import { describe, expect, it } from 'vitest'
import { travelFixture } from '@domain/travel-fixtures'
import { travelRequestBinding, type TravelRecoveryResponse, type TravelRecoveryInput } from '@domain/travel-contracts'
import { TravelSession, nearbyArrivalAirport } from '../../src/features/travel/useTravelRecovery'
const f = travelFixture()
const base = (input: TravelRecoveryInput): TravelRecoveryResponse => ({ version: 3, request: travelRequestBinding(input), origin: f.origin, destination: f.destination, generatedAt: f.now, expiresAt: '2026-11-18T14:05:00Z', flightOffers: f.flightOffers, hotelOffers: [], sourceStatuses: [], journey: null, selectionIssue: null, warnings: [] })
const onward = { id: 'actual-route', flightOfferId: f.flight.id, flightFingerprint: f.flight.fingerprint, arrivalAirportIata: f.flight.destinationAirportIata, destinationCityId: f.destination.id, airportReadyAt: '2026-11-19T02:30:00Z', kind: 'transit' as const, legs: [], costs: [], evidence: [], confirmations: [] }
describe('nearby arrival session', () => {
  it('finds Boston after filtering the full Portland airport list and excludes selected/origin airports', () => {
    expect(nearbyArrivalAirport(f.destination, 'SAN', 'PWM')?.airport.iata).toBe('BOS')
    expect(nearbyArrivalAirport(f.destination, 'BOS', 'PWM')).toBeNull()
  })
  it('looks up actual onward options only after explicit arrival allowance and binds the chosen option during confirmation', async () => {
    const inputs: TravelRecoveryInput[] = []
    const session = new TravelSession({ now: () => f.now, transport: async input => { inputs.push(input); return { ...base(input), ...(input.onwardFlight ? { onwardOffers: [onward] } : {}) } } })
    await session.search({ ...f.input, selection: null })
    session.planFlight(f.flight, true)
    expect(session.getSnapshot().editingFacts).toBe(false)
    expect(session.getSnapshot().needsOnward).toBe(true)
    await session.searchOnward(30)
    expect(inputs.at(-1)?.onwardFlight).toEqual({ flightOfferId: f.flight.id, flightFingerprint: f.flight.fingerprint, arrivalProcessingMinutes: 30 })
    expect(session.getSnapshot().flight?.id).toBe(f.flight.id)
    session.planOnward(onward)
    expect(session.getSnapshot().editingFacts).toBe(true)
    await session.confirm({ ...f.input.selection!.facts, arrivalProcessingMinutes: 30 })
    expect(inputs).toHaveLength(2)
    expect(session.getSnapshot().result?.request.selection?.onwardOfferId).toBe('actual-route')
    expect(inputs.at(-1)?.onwardFlight?.arrivalProcessingMinutes).toBe(30)
  })
  it('clears onward route and allowance stage on cancel, changed quote and edit', async () => {
    const session = new TravelSession({ now: () => f.now, transport: async input => ({ ...base(input), onwardOffers: [onward] }) })
    await session.search({ ...f.input, selection: null })
    session.planFlight(f.flight, true)
    await session.searchOnward(30)
    session.planOnward(onward)
    session.cancel()
    expect(session.getSnapshot().onward).toBeNull()
    expect(session.getSnapshot().needsOnward).toBe(false)
    session.planFlight(f.flight, true)
    session.options.transport = async input => ({ ...base(input), selectionIssue: 'flight_changed', onwardOffers: [] })
    await session.searchOnward(30)
    expect(session.getSnapshot().flight).toBeNull()
    expect(session.getSnapshot().onward).toBeNull()
    session.edit()
    expect(session.getSnapshot().needsOnward).toBe(false)
  })
})

it('requires actual onward planning for a distant primary airport, independently of comparison group', async () => {
  const ui = await import('../../src/features/travel/useTravelRecovery')
  expect(ui.requiresOnwardTravel('BOS', f.destination)).toBe(true)
  expect(ui.requiresOnwardTravel('PWM', f.destination)).toBe(false)
})
