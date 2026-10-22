import { ADAPTER_REVISION, MAX_FACT_AGE_MS, RecoveryInputSchema, RecoveryResponseSchema, originalExpiries } from '../domain/api.ts'
import type { RecoveryResponse } from '../domain/api.ts'
import { normalizeCandidates } from '../domain/candidates.ts'
import { planRecovery } from '../domain/planner.ts'
import { HotelOptionSchema, PlanningTripRequestSchema, SourceEvidenceSchema, TripRequestSchema } from '../domain/schemas.ts'
import type { ConfirmedOption, HotelOption, SourceEvidence, TripRequest } from '../domain/schemas.ts'
import { toInstantMillis, toTripLocalTime } from '../domain/time.ts'
import { HttpError, corsHeaders, jsonResponse, readJson } from './http.ts'
import { AssistanceSchema, PreferencePatchSchema } from '../domain/assistance.ts'
import type { Assistance, PreferencePatch } from '../domain/assistance.ts'
import { clarificationQuestion } from '../domain/conversation.ts'
import { configuredHotelOrigin } from '../domain/handoffs.ts'
import { buildHotelRecovery } from '../domain/hotel-recovery.ts'
import type { AgentDiscovery, AgentExecutor, Assessment } from './agent-contracts.ts'
import type { ProviderFacts, ProviderRegistry, ProviderSession } from './providers.ts'

const PROVIDER_TIMEOUT_MS = 15_000
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
function safeProviderEvidence(evidence: SourceEvidence, mode: TripRequest['mode'], hotelSandbox = false): SourceEvidence {
  if (mode === 'synthetic' && !(hotelSandbox && evidence.environment === 'sandbox' && evidence.type === 'estimated')) return sanitizeEvidence(evidence, mode)
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
    ...request, flight: null, arrivalBasis: request.mode === 'real' ? 'traveler_confirmed' : request.arrivalBasis === 'actual_gate' ? 'traveler_confirmed' : request.arrivalBasis === 'scheduled_gate' ? 'estimated_gate' : request.arrivalBasis,
    confirmedOptions: mapEvidence(request.confirmedOptions, evidence => sanitizeEvidence(evidence, request.mode)),
  })
}
function arrivalEvidence(request: TripRequest, checkedAt: string): SourceEvidence[] {
  return [{
    type: request.mode === 'synthetic' ? 'synthetic' : request.arrivalBasis === 'traveler_confirmed' ? 'traveler_confirmed' : 'estimated',
    environment: request.mode === 'synthetic' ? 'synthetic' : 'production', provider: request.mode === 'synthetic' ? 'Fictional traveler arrival' : 'Traveler arrival input',
    sourceUrl: null, checkedAt, serviceDate: toTripLocalTime(request.arrivalAt).slice(0, 10), providerUpdatedAt: null,
    expiresAt: new Date(toInstantMillis(checkedAt) + MAX_FACT_AGE_MS).toISOString(),
    warnings: request.mode === 'synthetic' ? ['Fictional arrival; used only for this example.'] : [],
  }]
}
/** Races even dependencies that ignore cancellation; always removes listeners. */
function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Request deadline or cancellation'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}
const unavailableAssistance = (): Assistance => ({ status: 'unavailable', summary: 'AI assistance is unavailable. Edit the trip fields to refine the deterministic comparison.', appliedPreferences: {}, selectedPlanId: null, activity: [] })
const limitedAssistance = (): Assistance => ({ ...unavailableAssistance(), status: 'limited', summary: 'AI assistance could not complete a verified recommendation. Your original preferences were retained; review the deterministic comparison.' })

