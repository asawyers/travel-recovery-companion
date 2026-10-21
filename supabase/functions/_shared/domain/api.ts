import { z } from 'zod'
import { ConfirmedOptionSchema, HotelOptionSchema, RecoveryResultSchema, SourceEvidenceSchema, TripRequestSchema } from './schemas.ts'
import type { ConfirmedOption, HotelOption, RecoveryResult, SourceEvidence, TripRequest } from './schemas.ts'
import { configuredHotelOrigin } from './handoffs.ts'
import { AssistanceSchema } from './assistance.ts'
import type { Assistance } from './assistance.ts'
import { toInstantMillis } from './time.ts'

export const ADAPTER_REVISION = 'public-recovery-v5'
export const MAX_FACT_AGE_MS = 5 * 60 * 1000
const timestamp = z.string().max(40).refine(value => {
  try { toInstantMillis(value); return true } catch { return false }
}, 'Expected a timestamp with an explicit offset')
const ArrivalSchema = z.strictObject({ arrivalAt: TripRequestSchema.shape.arrivalAt, arrivalBasis: TripRequestSchema.shape.arrivalBasis })

export type RecoveryInput = { request: TripRequest; investigate: boolean; refinement?: string }
export const RecoveryInputSchema = z.strictObject({ request: TripRequestSchema, investigate: z.boolean(), refinement: z.string().trim().min(1).max(500).optional() })
export type NormalizedFacts = {
  hotelBookingOrigin?: string
  hotelOffers?: HotelOption[]
  candidates: ConfirmedOption[]
  arrival: Pick<TripRequest, 'arrivalAt' | 'arrivalBasis'>
  arrivalEvidence: SourceEvidence[]
  checkedAt: string
  expiresAt: string
  adapterRevision: string
}

/** Includes nested transfer/next-day evidence and hotel quote expiration. */
export function originalExpiries(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(originalExpiries)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) =>
    (key === 'expiresAt' || key === 'quoteExpiresAt') && typeof item === 'string' ? [item] : originalExpiries(item))
}

export const NormalizedFactsSchema = z.strictObject({
  hotelBookingOrigin: z.string().refine(value => configuredHotelOrigin(value) === value, 'Expected an exact configured HTTPS origin').optional(),
  hotelOffers: z.array(HotelOptionSchema).max(3).optional(),
  candidates: z.array(ConfirmedOptionSchema).max(12), arrival: ArrivalSchema,
  arrivalEvidence: z.array(SourceEvidenceSchema).min(1).max(16), checkedAt: timestamp,
  expiresAt: timestamp, adapterRevision: z.string().trim().min(1).max(100),
}).superRefine((facts, ctx) => {
  let upperBound: number; let expiry: number
  try {
    upperBound = Math.min(toInstantMillis(facts.checkedAt) + MAX_FACT_AGE_MS,
      ...originalExpiries([facts.candidates, facts.arrivalEvidence, facts.hotelOffers]).map(toInstantMillis))
    expiry = toInstantMillis(facts.expiresAt)
  } catch { return } // Timestamp field refinements already explain malformed input.
  if (expiry > upperBound) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Facts cannot outlive their original evidence or the collection window' })
  }
})

export type RecoveryResponse = { result: RecoveryResult; facts: NormalizedFacts; assistance?: Assistance }
export const RecoveryResponseSchema = z.strictObject({ result: RecoveryResultSchema, facts: NormalizedFactsSchema, assistance: AssistanceSchema.optional() }).superRefine((value, ctx) => {
  const request = value.result.request
  if (request.arrivalAt !== value.facts.arrival.arrivalAt || request.arrivalBasis !== value.facts.arrival.arrivalBasis ||
      JSON.stringify(request.confirmedOptions) !== JSON.stringify(value.facts.candidates)) {
    ctx.addIssue({ code: 'custom', message: 'Facts must match the canonical planned request' })
  }
  if (value.assistance) {
    const assistance = value.assistance
    if (assistance.selectedPlanId !== null && !value.result.plans.some(plan => plan.id === assistance.selectedPlanId)) {
      ctx.addIssue({ code: 'custom', path: ['assistance', 'selectedPlanId'], message: 'Assistance must select an eligible assessed plan' })
    }
    for (const key of ['priority', 'drivingAllowed'] as const) {
      if (assistance.appliedPreferences[key] !== undefined && assistance.appliedPreferences[key] !== request[key]) {
        ctx.addIssue({ code: 'custom', path: ['assistance', 'appliedPreferences', key], message: 'Applied preferences must match the canonical request' })
      }
    }
  }
  if (value.facts.hotelOffers) {
    // Validate standalone offer evidence directly, including nested metadata.
    const validEvidence = (item: unknown): boolean => {
      if (Array.isArray(item)) return item.every(validEvidence)
      if (!item || typeof item !== 'object') return true
      if ('type' in item && 'environment' in item) return request.mode === 'synthetic'
        ? (item.type === 'synthetic' && item.environment === 'synthetic') || (request.hotelDataMode === 'sandbox' && item.type === 'estimated' && item.environment === 'sandbox')
        : item.type !== 'synthetic' && item.environment === 'production'
      return Object.values(item).every(validEvidence)
    }
    if (!validEvidence(value.facts.hotelOffers)) ctx.addIssue({ code: 'custom', path: ['facts', 'hotelOffers'], message: 'Hotel evidence must match request mode' })
  }
  // Reuse the domain's recursive evidence-mode contract for arrival evidence as well.
  const permitted = value.facts.arrivalEvidence.every(e => request.mode === 'synthetic'
    ? e.type === 'synthetic' && e.environment === 'synthetic'
    : e.environment === 'production' && e.type !== 'synthetic')
  if (!permitted) ctx.addIssue({ code: 'custom', path: ['facts', 'arrivalEvidence'], message: 'Arrival evidence must match request mode' })
})
