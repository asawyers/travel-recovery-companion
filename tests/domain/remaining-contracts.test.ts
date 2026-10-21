import { describe, expect, it } from 'vitest'
import { RecoveryInputSchema, RecoveryResponseSchema } from '../../supabase/functions/_shared/domain/api.ts'
import { daytimeFixture, overnightFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { planRecovery } from '../../supabase/functions/_shared/domain/planner.ts'

function response(overnight = false) {
  const f = overnight ? overnightFixture() : daytimeFixture()
  const checkedAt = f.now
  return { result: planRecovery(f.request, f.candidates, { now: checkedAt }), facts: {
    candidates: f.candidates, arrival: { arrivalAt: f.request.arrivalAt, arrivalBasis: f.request.arrivalBasis },
    arrivalEvidence: f.candidates.find(c => c.kind !== 'overnight')!.evidence, checkedAt,
    expiresAt: new Date(Date.parse(checkedAt) + 300000).toISOString(), adapterRevision: 'test',
  } }
}
describe('hotel and assistance API contracts', () => {
  it('accepts bounded refinement separately from the saved trip', () => {
    expect(RecoveryInputSchema.safeParse({ request: daytimeFixture().request, investigate: false, refinement: 'No driving, please.' }).success).toBe(true)
    expect(RecoveryInputSchema.safeParse({ request: daytimeFixture().request, investigate: false, refinement: 'x'.repeat(501) }).success).toBe(false)
  })
  it('retains offered hotel metadata without advertising it as a complete journey', () => {
    const body = response(true)
    const offer = overnightFixture().request.confirmedOptions.find(c => c.kind === 'overnight')!
    if (offer.kind !== 'overnight') throw Error('expected hotel fixture')
    const parsed = RecoveryResponseSchema.safeParse({ ...body, facts: { ...body.facts, hotelOffers: [offer.hotel] } })
    expect(parsed.error?.issues).toBeUndefined()
    if (parsed.success) expect(parsed.data.facts.hotelOffers?.[0]).toEqual(offer.hotel)
  })
  it('does not let cached facts outlive an offered hotel source', () => {
    const body = response(true)
    const option = overnightFixture().request.confirmedOptions.find(c => c.kind === 'overnight')!
    if (option.kind !== 'overnight') throw Error('expected hotel fixture')
    const hotel = structuredClone(option.hotel)
    hotel.evidence[0].expiresAt = new Date(Date.parse(body.facts.checkedAt) + 60000).toISOString()
    expect(RecoveryResponseSchema.safeParse({ ...body, facts: { ...body.facts, hotelOffers: [hotel] } }).success).toBe(false)
  })
  it('accepts assistance only for a canonical eligible plan and applied preferences', () => {
    const body = response()
    const assistance = { status: 'completed' as const, summary: 'Compared the assessed journeys.', appliedPreferences: { priority: body.result.request.priority }, selectedPlanId: body.result.plans[0].id, activity: [] }
    expect(RecoveryResponseSchema.safeParse({ ...body, assistance }).success).toBe(true)
    expect(RecoveryResponseSchema.safeParse({ ...body, assistance: { ...assistance, selectedPlanId: 'invented' } }).success).toBe(false)
    expect(RecoveryResponseSchema.safeParse({ ...body, assistance: { ...assistance, appliedPreferences: { priority: 'cheapest' } } }).success).toBe(false)
  })
})
