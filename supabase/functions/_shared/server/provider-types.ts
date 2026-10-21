import type { ConfirmedOption, HotelOption, SourceEvidence, TripRequest } from '../domain/schemas.ts'

export type ProviderResult<T> =
  | { status: 'ok'; data: T; evidence: SourceEvidence[]; warnings: string[] }
  | { status: 'unavailable' | 'ambiguous' | 'error'; reason: string; retryable: boolean }
export type ProviderAdapterOptions = { enabled: boolean; apiKey?: string; now: () => string; fetcher?: typeof fetch }
export type ProviderContext = { signal: AbortSignal }
export type RoutesFacts = { candidates: ConfirmedOption[] }
export type RoutesAdapter = (request: TripRequest, context: ProviderContext) => Promise<ProviderResult<RoutesFacts>>

export type HotelsFacts = { offers: HotelOption[] }
export type HotelsAdapter = (request: TripRequest, context: ProviderContext) => Promise<ProviderResult<HotelsFacts>>
