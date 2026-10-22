import { z } from 'zod'
import { CITY_ADAPTER_REVISION, CITY_MAX_FACT_AGE_MS, CityAssistanceSchema, CityCandidateSchema, CityRecoveryInputSchema, CityRecoveryResponseSchema, CitySchema, CityTripRequestSchema, cityClarificationQuestion } from '../domain/city-contracts.ts'
import type { City, CityAssistance, CityCandidate, CityRecoveryResponse, CityTripRequest } from '../domain/city-contracts.ts'
import { findCity as resolveCity } from '../domain/city-resolver.ts'
import { planCityRecovery } from '../domain/city-planner.ts'
import { PreferencePatchSchema } from '../domain/assistance.ts'
import type { PreferencePatch } from '../domain/assistance.ts'
import type { SourceEvidence } from '../domain/schemas.ts'
import { toInstantMillis } from '../domain/time.ts'
import { HttpError, corsHeaders, jsonResponse, readJson } from './http.ts'
import { explicitlyRequestedCityPatch, explicitlyRequestedCityPreferences } from './city-agent-contracts.ts'
import type { CityAgentExecutor, CityAssessment, CityProviderFacts } from './city-agent-contracts.ts'

export type CityProvider = (request: CityTripRequest, context: { signal: AbortSignal; origin: City; destination: City }) => Promise<CityProviderFacts>
const providerFacts = z.strictObject({ candidates: z.array(CityCandidateSchema).max(12), warnings: z.array(z.string().max(500)).max(64) })
const boundedNotes = (values: string[]) => [...new Set(values.filter(value => value.trim()).map(value => value.slice(0, 500)))].slice(0, 32)
const provenanceWarning = 'Traveler-supplied facts are not verified by a server provider; confirm availability before booking.'
const unavailable = (): CityAssistance => ({ status: 'unavailable', summary: 'AI assistance is unavailable. You can still compare the deterministic city journeys.', appliedPreferences: {}, selectedPlanId: null, activity: [] })
const limited = (): CityAssistance => ({ ...unavailable(), status: 'limited', summary: 'AI assistance could not complete a verified recommendation. Review the deterministic city journeys.' })
function sanitizeManual(request: CityTripRequest): CityTripRequest {
  return CityTripRequestSchema.parse({ ...request, confirmedOptions: request.confirmedOptions.map(candidate => ({ ...candidate,
    evidence: candidate.evidence.map(evidence => ({ ...evidence,
      type: request.mode === 'synthetic' ? 'synthetic' : evidence.type === 'traveler_confirmed' ? 'traveler_confirmed' : 'estimated',
      environment: request.mode === 'synthetic' ? 'synthetic' : 'production',
      provider: request.mode === 'synthetic' ? 'Fictional traveler input' : 'Traveler input (not server verified)', sourceUrl: null,
      warnings: boundedNotes([request.mode === 'synthetic' ? 'Fictional scenario; no real availability or quote.' : provenanceWarning, ...evidence.warnings]),
    })),
  })) })
}
function safeEvidence(evidence: SourceEvidence): SourceEvidence {
  if (!evidence.sourceUrl) return evidence
  const url = new URL(evidence.sourceUrl)
  url.search = ''; url.hash = ''; url.username = ''; url.password = ''
  return { ...evidence, sourceUrl: url.toString() }
}
/** Race dependencies even when they ignore cancellation, and remove every listener. */
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Request ended'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

