import { ADAPTER_REVISION, MAX_FACT_AGE_MS, RecoveryInputSchema, RecoveryResponseSchema, originalExpiries } from '../domain/api.ts'
import type { RecoveryResponse } from '../domain/api.ts'
import { normalizeCandidates } from '../domain/candidates.ts'
import { planRecovery } from '../domain/planner.ts'
import { SourceEvidenceSchema, TripRequestSchema } from '../domain/schemas.ts'
import type { ConfirmedOption, SourceEvidence, TripRequest } from '../domain/schemas.ts'
import { toInstantMillis, toTripLocalTime } from '../domain/time.ts'
import { HttpError, corsHeaders, jsonResponse, readJson } from './http.ts'
import type { ProviderFacts, ProviderRegistry } from './providers.ts'

const PROVIDER_TIMEOUT_MS = 3_000
const PROVENANCE_WARNING = 'Traveler-supplied facts are not verified by a server provider; confirm availability before booking.'
const boundedNotes = (values: string[]) => [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.slice(0, 500)))].slice(0, 32)

function sanitizeEvidence(evidence: SourceEvidence, mode: TripRequest['mode']): SourceEvidence {
  return {
    ...evidence, type: mode === 'synthetic' ? 'synthetic' : evidence.type === 'traveler_confirmed' ? 'traveler_confirmed' : 'estimated',
    environment: mode === 'synthetic' ? 'synthetic' : 'production', provider: mode === 'synthetic' ? 'Fictional traveler input' : 'Traveler input (not server verified)',
    sourceUrl: null, warnings: boundedNotes([mode === 'synthetic' ? 'Fictional scenario; no real availability or quote.' : PROVENANCE_WARNING, ...evidence.warnings]),
  }
}
function mapEvidence(value: unknown, transform: (evidence: SourceEvidence) => SourceEvidence): unknown {
  if (Array.isArray(value)) return value.map(item => mapEvidence(item, transform))
  if (value !== null && typeof value === 'object') {
    if ('type' in value && 'environment' in value) return transform(SourceEvidenceSchema.parse(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapEvidence(item, transform)]))
  }
  return value
}
function safeProviderEvidence(evidence: SourceEvidence, mode: TripRequest['mode']): SourceEvidence {
  if (mode === 'synthetic') return sanitizeEvidence(evidence, mode)
  let sourceUrl = evidence.sourceUrl
  if (sourceUrl) {
    const url = new URL(sourceUrl)
    url.search = ''; url.hash = ''
    sourceUrl = url.toString()
  }
  return { ...evidence, sourceUrl }
}
function sanitizeRequest(request: TripRequest): TripRequest {
  return TripRequestSchema.parse({
    ...request, arrivalBasis: request.arrivalBasis === 'actual_gate' ? 'traveler_confirmed' : request.arrivalBasis === 'scheduled_gate' ? 'estimated_gate' : request.arrivalBasis,
    confirmedOptions: mapEvidence(request.confirmedOptions, evidence => sanitizeEvidence(evidence, request.mode)),
  })
}
function arrivalEvidence(request: TripRequest, checkedAt: string): SourceEvidence[] {
  return [{
    type: request.mode === 'synthetic' ? 'synthetic' : request.arrivalBasis === 'traveler_confirmed' ? 'traveler_confirmed' : 'estimated',
    environment: request.mode === 'synthetic' ? 'synthetic' : 'production', provider: request.mode === 'synthetic' ? 'Fictional traveler arrival' : 'Traveler arrival input (not server verified)',
    sourceUrl: null, checkedAt, serviceDate: toTripLocalTime(request.arrivalAt).slice(0, 10), providerUpdatedAt: null,
    expiresAt: new Date(toInstantMillis(checkedAt) + MAX_FACT_AGE_MS).toISOString(),
    warnings: [request.mode === 'synthetic' ? 'Fictional arrival; no actual flight status was checked.' : PROVENANCE_WARNING],
  }]
}
async function investigate(providers: ProviderRegistry, request: TripRequest): Promise<ProviderFacts> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([providers.gatherPermittedFacts(request, { signal: controller.signal }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Provider deadline')) }, PROVIDER_TIMEOUT_MS)
    })])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}

