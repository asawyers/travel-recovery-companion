import { z } from 'zod'
import type { City } from './city-types.ts'
import { CostLineSchema, SourceEvidenceSchema } from './schemas.ts'
import { AgentActivitySchema, PreferencePatchSchema } from './assistance.ts'
import { ConversationContextSchema, ConversationEchoSchema } from './conversation.ts'
import { toInstantMillis } from './time.ts'

export type { City } from './city-types.ts'
export const CITY_ADAPTER_REVISION = 'public-city-v1' as const
export const CITY_MAX_FACT_AGE_MS = 300_000
const text = z.string().trim().min(1).max(500)
const id = z.string().trim().min(1).max(100)
const notes = z.array(text).max(32)
const cityId = z.string().max(100).regex(/^geonames:\d+$/)
const timestamp = z.string().max(40).refine(value => {
  try { toInstantMillis(value); return true } catch { return false }
}, 'Expected a valid timestamp with an explicit offset')
const timeZone = z.string().min(1).max(100).refine(value => {
  if (/^[+-]/.test(value)) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true } catch { return false }
}, 'Expected a valid IANA time zone')
const latitude = z.number().min(-90).max(90)
const longitude = z.number().min(-180).max(180)
const instant = (value: string): number | null => {
  try { return toInstantMillis(value) } catch { return null }
}

export const CitySchema = z.strictObject({
  id: cityId, name: text, stateCode: z.string().regex(/^[A-Z]{2}$/), stateName: text,
  countryCode: z.enum(['US', 'PR', 'VI', 'GU', 'AS', 'MP']), countyName: text.nullable(),
  latitude, longitude, timeZone,
}) satisfies z.ZodType<City>

export const CityPlaceSchema = z.strictObject({ name: text, latitude: latitude.nullable(), longitude: longitude.nullable() })
  .refine(value => (value.latitude === null) === (value.longitude === null), 'Place coordinates must be a WGS84 pair or both null')
export type CityPlace = z.infer<typeof CityPlaceSchema>

export const CityLegSchema = z.strictObject({
  id, mode: z.enum(['walk', 'wait', 'bus', 'rail', 'subway', 'tram', 'ferry', 'drive']),
  from: CityPlaceSchema, to: CityPlaceSchema, startAt: timestamp, endAt: timestamp,
  departureTimeZone: timeZone, arrivalTimeZone: timeZone, operator: text.nullable(), service: text.nullable(),
  vehicleId: id.nullable(), assumptions: notes,
}).superRefine((leg, ctx) => {
  const start = instant(leg.startAt), end = instant(leg.endAt)
  if (start !== null && end !== null && end < start) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Leg end must not precede its start' })
})
export type CityLeg = z.infer<typeof CityLegSchema>

const candidateFields = {
  id, title: text, kind: z.enum(['transit', 'driving_estimate']), originCityId: cityId, destinationCityId: cityId,
  legs: z.array(CityLegSchema).min(1).max(96), costs: z.array(CostLineSchema).min(1).max(32),
  evidence: z.array(SourceEvidenceSchema).min(1).max(16), confirmations: notes,
}
export const CityCandidateSchema = z.strictObject(candidateFields)
export type CityCandidate = z.infer<typeof CityCandidateSchema>

function checkMode(candidates: CityCandidate[], mode: 'real' | 'synthetic', ctx: z.RefinementCtx, path: PropertyKey[]): void {
  candidates.forEach((candidate, index) => candidate.evidence.forEach((evidence, source) => {
    const allowed = mode === 'real' ? evidence.environment === 'production' && evidence.type !== 'synthetic' : evidence.environment !== 'production'
    if (!allowed) ctx.addIssue({ code: 'custom', path: [...path, index, 'evidence', source], message: 'Evidence environment must match the explicit request mode' })
  }))
}
export const CityTripRequestSchema = z.strictObject({
  version: z.literal(2), mode: z.enum(['real', 'synthetic']), originCityId: cityId, destinationCityId: cityId,
  readyAt: timestamp, deadlineAt: timestamp.nullable(), budgetCents: z.number().int().min(0).max(100_000_000).nullable(),
  budgetMode: z.enum(['hard', 'soft']), drivingAllowed: z.boolean(), priority: z.enum(['earliest', 'cheapest', 'fewest_transfers']),
  confirmedOptions: z.array(CityCandidateSchema).max(12),
}).superRefine((request, ctx) => {
  if (request.originCityId === request.destinationCityId) ctx.addIssue({ code: 'custom', path: ['destinationCityId'], message: 'Origin and destination must be distinct cities' })
  checkMode(request.confirmedOptions, request.mode, ctx, ['confirmedOptions'])
})
export type CityTripRequest = z.infer<typeof CityTripRequestSchema>

