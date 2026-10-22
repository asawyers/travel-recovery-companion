import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'
import { toInstantMillis } from './time.ts'

const text = z.string().trim().min(1).max(500)
const id = z.string().trim().min(1).max(100)
const notes = z.array(text).max(32)
const minutes = z.number().int().min(0).max(10_080)
const cents = z.number().int().min(0).max(100_000_000)
const timestamp = z.string().max(40).refine(value => {
  try { toInstantMillis(value); return true } catch { return false }
}, 'Expected a valid ISO timestamp with an explicit offset')
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { Temporal.PlainDate.from(value, { overflow: 'reject' }); return true } catch { return false }
}, 'Expected a valid date-only calendar date')
const currency = z.string().regex(/^[A-Z]{3}$/)
const safeSourceUrl = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch { return false }
}, 'Source URL must be an HTTP(S) provenance URL')
const stayFields = { checkin: dateOnly, checkout: dateOnly, adults: z.literal(1), rooms: z.literal(1) }
// Field refinements already report malformed timestamps; comparisons must never make safeParse throw.
const follows = (from: string, to: string, allowEqual = false) => {
  try { return allowEqual ? toInstantMillis(to) >= toInstantMillis(from) : toInstantMillis(to) > toInstantMillis(from) } catch { return true }
}
const orderedStay = (stay: { checkin: string; checkout: string }) => stay.checkout > stay.checkin

export const EvidenceTypeSchema = z.enum(['live', 'schedule', 'traveler_confirmed', 'estimated', 'synthetic'])
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>

export const CostLineSchema = z.strictObject({ label: text, cents: cents.nullable(), currency, includedInOtherCharge: z.boolean() })
export type CostLine = z.infer<typeof CostLineSchema>

export const SourceEvidenceSchema = z.strictObject({
  type: EvidenceTypeSchema, provider: text, sourceUrl: safeSourceUrl.nullable(), checkedAt: timestamp,
  serviceDate: dateOnly, providerUpdatedAt: timestamp.nullable(), expiresAt: timestamp.nullable(),
  environment: z.enum(['production', 'sandbox', 'synthetic']), warnings: notes,
}).superRefine((value, ctx) => {
  if ((value.type === 'synthetic') !== (value.environment === 'synthetic')) {
    ctx.addIssue({ code: 'custom', message: 'Synthetic evidence must be explicitly labeled synthetic in type and environment' })
  }
  if (value.type === 'live' && value.environment !== 'production') {
    ctx.addIssue({ code: 'custom', message: 'Sandbox evidence cannot claim live production provenance' })
  }
})
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>
const evidences = z.array(SourceEvidenceSchema).min(1).max(16)

export const TransferInputSchema = z.strictObject({
  from: text, to: text, minutes, costCents: cents.nullable(), kind: z.enum(['walk', 'transfer']),
  vehicleId: id.nullable(), evidence: evidences, assumptions: notes,
})
export type TransferInput = z.infer<typeof TransferInputSchema>

export const TransitOptionSchema = z.strictObject({
  kind: z.enum(['train', 'bus']), id, title: text, departureAt: timestamp, arrivalAt: timestamp,
  boardingMinutes: minutes, fareCents: cents.nullable(), access: TransferInputSchema,
  finalTransfer: TransferInputSchema, evidence: evidences, confirmations: notes,
}).refine(value => follows(value.departureAt, value.arrivalAt), 'Transit arrival must follow departure')
export type TransitOption = z.infer<typeof TransitOptionSchema>

export const CarOptionSchema = z.strictObject({
  kind: z.literal('car'), id, title: text, access: TransferInputSchema, pickupMinutes: minutes,
  driveMinutes: minutes, returnMinutes: minutes, finalTransfer: TransferInputSchema,
  costs: z.array(CostLineSchema).min(1).max(32), pickupHoursConfirmed: z.boolean(), returnLocationConfirmed: z.boolean(),
  evidence: evidences, confirmations: notes,
})
export type CarOption = z.infer<typeof CarOptionSchema>