/** Environment-free assembly. The Edge entrypoint owns configuration and credentials. */
export function createCityRecoveryHandler(deps: { now: () => string; findCity?: (id: string) => City | null; provider?: CityProvider; agent?: CityAgentExecutor }): (request: Request) => Promise<Response> {
  return async httpRequest => {
    const controller = new AbortController(), providerController = new AbortController()
    const forwardAbort = () => controller.abort(), abortProvider = () => providerController.abort()
    httpRequest.signal.addEventListener('abort', forwardAbort, { once: true })
    if (httpRequest.signal.aborted) controller.abort()
    controller.signal.addEventListener('abort', abortProvider, { once: true })
    // Starts before body reading; the body has its own tighter five-second budget.
    const totalTimer = setTimeout(() => controller.abort(), 30_000)
    let providerTimer: ReturnType<typeof setTimeout> | undefined
    let open = true
    const active = () => { if (!open || controller.signal.aborted) throw new Error('Request ended') }
    const headers = corsHeaders()
    try {
      if (httpRequest.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (httpRequest.method !== 'POST') { headers.set('Allow', 'POST, OPTIONS'); throw new HttpError(405, 'Use POST to request city recovery plans.') }
      const parsed = CityRecoveryInputSchema.safeParse(await bounded(readJson(httpRequest), controller.signal))
      if (!parsed.success) throw new HttpError(400, 'Invalid city recovery request.')
      active()
      const request = sanitizeManual(parsed.data.request)
      const findCity = deps.findCity ?? resolveCity
      const origin = findCity(request.originCityId), destination = findCity(request.destinationCityId)
      if (!origin || !destination || origin.id !== request.originCityId || destination.id !== request.destinationCityId) throw new HttpError(400, 'Choose valid U.S. origin and destination cities.')
      CitySchema.parse(origin); CitySchema.parse(destination)
      const warnings: string[] = []
      const allowedDiscovery = request.mode === 'real' && parsed.data.investigate
      const discoveryRequest = CityTripRequestSchema.parse({ ...request, ...explicitlyRequestedCityPreferences(parsed.data.refinement ?? '') })
      if (request.mode === 'synthetic' && parsed.data.investigate) warnings.push('Live investigation is unavailable for synthetic trips; fictional supplied facts were compared.')
      let extras: CityCandidate[] = [], latest: CityAssessment | undefined, latestPatch: PreferencePatch = {}, assessmentNumber = 0
      let completeProviderPromise: Promise<CityProviderFacts> | undefined
      const discoverTransport = (): Promise<CityProviderFacts> => {
        active(); latest = undefined; latestPatch = {}
        if (completeProviderPromise) return completeProviderPromise
        completeProviderPromise = (async () => {
          if (!allowedDiscovery) return { candidates: [], warnings: ['Provider investigation was not enabled; supplied facts were retained.'] }
          if (!deps.provider) {
            const notes = ['Optional transport investigation is unavailable; supplied manual facts were retained.']
            warnings.push(...notes)
            return { candidates: [], warnings: notes }
          }
          providerTimer = setTimeout(() => providerController.abort(), 15_000)
          try {
            const raw = await bounded(deps.provider(structuredClone(discoveryRequest), { signal: providerController.signal, origin: structuredClone(origin), destination: structuredClone(destination) }), providerController.signal)
            active()
            const facts = providerFacts.parse(raw)
            if (facts.candidates.some(candidate => candidate.evidence.some(evidence => evidence.environment !== 'production' || evidence.type === 'synthetic'))) throw new Error('Evidence mode mismatch')
            const candidates = facts.candidates.map(candidate => ({ ...candidate, evidence: candidate.evidence.map(safeEvidence) }))
            extras = candidates
            latest = undefined; latestPatch = {}
            const notes = facts.warnings.length ? ['Transport investigation returned qualifications; confirm route details, fares and availability before booking.'] : []
            warnings.push(...notes)
            return { candidates: structuredClone(candidates), warnings: notes }
          } catch {
            active()
            latest = undefined; latestPatch = {}
            const notes = ['Optional transport investigation is unavailable; supplied manual facts were retained.']
            warnings.push(...notes)
            return { candidates: [], warnings: notes }
          }
        })()
        return completeProviderPromise
      }
      const discoverHotels = async (): Promise<CityProviderFacts> => {
        active(); latest = undefined; latestPatch = {}
        const notes = ['National hotel rates are unavailable in this planner. Hotel examples are available in the separate demo.']
        warnings.push(...notes)
        return { candidates: [], warnings: notes }
      }
      const assess = (patch: PreferencePatch): CityAssessment => {
        active()
        const accepted = PreferencePatchSchema.parse(patch)
        if (!explicitlyRequestedCityPatch(parsed.data.refinement ?? '', accepted)) throw new Error('Unrequested preference change')
        const ids = new Set(request.confirmedOptions.map(candidate => candidate.id))
        const candidates = [...request.confirmedOptions]
        for (const candidate of extras) {
          if (ids.has(candidate.id)) { warnings.push('An optional provider duplicate ID was omitted; the supplied option was retained.'); continue }
          ids.add(candidate.id)
          if (candidates.length < 12) candidates.push(candidate)
          else warnings.push('Additional provider options were omitted at the 12-option comparison limit.')
        }
        const canonical = CityTripRequestSchema.parse({ ...request, ...accepted, confirmedOptions: candidates })
        const result = planCityRecovery(canonical, candidates, { now: deps.now(), origin, destination })
        result.warnings = boundedNotes([...result.warnings, ...warnings])
        latestPatch = accepted
        latest = { assessmentId: `assessment-${++assessmentNumber}`, result }
        // An executor cannot mutate the authoritative assessment by reference.
        return structuredClone(latest)
      }
      let assistance: CityAssistance | undefined
      if (parsed.data.refinement) {
        if (request.mode !== 'real' || !deps.agent) assistance = unavailable()
        else {
          try {
            assistance = CityAssistanceSchema.parse(await bounded(deps.agent({ request: structuredClone(request), origin: structuredClone(origin), destination: structuredClone(destination), refinement: parsed.data.refinement,
              ...(parsed.data.conversation ? { conversation: structuredClone(parsed.data.conversation) } : {}), signal: controller.signal,
              tools: { findTransport: discoverTransport, findHotels: discoverHotels, assess: async patch => assess(patch) },
            }), controller.signal))
            active()
            if (assistance.clarification) assistance.summary = cityClarificationQuestion(assistance.clarification)
            if (assistance.status === 'completed') {
              if (!latest || !explicitlyRequestedCityPatch(parsed.data.refinement, assistance.appliedPreferences) ||
                (['priority', 'drivingAllowed'] as const).some(key => assistance!.appliedPreferences[key] !== latestPatch[key]) ||
                (assistance.selectedPlanId === null ? latest.result.plans.length > 0 : !latest.result.plans.some(plan => plan.id === assistance!.selectedPlanId && plan.selectable))) throw new Error('Unassessed recommendation')
            }
          } catch { active(); assistance = limited() }
        }
      }
      if (assistance?.status !== 'completed') {
        if (!assistance?.clarification && allowedDiscovery) await discoverTransport()
        assess({})
        if (assistance) assistance = { ...assistance, appliedPreferences: {}, selectedPlanId: null }
      }
      active()
      const result = latest!.result, candidates = result.request.confirmedOptions
      const evidence = candidates.flatMap(candidate => candidate.evidence)
      const checkedMs = Math.max(toInstantMillis(deps.now()), ...evidence.map(item => toInstantMillis(item.checkedAt)))
      const expiresMs = Math.min(checkedMs + CITY_MAX_FACT_AGE_MS, ...evidence.map(item => toInstantMillis(item.checkedAt) + CITY_MAX_FACT_AGE_MS), ...evidence.flatMap(item => item.expiresAt === null ? [] : [toInstantMillis(item.expiresAt)]))
      const body: CityRecoveryResponse = CityRecoveryResponseSchema.parse({ version: 2, result, facts: { candidates, checkedAt: new Date(checkedMs).toISOString(), expiresAt: new Date(expiresMs).toISOString(), adapterRevision: CITY_ADAPTER_REVISION },
        ...(assistance ? { assistance } : {}), ...(parsed.data.conversation ? { conversation: { turnId: parsed.data.conversation.turnId, baseRevision: parsed.data.conversation.baseRevision } } : {}),
      })
      return jsonResponse(body, 200, headers)
    } catch (error) {
      return jsonResponse({ error: error instanceof HttpError ? error.message : 'Recovery planning is temporarily unavailable.' }, error instanceof HttpError ? error.status : 500, headers)
    } finally {
      open = false
      clearTimeout(totalTimer)
      if (providerTimer !== undefined) clearTimeout(providerTimer)
      controller.abort(); providerController.abort()
      httpRequest.signal.removeEventListener('abort', forwardAbort)
      controller.signal.removeEventListener('abort', abortProvider)
    }
  }
}
