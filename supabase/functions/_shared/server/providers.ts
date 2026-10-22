import type { HotelOption, TripRequest } from '../domain/schemas.ts'
import { toInstantMillis } from '../domain/time.ts'
import type { HotelsAdapter, ProviderContext, RoutesAdapter } from './provider-types.ts'

export type ProviderFacts = {
  candidates: unknown[]
  warnings: string[]
  offers?: HotelOption[]
}
export type ProviderSession = {
  findTransport: () => Promise<ProviderFacts>
  findHotels: () => Promise<ProviderFacts>
}
/** Server-owned adapters only. Browser URLs and provider labels never select an adapter. */
export type ProviderRegistry = {
  // Optional for compatibility with caller-supplied registries implementing the original gather contract.
  createSession?: (request: TripRequest, context: ProviderContext) => ProviderSession
  gatherPermittedFacts: (request: TripRequest, context: ProviderContext) => Promise<ProviderFacts>
}
export const providerCapabilities = Object.freeze({ transit: 'optional', hotel: 'unavailable', model: 'disabled' })
const empty = (warning: string): ProviderFacts => ({ candidates: [], offers: [], warnings: [warning] })

/** Memoized per-request discovery. Caller owns the aggregate deadline and shared cancellation signal. */
export function createProviderRegistry(adapters: { routes?: RoutesAdapter; hotels?: HotelsAdapter; sandboxHotels?: HotelsAdapter }): ProviderRegistry {
  const createSession = (request: TripRequest, context: ProviderContext): ProviderSession => {
    let transport: Promise<ProviderFacts> | undefined
    let hotels: Promise<ProviderFacts> | undefined
    const hotelSandbox = request.mode === 'synthetic' && request.hotelDataMode === 'sandbox' && context.hotelSandbox === true
    function blocked(permitSandboxHotels = false): ProviderFacts | undefined {
      if (request.mode === 'synthetic' && !(permitSandboxHotels && hotelSandbox)) return empty('Synthetic investigation uses fictional supplied facts; no live provider was called.')
      if (context.signal.aborted) return empty('Optional provider investigation was cancelled; manual facts were retained.')
      if (request.deadlineAt !== null && toInstantMillis(request.arrivalAt) >= toInstantMillis(request.deadlineAt)) return empty('The hard destination deadline is already reached at airport arrival; routes and hotel investigation were skipped because no complete journey can qualify.')
      return undefined
    }
    async function findTransport(): Promise<ProviderFacts> {
      const skip = blocked()
      if (skip) return skip
      if (!adapters.routes) return empty('Routes investigation is unavailable; no routes provider is configured.')
      try {
        const result = await adapters.routes(request, context)
        if (result.status !== 'ok') return empty(`Routes investigation is ${result.status}: ${result.reason}`)
        return { candidates: result.data.candidates, offers: [], warnings: result.warnings }
      } catch { return empty('Routes investigation is unavailable; supplied manual options were retained.') }
    }
    async function findHotels(): Promise<ProviderFacts> {
      const skip = blocked(true)
      if (skip) return skip
      if (!request.overnightAllowed || request.stay === null) return empty('Hotel investigation is unavailable without overnight permission and an explicit intended stay.')
      const adapter = hotelSandbox ? adapters.sandboxHotels : adapters.hotels
      if (!adapter) return empty(hotelSandbox ? 'Hotel sandbox is unavailable; no sandbox hotel provider is configured.' : 'Hotel investigation is unavailable; no live hotel availability was checked because no hotel provider is configured.')
      try {
        const result = await adapter(request, context)
        if (result.status !== 'ok') return empty(`Hotel investigation is ${result.status}: ${result.reason}`)
        return { candidates: [], offers: result.data.offers, warnings: result.warnings }
      } catch { return empty('Hotel investigation is unavailable; supplied manual options were retained.') }
    }
    // Keep each whole promise, including failure, so concurrent or repeated tool calls cannot repeat provider traffic.
    return { findTransport: () => transport ??= findTransport(), findHotels: () => hotels ??= findHotels() }
  }
  return {
    createSession,
    async gatherPermittedFacts(request, context) {
      const session = createSession(request, context)
      const [transport, hotels] = await Promise.all([session.findTransport(), session.findHotels()])
      const facts: ProviderFacts = { candidates: transport.candidates, warnings: [...new Set([...transport.warnings, ...hotels.warnings])] }
      if (hotels.offers?.length) facts.offers = hotels.offers
      return facts
    },
  }
}

/** Default deployment remains usable without provider credentials or activation. */
export const disabledProviders: ProviderRegistry = createProviderRegistry({})
