import type { FlightOffer, TravelRecoveryResponse } from '@domain/travel-contracts'
export function travelConversationGuidance(result: TravelRecoveryResponse, nearby: boolean, hasHotel: boolean) {
  const assistance = result.assistance, field = assistance?.clarification?.field
  const fallback = nearby
    ? result.journey
      ? `Nearby airport journey via ${result.request.destinationAirportIata} checked through to ${result.destination.name}. Review the final city arrival and complete journey limits.`
      : result.request.onwardFlight
        ? `${result.onwardOffers?.length ?? 0} onward options checked from ${result.request.destinationAirportIata} to ${result.destination.name} after your arrival allowance. Choose an actual route to continue.`
        : `${result.flightOffers.length} nearby-airport flight quotes checked via ${result.request.destinationAirportIata}. Your final destination remains ${result.destination.name}; onward travel still needs checking.`
    : `${result.flightOffers.length} flight quotes${result.request.overnight ? ` and ${result.hotelOffers.length} origin hotel quotes` : ''} checked. Confirm transfers and allowances before choosing a complete flight journey.`
  return {
    summary: (assistance?.clarification || assistance?.appliedPreferences.drivingAllowed !== true ? assistance?.summary : undefined) ?? fallback,
    openTripEditor: !!field && ['airport', 'readyAt', 'deadlineAt', 'budget', 'preference'].includes(field),
    reviewFacts: field === 'transfer' || (field === 'hotel' && hasHotel),
  }
}
function namesAirport(text: string, airport: string | null | undefined) {
  return !!airport && /^[A-Z]{3}$/.test(airport) && new RegExp(`\\b${airport}\\b`, 'i').test(text)
}
type PlanningContext = { flight: FlightOffer | null; needsOnward: boolean; result: TravelRecoveryResponse | null }
export function hasOnwardConversationContext(primary: PlanningContext, nearby: PlanningContext, active: 'primary' | 'nearby' | null): boolean {
  return Boolean(active === 'nearby' || (primary.flight && primary.needsOnward) || nearby.flight ||
    primary.result?.request.onwardFlight || nearby.result?.request.onwardFlight)
}
export function isTravelMessage(text: string, airports: string[], onwardContext: boolean) {
  return /flight|fly|airport|hotel|overnight|stay|security|connection|transfer/i.test(text) || airports.some(airport => namesAirport(text, airport)) ||
    (onwardContext && /\b(onward|bus(?:es)?|trains?|rail|drive|driving)\b/i.test(text))
}
export function travelMessageTarget(options: { text: string; primaryAirport: string; nearbyAirport?: string | null; active: 'primary' | 'nearby' | null; primaryResult: boolean; nearbyResult: boolean; primaryHasFlights: boolean; nearbyHasFlights: boolean }): 'primary' | 'nearby' {
  if (namesAirport(options.text, options.nearbyAirport)) return 'nearby'
  if (namesAirport(options.text, options.primaryAirport)) return 'primary'
  if (options.active === 'nearby' && options.nearbyResult) return 'nearby'
  if (options.active === 'primary' && options.primaryResult) return 'primary'
  return !options.primaryHasFlights && options.nearbyHasFlights ? 'nearby' : 'primary'
}
