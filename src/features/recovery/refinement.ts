import { MAX_FACT_AGE_MS, originalExpiries } from "@domain/api";
import type { NormalizedFacts } from "@domain/api";
import type { TripRequest } from "@domain/schemas";
import { toInstantMillis } from "@domain/time";
export type TabFactsCache = { inputKey: string; facts: NormalizedFacts };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function buildReuseKey(
  request: TripRequest,
  adapterRevision: string,
): string {
  const { priority: _priority, ...facts } = request;
  return JSON.stringify(canonical({ adapterRevision, request: facts }));
}
export function canReuseFacts(
  cache: TabFactsCache | null,
  request: TripRequest,
  now: number,
  adapterRevision: string,
): boolean {
  if (
    !cache ||
    cache.inputKey !== buildReuseKey(request, adapterRevision) ||
    cache.facts.adapterRevision !== adapterRevision ||
    !Number.isFinite(now)
  )
    return false;
  try {
    const checked = toInstantMillis(cache.facts.checkedAt);
    const expires = Math.min(
      toInstantMillis(cache.facts.expiresAt),
      checked + MAX_FACT_AGE_MS,
      ...originalExpiries([
        cache.facts.candidates,
        cache.facts.arrivalEvidence,
        cache.facts.hotelOffers,
      ]).map(toInstantMillis),
    );
    return checked <= now && now < expires;
  } catch {
    return false;
  }
}