export const CityPlanSchema = z.strictObject({
  ...candidateFields, finalArrivalAt: timestamp, durationMinutes: z.number().nonnegative(), transfers: z.number().int().min(0).max(95),
  knownCostCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), priceComplete: z.boolean(),
  feasibility: z.enum(['schedule_feasible', 'requires_confirmation', 'infeasible']), selectable: z.boolean(),
  violations: notes, warnings: notes, evidenceExpiresAt: timestamp.nullable(),
}).superRefine((plan, ctx) => {
  if (plan.finalArrivalAt !== plan.legs.at(-1)?.endAt) ctx.addIssue({ code: 'custom', path: ['finalArrivalAt'], message: 'Arrival must equal the final leg end' })
  if ((plan.feasibility === 'infeasible') !== (plan.violations.length > 0) || (plan.selectable && plan.feasibility === 'infeasible')) {
    ctx.addIssue({ code: 'custom', path: ['feasibility'], message: 'Feasibility and selection must agree with violations' })
  }
  const expiries = plan.evidence.map(e => e.expiresAt).filter((e): e is string => e !== null)
  const earliest = expiries.reduce<string | null>((best, next) => best === null || (instant(next) ?? Infinity) < (instant(best) ?? Infinity) ? next : best, null)
  if (earliest !== null && (plan.evidenceExpiresAt === null || (instant(plan.evidenceExpiresAt) ?? Infinity) > (instant(earliest) ?? Infinity))) {
    ctx.addIssue({ code: 'custom', path: ['evidenceExpiresAt'], message: 'Plan cannot outlive its original evidence' })
  }
})
export type CityPlan = z.infer<typeof CityPlanSchema>

function checkCityBinding(request: CityTripRequest, origin: City, destination: City, ctx: z.RefinementCtx): void {
  if (origin.id !== request.originCityId) ctx.addIssue({ code: 'custom', path: ['origin'], message: 'Origin metadata must match the selected city ID' })
  if (destination.id !== request.destinationCityId) ctx.addIssue({ code: 'custom', path: ['destination'], message: 'Destination metadata must match the selected city ID' })
}
export const CityRecoveryResultSchema = z.strictObject({
  version: z.literal(2), request: CityTripRequestSchema, origin: CitySchema, destination: CitySchema,
  generatedAt: timestamp, plans: z.array(CityPlanSchema).max(3), rejected: z.array(CityPlanSchema).max(12), warnings: notes,
}).superRefine((result, ctx) => {
  checkCityBinding(result.request, result.origin, result.destination, ctx)
  checkMode([...result.plans, ...result.rejected], result.request.mode, ctx, ['plans'])
  for (const [index, plan] of result.plans.entries()) {
    if (!plan.selectable || plan.originCityId !== result.origin.id || plan.destinationCityId !== result.destination.id) {
      ctx.addIssue({ code: 'custom', path: ['plans', index], message: 'Ranked plans must be selectable journeys between the selected cities' })
    }
  }
  if (result.rejected.some(plan => plan.selectable)) ctx.addIssue({ code: 'custom', path: ['rejected'], message: 'Rejected plans must not be selectable' })
  const ids = [...result.plans, ...result.rejected].map(plan => plan.id)
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['plans'], message: 'Plan IDs must be unique' })
})
export type CityRecoveryResult = z.infer<typeof CityRecoveryResultSchema>

