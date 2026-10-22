import { describe, expect, it } from 'vitest'
import { travelFixture } from '@domain/travel-fixtures'
import { travelRequestBinding, type TravelRecoveryResponse } from '@domain/travel-contracts'
const ui = () => import('../../src/features/travel/travelConversation').catch(() => null)
const f = travelFixture()
function response(field?: string): TravelRecoveryResponse {
  return { version: 3, request: travelRequestBinding(f.input), origin: f.origin, destination: f.destination, generatedAt: f.now, expiresAt: '2026-11-18T14:05:00Z', flightOffers: f.flightOffers, hotelOffers: [], sourceStatuses: [], journey: null, selectionIssue: null, warnings: [],
    assistance: { status: 'limited', summary: 'Which arrival allowance should I use for BOS?', appliedPreferences: {}, selectedPlanId: null, activity: [], ...(field ? { clarification: { field: field as never, reason: 'required' } } : {}) } }
}
describe('travel conversation guidance', () => {
  for (const field of ['airport', 'readyAt', 'deadlineAt', 'budget', 'preference']) it(`shows the nearby ${field} clarification and opens the trip editor`, async () => {
    const m = await ui(); expect(m).not.toBeNull()
    expect(m!.travelConversationGuidance(response(field), true, false)).toEqual({ summary: 'Which arrival allowance should I use for BOS?', openTripEditor: true, reviewFacts: false })
  })
  for (const field of ['transfer', 'hotel']) it(`opens the same facts review for a nearby ${field} clarification`, async () => {
    const m = await ui(); expect(m).not.toBeNull()
    expect(m!.travelConversationGuidance(response(field), true, true)).toMatchObject({ summary: 'Which arrival allowance should I use for BOS?', openTripEditor: false, reviewFacts: true })
  })
  it('routes onward terms and current airport codes to the travel conversation', async () => {
    const m = await ui(); expect(m).not.toBeNull()
    for (const text of ['What trains leave BOS?', 'Can I drive onward from BOS?', 'Bus options please', 'Show me PWM']) expect(m!.isTravelMessage(text, ['PWM', 'BOS'], true)).toBe(true)
    expect(m!.isTravelMessage('Bus options please', [], false)).toBe(false)
  })
  it('uses a known active result, otherwise prefers a flight result over an empty primary search', async () => {
    const m = await ui(); expect(m).not.toBeNull()
    const options = { text: 'Show flights', primaryAirport: 'PWM', nearbyAirport: 'BOS', active: null, primaryResult: true, nearbyResult: true, primaryHasFlights: false, nearbyHasFlights: true } as const
    expect(m!.travelMessageTarget(options)).toBe('nearby')
    expect(m!.travelMessageTarget({ ...options, active: 'nearby', nearbyResult: false, nearbyHasFlights: false })).toBe('primary')
    expect(m!.travelMessageTarget({ ...options, text: 'Show PWM flights', active: 'nearby' })).toBe('primary')
  })
})

it('keeps a bare bus request in the direct-primary airport onward flow before route lookup', async () => {
  const m = await ui(); expect(m).not.toBeNull()
  const primary = { flight: f.flight, needsOnward: true, result: response() }
  const nearby = { flight: null, needsOnward: false, result: null }
  const context = m!.hasOnwardConversationContext(primary, nearby, 'primary')
  expect(context).toBe(true)
  expect(m!.isTravelMessage('Bus options please', ['BOS'], context)).toBe(true)
  expect(m!.hasOnwardConversationContext({ ...primary, needsOnward: false }, nearby, 'primary')).toBe(false)
})

it('retries the primary flight source when both the failed primary and the alternate have no inventory', async () => {
  const m = await ui(); expect(m).not.toBeNull()
  expect(m!.travelMessageTarget({ text: 'Find flights', primaryAirport: 'PWM', nearbyAirport: 'BOS', active: null,
    primaryResult: false, nearbyResult: true, primaryHasFlights: false, nearbyHasFlights: false })).toBe('primary')
})