// Define the full hotel before plans: strict parsing must preserve room and quote metadata.
export const HotelOptionSchema = z.strictObject({
  id, name: text, address: text, room: text.nullable(), board: text.nullable(), ...stayFields,
  timeZone: z.literal('America/New_York'), costs: z.array(CostLineSchema).min(1).max(32),
  cancellation: z.strictObject({ deadlineAt: timestamp.nullable(), penalty: text.nullable(), text: z.string().trim().min(1).max(4000) }).nullable(),
  lateCheckinConfirmed: z.boolean(), quoteExpiresAt: timestamp.nullable(), evidence: evidences,
  handoffId: z.enum(['nuitee-hotel', 'hotel-search']),
}).refine(orderedStay, 'Hotel checkout must follow checkin')
export type HotelOption = z.infer<typeof HotelOptionSchema>

export const OvernightOptionSchema = z.strictObject({
  kind: z.literal('overnight'), id, title: text, hotel: HotelOptionSchema, hotelAccess: TransferInputSchema,
  checkinMinutes: minutes, leaveHotelAt: timestamp, nextDayTransit: TransitOptionSchema, confirmations: notes,
})
export type OvernightOption = z.infer<typeof OvernightOptionSchema>

export const ConfirmedOptionSchema = z.discriminatedUnion('kind', [TransitOptionSchema, CarOptionSchema, OvernightOptionSchema])
export type ConfirmedOption = z.infer<typeof ConfirmedOptionSchema>

/** Mode consistency is structural validation, never authentication of browser-supplied provenance. */
function validateEvidenceMode(value: unknown, mode: 'real' | 'synthetic', ctx: z.RefinementCtx, path: PropertyKey[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateEvidenceMode(item, mode, ctx, [...path, index]))
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('environment' in record && 'type' in record) {
      const allowed = mode === 'real' ? record.environment === 'production' && record.type !== 'synthetic' : record.environment !== 'production'
      if (!allowed) ctx.addIssue({ code: 'custom', path, message: 'Evidence environment must match the explicit request mode; sandbox/synthetic facts cannot represent a real request' })
    }
    for (const [key, item] of Object.entries(record)) validateEvidenceMode(item, mode, ctx, [...path, key])
  }
}

/** Property-bound traveler transfer facts; no hotel shuttle duration or fare is inferred. */
export const HotelSelectionSchema = z.strictObject({
  hotelId: id, nextDayTransitId: id, checkinMinutes: minutes, leaveHotelAt: timestamp,
  hotelAccess: z.strictObject({ minutes, costCents: cents.nullable(), kind: z.enum(['walk', 'transfer']), checkedAt: timestamp }),
  stationAccess: z.strictObject({ minutes, costCents: cents.nullable(), kind: z.enum(['walk', 'transfer']), checkedAt: timestamp }),
})
export type HotelSelection = z.infer<typeof HotelSelectionSchema>

