import type { SourceEvidence, TripRequest } from '../domain/schemas.ts'

export type ProviderFacts = {
  candidates: unknown[]
  arrival?: Pick<TripRequest, 'arrivalAt' | 'arrivalBasis'>
  arrivalEvidence?: SourceEvidence[]
  warnings: string[]
}
/** Server-owned adapters only. Browser URLs and provider labels never select an adapter. */
export type ProviderRegistry = {
  gatherPermittedFacts: (request: TripRequest, context: { signal: AbortSignal }) => Promise<ProviderFacts>
}
export const providerCapabilities = Object.freeze({ flight: 'unavailable', transit: 'unavailable', hotel: 'unavailable', model: 'disabled' })

/** No credentials, approved spending caps or production adapters are configured. */
export const disabledProviders: ProviderRegistry = {
  async gatherPermittedFacts() {
    return { candidates: [], warnings: ['Flight, transit, hotel and model investigation are unavailable; only supplied manual facts were compared. No live availability was checked.'] }
  },
}