/** Pure handler assembly; the Edge entrypoint owns all environment access. */
export function createRecoveryHandler(deps: { now: () => string; providers: ProviderRegistry; agent?: AgentExecutor; hotelBookingOrigin?: string }): (request: Request) => Promise<Response> {
  return async httpRequest => {
    // Includes body reading, discovery and model work within the browser's 35s deadline.
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    httpRequest.signal.addEventListener('abort', forwardAbort, { once: true })
    if (httpRequest.signal.aborted) controller.abort()
    const totalTimer = setTimeout(() => controller.abort(), 30_000)
    const providerController = new AbortController()
    const abortProviders = () => providerController.abort()
    controller.signal.addEventListener('abort', abortProviders, { once: true })
    let providerTimer: ReturnType<typeof setTimeout> | undefined
    let open = true
    const active = () => { if (!open || controller.signal.aborted) throw new Error('Request ended') }
    const headers = corsHeaders()
    try {
      if (httpRequest.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (httpRequest.method !== 'POST') {
        headers.set('Allow', 'POST, OPTIONS')
        throw new HttpError(405, 'Use POST to request recovery plans.')
      }
      const parsed = RecoveryInputSchema.safeParse(await bounded(readJson(httpRequest), controller.signal))
      if (!parsed.success) throw new HttpError(400, 'Invalid recovery request.')
      const checkedAt = deps.now()
      const request = sanitizeRequest(parsed.data.request)
      const evidence = arrivalEvidence(request, checkedAt)
      const warnings: string[] = []
      let extraCandidates: ConfirmedOption[] = []
      let hotelOffers: HotelOption[] = []
      let latest: Assessment | undefined
      let assessmentNumber = 0
      const hotelSandbox = request.mode === 'synthetic' && request.hotelDataMode === 'sandbox'
      const allowedDiscovery = parsed.data.investigate && (request.mode === 'real' || hotelSandbox)
      if (hotelSandbox) warnings.push('Hotel sandbox / test data: room quotes and onward inputs do not establish live availability or reservations.')
      if (parsed.data.investigate && request.mode === 'synthetic' && !hotelSandbox) warnings.push('Optional live investigation is unavailable for synthetic trips; fictional supplied facts were compared.')
      // A session owns complete adapter promises, including failures and their HTTP caps.
      const context = { signal: providerController.signal, hotelSandbox }
      const session = deps.providers.createSession?.(request, context)
      let legacy: Promise<ProviderFacts> | undefined
      const legacyFacts = () => legacy ??= deps.providers.gatherPermittedFacts(request, context)
      const source: ProviderSession = session ?? {
        findTransport: async () => { const facts = await legacyFacts(); return { candidates: facts.candidates, warnings: facts.warnings } },
        findHotels: async () => {
          if (hotelSandbox) return { candidates: [], offers: [], warnings: ['Hotel sandbox investigation is unavailable without a dedicated sandbox provider session.'] }
          const facts = await legacyFacts(); return { candidates: [], offers: facts.offers, warnings: [] }
        },
      }
      const memo: Partial<Record<'transport' | 'hotels', Promise<AgentDiscovery>>> = {}
      const discover = (kind: 'transport' | 'hotels'): Promise<AgentDiscovery> => {
        active()
        if (memo[kind]) return memo[kind]!
        memo[kind] = (async () => {
          if (!allowedDiscovery) return { candidates: [], offers: [], warnings: ['Provider investigation was not enabled; supplied facts were retained.'] }
          if (kind === 'transport' && request.mode === 'synthetic') return { candidates: [], offers: [], warnings: [] }
          if (kind === 'hotels' && !request.overnightAllowed) return { candidates: [], offers: [], warnings: [] }
          providerTimer ??= setTimeout(() => providerController.abort(), PROVIDER_TIMEOUT_MS)
          try {
            const extra = await bounded(kind === 'transport' ? source.findTransport() : source.findHotels(), providerController.signal)
            active()
            if (!Array.isArray(extra.candidates) || extra.candidates.length > 12 || !Array.isArray(extra.warnings)) throw new Error('Invalid adapter output')
            const adapted = normalizeCandidates(request, extra.candidates)
            const candidates = adapted.candidates.map(candidate => mapEvidence(candidate, item => safeProviderEvidence(item, request.mode, hotelSandbox))) as ConfirmedOption[]
            const rawOffers = extra.offers ?? []
            if (!Array.isArray(rawOffers) || rawOffers.length > 3) throw new Error('Invalid hotel output')
            const parsedOffers = rawOffers.map(offer => HotelOptionSchema.parse(offer))
            if (parsedOffers.some(offer => offer.evidence.some(item => hotelSandbox
              ? item.environment !== 'sandbox' || item.type !== 'estimated'
              : item.environment !== 'production' || item.type === 'synthetic'))) throw new Error('Invalid hotel evidence')
            const offers = parsedOffers.map(offer => HotelOptionSchema.parse(mapEvidence(offer, item => safeProviderEvidence(item, request.mode, hotelSandbox))))
            extraCandidates.push(...candidates)
            hotelOffers.push(...offers)
            hotelOffers = [...new Map(hotelOffers.map(offer => [offer.id, offer])).values()].slice(0, 3)
            const notes = boundedNotes([...adapted.warnings, ...extra.warnings])
            warnings.push(...notes)
            return { candidates, offers, warnings: notes }
          } catch {
            active()
            const notes = [`Optional ${kind === 'transport' ? 'transport' : 'hotel'} investigation is unavailable; supplied manual facts were retained.`]
            warnings.push(...notes)
            return { candidates: [], offers: [], warnings: notes }
          }
        })()
        return memo[kind]!
      }
      const assess = (patch: PreferencePatch): Assessment => {
        const accepted = PreferencePatchSchema.parse(patch)
        const assessmentAt = deps.now()
        const manualIds = new Set(request.confirmedOptions.map(candidate => candidate.id))
        const extras = extraCandidates.filter(candidate => {
          if (!manualIds.has(candidate.id)) return true
          warnings.push(`Optional provider duplicate ID ${candidate.id.slice(0, 100)} was omitted; the supplied manual option was retained.`)
          return false
        })
        const merged = normalizeCandidates(request, [...request.confirmedOptions, ...extras].slice(0, 12))
        const pairing = request.overnightAllowed && (hotelOffers.length || request.hotelSelection)
          ? buildHotelRecovery({ ...request, confirmedOptions: merged.candidates }, hotelOffers, assessmentAt)
          : { candidates: [], warnings: [] }
        const generated = pairing.candidates.filter(candidate => {
          const previous = merged.candidates.find(option => option.id === candidate.id)
          // A historical derived journey may be replaced only by the same explicitly selected property/service.
          return !previous || (previous.kind === 'overnight' && previous.hotel.id === candidate.hotel.id && previous.nextDayTransit.id === candidate.nextDayTransit.id)
        })
        const refreshedIds = new Set(generated.map(candidate => candidate.id))
        const retained = merged.candidates.filter(candidate => !refreshedIds.has(candidate.id))
        if (generated.length !== pairing.candidates.length) warnings.push('A generated hotel journey duplicated an unrelated existing option ID and was omitted; refresh the supplied options.')
        if (retained.length + generated.length > 12) warnings.push('The selected hotel journey was retained within the 12-option comparison limit; the last other option was omitted.')
        const normalized = normalizeCandidates(request, [...retained.slice(0, 12 - generated.length), ...generated])
        const plannedRequest = PlanningTripRequestSchema.parse({ ...request, ...accepted, confirmedOptions: normalized.candidates })
        const result = planRecovery(plannedRequest, normalized.candidates, { now: assessmentAt })
        result.warnings = boundedNotes([...result.warnings, ...merged.warnings, ...normalized.warnings, ...pairing.warnings, ...warnings])
        latest = { assessmentId: `assessment-${++assessmentNumber}`, result }
        return latest
      }
      let assistance: Assistance | undefined
      if (parsed.data.refinement) {
        if (request.mode !== 'real' || !deps.agent) assistance = unavailableAssistance()
        else {
          try {
            assistance = AssistanceSchema.parse(await bounded(deps.agent({ request: structuredClone(request), refinement: parsed.data.refinement, ...(parsed.data.conversation ? { conversation: parsed.data.conversation } : {}), signal: controller.signal, tools: {
              findTransport: () => discover('transport'), findHotels: () => discover('hotels'),
              assess: async patch => { active(); return assess(patch) },
            } }), controller.signal))
            if (assistance.clarification) assistance = { ...assistance, summary: clarificationQuestion(assistance.clarification) }
            if (assistance.status === 'completed') {
              if (!latest || Object.entries(assistance.appliedPreferences).some(([key, value]) => latest!.result.request[key as keyof PreferencePatch] !== value) ||
                (assistance.selectedPlanId !== null && !latest.result.plans.some(plan => plan.id === assistance!.selectedPlanId))) throw new Error('Unassessed assistance')
            }
          } catch { assistance = limitedAssistance() }
        }
      }
      if (assistance?.status !== 'completed') {
        if (!assistance?.clarification && allowedDiscovery && !controller.signal.aborted) await Promise.all([discover('transport'), discover('hotels')]).catch(() => undefined)
        assess({})
        if (assistance) assistance = { ...assistance, appliedPreferences: {}, selectedPlanId: null }
      } else if (!latest) assess({})
      const result = latest!.result
      const candidates = result.request.confirmedOptions
      const expiresAt = [new Date(toInstantMillis(checkedAt) + MAX_FACT_AGE_MS).toISOString(),
        ...originalExpiries([candidates, evidence, hotelOffers])].sort((a, b) => toInstantMillis(a) - toInstantMillis(b))[0]
      const hotelBookingOrigin = hotelSandbox ? null : configuredHotelOrigin(deps.hotelBookingOrigin)
      const body: RecoveryResponse = RecoveryResponseSchema.parse({ result, facts: {
        candidates, arrival: { arrivalAt: result.request.arrivalAt, arrivalBasis: result.request.arrivalBasis }, arrivalEvidence: evidence,
        checkedAt, expiresAt, adapterRevision: ADAPTER_REVISION,
        ...(hotelOffers.length ? { hotelOffers } : {}), ...(hotelBookingOrigin ? { hotelBookingOrigin } : {}),
      }, ...(assistance ? { assistance } : {}), ...(parsed.data.conversation ? { conversation: { turnId: parsed.data.conversation.turnId, baseRevision: parsed.data.conversation.baseRevision } } : {}) })
      return jsonResponse(body, 200, headers)
    } catch (error) {
      return jsonResponse({ error: error instanceof HttpError ? error.message : 'Recovery planning is temporarily unavailable.' }, error instanceof HttpError ? error.status : 500, headers)
    } finally {
      open = false
      clearTimeout(totalTimer)
      if (providerTimer !== undefined) clearTimeout(providerTimer)
      controller.abort(); providerController.abort()
      httpRequest.signal.removeEventListener('abort', forwardAbort)
      controller.signal.removeEventListener('abort', abortProviders)
    }
  }
}