/** Trusted normalized facts may reveal that the original hard deadline is already unreachable. */
export const PlanningTripRequestSchema = z.strictObject({
  mode: z.enum(['real', 'synthetic']), hotelDataMode: z.literal('sandbox').optional(), airport: z.literal('BOS'),
  destination: text.refine(value => /\bPortland\s*,?\s*(?:ME|Maine)\b/i.test(value) && !/\b(?:Oregon|OR)\b/i.test(value), 'Supported coverage is BOS to a public destination in Portland, Maine (Portland, ME)'),
  timeZone: z.literal('America/New_York'), arrivalAt: timestamp,
  arrivalBasis: z.enum(['actual_gate', 'estimated_gate', 'scheduled_gate', 'traveler_confirmed']),
  // Retain metadata from saved itineraries; recovery planning does not look up flights.
  flight: z.strictObject({ ident: id, departureDate: dateOnly }).nullable(), originalDepartureAt: timestamp.nullable(),
  originalAccessMinutes: minutes, originalBoardingMinutes: minutes, airportExitMinutes: minutes,
  deadlineAt: timestamp.nullable(), budgetCents: cents.nullable(), budgetMode: z.enum(['hard', 'soft']),
  drivingAllowed: z.boolean(), overnightAllowed: z.boolean(), priority: z.enum(['earliest', 'cheapest', 'fewest_transfers']),
  confirmedOptions: z.array(ConfirmedOptionSchema).max(12),
  hotelSelection: HotelSelectionSchema.nullable().optional(),
  stay: z.strictObject({ ...stayFields, guestNationality: z.string().regex(/^[A-Z]{2}$/) }).refine(orderedStay, 'Stay checkout must follow checkin').nullable(),
}).superRefine((value, ctx) => {
  if (value.hotelDataMode === 'sandbox' && value.mode !== 'synthetic') ctx.addIssue({ code: 'custom', path: ['hotelDataMode'], message: 'Hotel sandbox data requires explicit synthetic demo mode' })
  validateEvidenceMode(value.confirmedOptions, value.mode, ctx, ['confirmedOptions'])
})
/** A supplied hard deadline must follow arrival; null means ASAP. */
export const TripRequestSchema = PlanningTripRequestSchema.superRefine((value, ctx) => {
  if (value.deadlineAt !== null && !follows(value.arrivalAt, value.deadlineAt)) ctx.addIssue({ code: 'custom', path: ['deadlineAt'], message: 'Deadline must follow arrival' })
})
export type TripRequest = z.infer<typeof TripRequestSchema>

export const JourneyLegSchema = z.strictObject({
  id, kind: z.enum(['exit', 'walk', 'transfer', 'wait', 'train', 'bus', 'car', 'pickup', 'return', 'hotel']),
  from: text, to: text, startAt: timestamp, endAt: timestamp, vehicleId: id.nullable(),
  costs: z.array(CostLineSchema).max(32), evidence: evidences, assumptions: notes, handoffId: id.nullable(),
}).refine(value => follows(value.startAt, value.endAt, true), 'Leg end must not precede start')
export type JourneyLeg = z.infer<typeof JourneyLegSchema>

export const RecoveryPlanSchema = z.strictObject({
  id, title: text, legs: z.array(JourneyLegSchema).max(96), finalArrivalAt: timestamp,
  // Elapsed timestamps can carry seconds; traveler-supplied minute allowances remain integers.
  hotel: HotelOptionSchema.nullable(), durationMinutes: z.number().finite().min(0).max(10_080), knownCostCents: cents,
  priceComplete: z.boolean(), transfers: z.number().int().min(0).max(96),
  feasibility: z.enum(['schedule_feasible', 'requires_confirmation', 'infeasible']),
  violations: notes, warnings: notes, selectable: z.boolean(), evidenceExpiresAt: timestamp.nullable(),
})
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>

export const RecoveryResultSchema = z.strictObject({
  request: PlanningTripRequestSchema, generatedAt: timestamp,
  originalConnection: z.strictObject({ readyAt: timestamp, requiredReadyAt: timestamp, marginMinutes: z.number().min(-10_080).max(10_080), shortfallMinutes: z.number().min(0).max(10_080), missed: z.boolean() }).nullable(),
  plans: z.array(RecoveryPlanSchema).max(12), rejected: z.array(RecoveryPlanSchema).max(12), warnings: notes,
  activity: z.array(z.strictObject({ tool: id, message: text, checkedAt: timestamp })).max(64),
}).superRefine((value, ctx) => {
  validateEvidenceMode(value.plans, value.request.mode, ctx, ['plans'])
  validateEvidenceMode(value.rejected, value.request.mode, ctx, ['rejected'])
})
export type RecoveryResult = z.infer<typeof RecoveryResultSchema>