export const CityClarificationSchema = z.strictObject({
  field: z.enum(['origin', 'destination', 'readyAt', 'deadlineAt', 'budget', 'preference', 'hotel']),
  reason: z.enum(['required', 'ambiguous', 'conflicting', 'unsupported']),
})
export type CityClarification = z.infer<typeof CityClarificationSchema>
const questions: Record<CityClarification['field'], string> = {
  origin: 'Which U.S. origin city and state should I use?',
  destination: 'Which U.S. destination city and state should I use?',
  readyAt: 'When will you be ready to leave the origin city? Include the local date, time, and time zone.',
  deadlineAt: 'What is your latest acceptable arrival at the destination, including its time zone, or should I find the earliest arrival?',
  budget: 'What budget should I use, and is it a hard limit or a preference?',
  preference: 'Should I change driving permission or prioritize earliest arrival, lowest price, or fewest transfers?',
  hotel: 'National hotel rates are unavailable in this planner. Would you like to continue comparing transportation? Hotel examples are available in the separate demo.',
}
export function cityClarificationQuestion(clarification: CityClarification): string { return questions[clarification.field] }
export const CityAssistanceSchema = z.strictObject({
  status: z.enum(['completed', 'unavailable', 'limited']), summary: z.string().trim().min(1).max(1500),
  appliedPreferences: PreferencePatchSchema, selectedPlanId: id.nullable(), activity: z.array(AgentActivitySchema).max(32),
  clarification: CityClarificationSchema.optional(),
}).superRefine((assistance, ctx) => {
  if (assistance.clarification && (assistance.status !== 'limited' || Object.keys(assistance.appliedPreferences).length > 0 || assistance.selectedPlanId !== null)) {
    ctx.addIssue({ code: 'custom', path: ['clarification'], message: 'Clarifications require limited status, unchanged preferences and no selection' })
  }
})
export type CityAssistance = z.infer<typeof CityAssistanceSchema>
export const CityRecoveryInputSchema = z.strictObject({
  request: CityTripRequestSchema, investigate: z.boolean(), refinement: z.string().trim().min(1).max(500).optional(),
  conversation: ConversationContextSchema.optional(),
})
export type CityRecoveryInput = z.infer<typeof CityRecoveryInputSchema>
export const CityFactsSchema = z.strictObject({
  candidates: z.array(CityCandidateSchema).max(12), checkedAt: timestamp, expiresAt: timestamp,
  adapterRevision: z.literal(CITY_ADAPTER_REVISION),
}).superRefine((facts, ctx) => {
  const checked = instant(facts.checkedAt), expiry = instant(facts.expiresAt)
  if (checked === null || expiry === null) return
  const evidence = facts.candidates.flatMap(candidate => candidate.evidence)
  const upper = Math.min(checked + CITY_MAX_FACT_AGE_MS, ...evidence.map(e => e.expiresAt === null ? Infinity : instant(e.expiresAt) ?? Infinity))
  if (expiry > upper) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Facts cannot outlive their original evidence or the five-minute collection window' })
  if (evidence.some(e => (instant(e.checkedAt) ?? -Infinity) > checked)) ctx.addIssue({ code: 'custom', path: ['checkedAt'], message: 'Collection cannot precede an original evidence check' })
})
export type CityFacts = z.infer<typeof CityFactsSchema>
export const CityRecoveryResponseSchema = z.strictObject({
  version: z.literal(2), result: CityRecoveryResultSchema, facts: CityFactsSchema,
  assistance: CityAssistanceSchema.optional(), conversation: ConversationEchoSchema.optional(),
}).superRefine((value, ctx) => {
  if (JSON.stringify(value.result.request.confirmedOptions) !== JSON.stringify(value.facts.candidates)) {
    ctx.addIssue({ code: 'custom', path: ['facts', 'candidates'], message: 'Facts must match the canonical planned request' })
  }
  checkMode(value.facts.candidates, value.result.request.mode, ctx, ['facts', 'candidates'])
  if (value.assistance) {
    if (value.assistance.selectedPlanId !== null && !value.result.plans.some(plan => plan.id === value.assistance!.selectedPlanId && plan.selectable)) {
      ctx.addIssue({ code: 'custom', path: ['assistance', 'selectedPlanId'], message: 'Assistance must select an eligible assessed plan' })
    }
    for (const key of ['drivingAllowed', 'priority'] as const) {
      if (value.assistance.appliedPreferences[key] !== undefined && value.assistance.appliedPreferences[key] !== value.result.request[key]) {
        ctx.addIssue({ code: 'custom', path: ['assistance', 'appliedPreferences', key], message: 'Applied preferences must match the canonical request' })
      }
    }
  }
})
export type CityRecoveryResponse = z.infer<typeof CityRecoveryResponseSchema>

/** Provider retention applies recursively, including candidates retained on the request. */
function containsGoogleContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsGoogleContent)
  if (value && typeof value === 'object') return Object.values(value).some(containsGoogleContent)
  if (typeof value !== 'string') return false
  if (value === 'Google Maps Routes API') return true
  try {
    const url = new URL(value), host = url.hostname.toLowerCase()
    return host === 'routes.googleapis.com' || host === 'maps.googleapis.com' || host === 'maps.google.com' || host.endsWith('.maps.google.com') || ((host === 'google.com' || host.endsWith('.google.com')) && url.pathname.startsWith('/maps'))
  } catch { return false }
}
export const CitySavedSelectionSchema = z.strictObject({
  schemaVersion: z.literal(2), request: CityTripRequestSchema, plan: CityPlanSchema, origin: CitySchema, destination: CitySchema,
  generatedAt: timestamp, selectedAt: timestamp,
}).superRefine((value, ctx) => {
  checkCityBinding(value.request, value.origin, value.destination, ctx)
  checkMode([value.plan], value.request.mode, ctx, ['plan'])
  if (containsGoogleContent(value)) ctx.addIssue({ code: 'custom', message: 'Google Maps route content cannot be saved on this device' })
  if (!value.plan.selectable || value.plan.originCityId !== value.origin.id || value.plan.destinationCityId !== value.destination.id) {
    ctx.addIssue({ code: 'custom', path: ['plan'], message: 'Save a selectable plan for the selected cities' })
  }
  const generated = instant(value.generatedAt), selected = instant(value.selectedAt)
  if (generated !== null && selected !== null && selected < generated) ctx.addIssue({ code: 'custom', path: ['selectedAt'], message: 'Selection cannot precede generation' })
  const firstBoarding = value.plan.legs.find(leg => ['bus', 'rail', 'subway', 'tram', 'ferry'].includes(leg.mode))
  if (selected !== null && firstBoarding && (instant(firstBoarding.startAt) ?? Infinity) <= selected) {
    ctx.addIssue({ code: 'custom', path: ['selectedAt'], message: 'The first transit departure must still be ahead when selected' })
  }
})
export type CitySavedSelection = z.infer<typeof CitySavedSelectionSchema>
