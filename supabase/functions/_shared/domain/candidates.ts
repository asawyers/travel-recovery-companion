import { ConfirmedOptionSchema, PlanningTripRequestSchema } from './schemas.ts'
import type { ConfirmedOption, TripRequest } from './schemas.ts'

/** Invalid external facts must not remove unrelated, supported alternatives. */
export function normalizeCandidates(request: TripRequest, inputs: readonly unknown[]): { candidates: ConfirmedOption[]; warnings: string[] } {
  if (inputs.length > 12) throw new RangeError('At most 12 recovery candidates are supported')
  const warnings: string[] = []
  const ids = inputs.map(input => typeof input === 'object' && input !== null && 'id' in input && typeof input.id === 'string' ? input.id.trim() : null)
  const duplicates = new Set(ids.filter((id, i) => id !== null && ids.indexOf(id) !== i))
  const candidates: ConfirmedOption[] = []
  for (const [index, input] of inputs.entries()) {
    const label = ids[index]?.slice(0, 100) || `candidate ${index + 1}`
    if (duplicates.has(ids[index])) {
      if (!warnings.includes(`Duplicate candidate ID ${label}; all options with this ID were omitted.`)) warnings.push(`Duplicate candidate ID ${label}; all options with this ID were omitted.`)
      continue
    }
    const parsed = ConfirmedOptionSchema.safeParse(input)
    if (!parsed.success) {
      warnings.push(`Invalid or missing facts for ${label}; candidate omitted.`)
      continue
    }
    // Reuse the canonical recursive mode check without trusting external provenance as authentication.
    if (!PlanningTripRequestSchema.safeParse({ ...request, confirmedOptions: [parsed.data] }).success) {
      warnings.push(`Evidence environment for ${label} does not match request mode; candidate omitted.`)
      continue
    }
    candidates.push(parsed.data)
  }
  return { candidates, warnings }
}
