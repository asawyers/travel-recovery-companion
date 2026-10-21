import { FlightStatusReportSchema, SourceEvidenceSchema, PlanningTripRequestSchema } from '../domain/schemas.ts'
import type { FlightStatusReport, SourceEvidence, TripRequest } from '../domain/schemas.ts'
import { toInstantMillis } from '../domain/time.ts'
import type { FlightAdapter, ProviderContext, RoutesAdapter } from './provider-types.ts'

export type ProviderFacts = {
  candidates: unknown[]
  arrival?: Pick<TripRequest, 'arrivalAt' | 'arrivalBasis'>
  arrivalEvidence?: SourceEvidence[]
  flightStatus?: FlightStatusReport
  warnings: string[]
}
/** Server-owned adapters only. Browser URLs and provider labels never select an adapter. */
export type ProviderRegistry = {
  gatherPermittedFacts: (request: TripRequest, context: ProviderContext) => Promise<ProviderFacts>
}
export const providerCapabilities = Object.freeze({ flight: 'optional', transit: 'optional', hotel: 'unavailable', model: 'disabled' })

/** Invoke each adapter once; routes receive the validated, accepted arrival. */
export function createProviderRegistry(adapters: { flight?: FlightAdapter; routes?: RoutesAdapter }): ProviderRegistry {
  return {
    async gatherPermittedFacts(request, context) {
      const facts: ProviderFacts = { candidates: [], warnings: [] }
      if (request.mode === 'synthetic') {
        facts.warnings.push('Synthetic investigation uses fictional supplied facts; no live provider was called.')
        return facts
      }
      if (context.signal.aborted) return { ...facts, warnings: ['Optional provider investigation was cancelled; manual facts were retained.'] }
      let acceptedRequest = request
      if (!adapters.flight) facts.warnings.push('Flight investigation is unavailable; no flight provider is configured.')
      else {
        try {
          const flight = await adapters.flight(request, context)
          if (flight.status !== 'ok') facts.warnings.push(`Flight investigation is ${flight.status}: ${flight.reason}`)
          else {
            facts.flightStatus = FlightStatusReportSchema.parse(flight.data.report)
            facts.warnings.push(...flight.warnings)
            if (flight.data.arrival && request.arrivalBasis !== 'traveler_confirmed') {
              try {
                const enriched = PlanningTripRequestSchema.parse({ ...request, ...flight.data.arrival })
                if (!flight.evidence.length || flight.evidence.length > 16) throw new Error('Missing arrival evidence')
                const evidence = flight.evidence.map(item => SourceEvidenceSchema.parse(item))
                if (!evidence.every(item => item.environment === 'production' && item.type !== 'synthetic' && (enriched.arrivalBasis !== 'actual_gate' || item.type === 'live'))) throw new Error('Invalid arrival evidence')
                acceptedRequest = enriched
                facts.arrival = flight.data.arrival
                facts.arrivalEvidence = evidence
              } catch { facts.warnings.push('Optional arrival investigation is unavailable; traveler arrival input was retained.') }
            }
          }
        } catch { facts.warnings.push('Flight investigation is unavailable; traveler arrival input was retained.') }
      }
      if (toInstantMillis(acceptedRequest.arrivalAt) >= toInstantMillis(acceptedRequest.deadlineAt)) {
        facts.warnings.push('The hard destination deadline is already reached at airport arrival; routes investigation was skipped because no complete journey can qualify.')
        return facts
      }
      if (context.signal.aborted) { facts.warnings.push('Routes investigation is unavailable because the provider deadline ended.'); return facts }
      if (!adapters.routes) facts.warnings.push('Routes investigation is unavailable; no routes provider is configured.')
      else {
        try {
          const routes = await adapters.routes(acceptedRequest, context)
          if (routes.status !== 'ok') facts.warnings.push(`Routes investigation is ${routes.status}: ${routes.reason}`)
          else { facts.candidates = routes.data.candidates; facts.warnings.push(...routes.warnings) }
        } catch { facts.warnings.push('Routes investigation is unavailable; supplied manual options were retained.') }
      }
      facts.warnings.push('Hotel investigation is unavailable; no live hotel availability was checked.')
      return facts
    },
  }
}

/** Default deployment remains usable without provider credentials or activation. */
export const disabledProviders: ProviderRegistry = createProviderRegistry({})
