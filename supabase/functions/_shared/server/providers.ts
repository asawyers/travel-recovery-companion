import type { TripRequest } from '../domain/schemas.ts'
import { toInstantMillis } from '../domain/time.ts'
import type { ProviderContext, RoutesAdapter } from './provider-types.ts'

export type ProviderFacts = {
  candidates: unknown[]
  warnings: string[]
}
/** Server-owned adapters only. Browser URLs and provider labels never select an adapter. */
export type ProviderRegistry = {
  gatherPermittedFacts: (request: TripRequest, context: ProviderContext) => Promise<ProviderFacts>
}
export const providerCapabilities = Object.freeze({ transit: 'optional', hotel: 'unavailable', model: 'disabled' })

/** Invoke routes once using the traveler-supplied arrival. */
export function createProviderRegistry(adapters: { routes?: RoutesAdapter }): ProviderRegistry {
  return {
    async gatherPermittedFacts(request, context) {
      const facts: ProviderFacts = { candidates: [], warnings: [] }
      if (request.mode === 'synthetic') {
        facts.warnings.push('Synthetic investigation uses fictional supplied facts; no live provider was called.')
        return facts
      }
      if (context.signal.aborted) return { ...facts, warnings: ['Optional provider investigation was cancelled; manual facts were retained.'] }
      if (toInstantMillis(request.arrivalAt) >= toInstantMillis(request.deadlineAt)) {
        facts.warnings.push('The hard destination deadline is already reached at airport arrival; routes investigation was skipped because no complete journey can qualify.')
        return facts
      }
      if (context.signal.aborted) { facts.warnings.push('Routes investigation is unavailable because the provider deadline ended.'); return facts }
      if (!adapters.routes) facts.warnings.push('Routes investigation is unavailable; no routes provider is configured.')
      else {
        try {
          const routes = await adapters.routes(request, context)
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
