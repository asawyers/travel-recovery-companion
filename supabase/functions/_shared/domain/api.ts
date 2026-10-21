import { z } from 'zod'
import { ConfirmedOptionSchema, FlightStatusReportSchema, RecoveryResultSchema, SourceEvidenceSchema, TripRequestSchema } from './schemas.ts'
import type { ConfirmedOption, FlightStatusReport, RecoveryResult, SourceEvidence, TripRequest } from './schemas.ts'
import { toInstantMillis } from './time.ts'

export const ADAPTER_REVISION = 'public-providers-v2'
export const MAX_FACT_AGE_MS = 5 * 60 * 1000
const timestamp = z.string().max(40).refine(value => {
  try { toInstantMillis(value); return true } catch { return false }
}, 'Expected a timestamp with an explicit offset')
const ArrivalSchema = z.strictObject({ arrivalAt: TripRequestSchema.shape.arrivalAt, arrivalBasis: TripRequestSchema.shape.arrivalBasis })

export type RecoveryInput = { request: TripRequest; investigate: boolean }
export const RecoveryInputSchema = z.strictObject({ request: TripRequestSchema, investigate: z.boolean() })
export type NormalizedFacts = {
  flightStatus?: FlightStatusReport
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
  flightStatus: FlightStatusReportSchema.optional(),
  candidates: z.array(ConfirmedOptionSchema).max(12), arrival: ArrivalSchema,
  arrivalEvidence: z.array(SourceEvidenceSchema).min(1).max(16), checkedAt: timestamp,
  expiresAt: timestamp, adapterRevision: z.string().trim().min(1).max(100),
}).superRefine((facts, ctx) => {
  let upperBound: number; let expiry: number
  try {
    upperBound = Math.min(toInstantMillis(facts.checkedAt) + MAX_FACT_AGE_MS,
      ...originalExpiries([facts.candidates, facts.arrivalEvidence]).map(toInstantMillis))
    expiry = toInstantMillis(facts.expiresAt)
  } catch { return } // Timestamp field refinements already explain malformed input.
  if (expiry > upperBound) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Facts cannot outlive their original evidence or the collection window' })
  }
})

export type RecoveryResponse = { result: RecoveryResult; facts: NormalizedFacts }
export const RecoveryResponseSchema = z.strictObject({ result: RecoveryResultSchema, facts: NormalizedFactsSchema }).superRefine((value, ctx) => {
  if (JSON.stringify(value.result.flightStatus) !== JSON.stringify(value.facts.flightStatus)) {
    ctx.addIssue({ code: 'custom', path: ['facts', 'flightStatus'], message: 'Flight status copies must agree' })
  }
  const request = value.result.request
  if (request.arrivalAt !== value.facts.arrival.arrivalAt || request.arrivalBasis !== value.facts.arrival.arrivalBasis ||
      JSON.stringify(request.confirmedOptions) !== JSON.stringify(value.facts.candidates)) {
    ctx.addIssue({ code: 'custom', message: 'Facts must match the canonical planned request' })
  }
  // Reuse the domain's recursive evidence-mode contract for arrival evidence as well.
  const permitted = value.facts.arrivalEvidence.every(e => request.mode === 'synthetic'
    ? e.type === 'synthetic' && e.environment === 'synthetic'
    : e.environment === 'production' && e.type !== 'synthetic')
  if (!permitted) ctx.addIssue({ code: 'custom', path: ['facts', 'arrivalEvidence'], message: 'Arrival evidence must match request mode' })
})