/** Pure handler assembly; the Edge entrypoint owns all environment access. */
export function createRecoveryHandler(deps: { now: () => string; allowedOrigins: string[]; providers: ProviderRegistry }): (request: Request) => Promise<Response> {
  return async httpRequest => {
    const origin = httpRequest.headers.get('origin')
    const allowed = origin === null || deps.allowedOrigins.includes(origin)
    const headers = corsHeaders(allowed ? origin : null)
    try {
      if (!allowed) throw new HttpError(403, 'Origin is not allowed.')
      if (httpRequest.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (httpRequest.method !== 'POST') {
        headers.set('Allow', 'POST, OPTIONS')
        throw new HttpError(405, 'Use POST to request recovery plans.')
      }
      const parsed = RecoveryInputSchema.safeParse(await readJson(httpRequest))
      if (!parsed.success) throw new HttpError(400, 'Invalid recovery request.')
      // Collection uses real server time, including explicitly fictional trips.
      const checkedAt = deps.now()
      let request = sanitizeRequest(parsed.data.request)
      let evidence = arrivalEvidence(request, checkedAt)
      const warnings: string[] = []
      let extraCandidates: unknown[] = []
      if (parsed.data.investigate) {
        try {
          const extra = await investigate(deps.providers, request)
          if (!Array.isArray(extra.candidates) || extra.candidates.length > 12 || !Array.isArray(extra.warnings)) throw new Error('Invalid adapter output')
          const adapted = normalizeCandidates(request, extra.candidates)
          extraCandidates = adapted.candidates.map(candidate => mapEvidence(candidate, item => safeProviderEvidence(item, request.mode)))
          warnings.push(...adapted.warnings)
          if (extra.arrival) {
            try {
              if (!extra.arrivalEvidence?.length || extra.arrivalEvidence.length > 16) throw new Error('Missing arrival provenance')
              const enriched = TripRequestSchema.parse({ ...request, ...extra.arrival })
              const enrichedEvidence = extra.arrivalEvidence.map(item => SourceEvidenceSchema.parse(item))
              const consistent = enrichedEvidence.every(item => request.mode === 'synthetic'
                ? item.type === 'synthetic' && item.environment === 'synthetic'
                : item.environment === 'production' && item.type !== 'synthetic' && (enriched.arrivalBasis !== 'actual_gate' || item.type === 'live'))
              if (!consistent) throw new Error('Invalid arrival mode')
              request = enriched
              evidence = enrichedEvidence.map(item => safeProviderEvidence(item, request.mode))
            } catch { warnings.push('Optional arrival investigation is unavailable; traveler arrival input was retained.') }
          }
          warnings.push(...boundedNotes(extra.warnings))
        } catch { warnings.push('Optional provider investigation is unavailable; supplied manual facts were retained. No live availability was checked.') }
      }
      // Keep supported manual inputs even when adapters exceed the combined capacity.
      const normalized = normalizeCandidates(request, [...request.confirmedOptions, ...extraCandidates].slice(0, 12))
      const candidates: ConfirmedOption[] = normalized.candidates
      request = TripRequestSchema.parse({ ...request, confirmedOptions: candidates })
      const result = planRecovery(request, candidates, { now: checkedAt })
      result.warnings = boundedNotes([...result.warnings, ...normalized.warnings, ...warnings])
      const expiresAt = [new Date(toInstantMillis(checkedAt) + MAX_FACT_AGE_MS).toISOString(),
        ...originalExpiries([candidates, evidence])].sort((a, b) => toInstantMillis(a) - toInstantMillis(b))[0]
      const body: RecoveryResponse = RecoveryResponseSchema.parse({ result, facts: {
        candidates, arrival: { arrivalAt: request.arrivalAt, arrivalBasis: request.arrivalBasis }, arrivalEvidence: evidence,
        checkedAt, expiresAt, adapterRevision: ADAPTER_REVISION,
      } })
      return jsonResponse(body, 200, headers)
    } catch (error) {
      return jsonResponse({ error: error instanceof HttpError ? error.message : 'Recovery planning is temporarily unavailable.' }, error instanceof HttpError ? error.status : 500, headers)
    }
  }
}
