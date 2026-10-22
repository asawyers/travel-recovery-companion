import type { ConversationContext } from '../domain/conversation.ts'
import type { PreferencePatch } from '../domain/assistance.ts'
import type { City, CityAssistance, CityCandidate, CityRecoveryResult, CityTripRequest } from '../domain/city-contracts.ts'

export type CityProviderFacts = { candidates: CityCandidate[]; warnings: string[] }
export type CityAssessment = { assessmentId: string; result: CityRecoveryResult }
export type CityAgentTools = {
  findTransport(): Promise<CityProviderFacts>
  findHotels(): Promise<CityProviderFacts>
  assess(patch: PreferencePatch): Promise<CityAssessment>
}
export type CityAgentExecutor = (args: {
  request: CityTripRequest
  origin: City
  destination: City
  refinement: string
  conversation?: ConversationContext
  signal: AbortSignal
  tools: CityAgentTools
}) => Promise<CityAssistance>

/** Changed preferences require a matching instruction in this turn, never history. */
export function explicitlyRequestedCityPatch(refinement: string, patch: PreferencePatch): boolean {
  const text = refinement.toLowerCase().replace(/[’]/g, "'")
  // A keyword inside a denial, condition or contradictory clause is not consent.
  // Unrecognized phrasing keeps preferences unchanged rather than guessing intent.
  const clauses = text.split(/[.;!,?]|\b(?:and|but|however)\b/).filter(value => value.trim())
  const negation = /\b(no|not|never|cannot|can't|don't|won't|wouldn't|shouldn't|couldn't|without|avoid|disable|unable)\b/
  const uncertainty = /\b(if|maybe|perhaps|might|possibly|whether|unless|or)\b/
  if (Object.keys(patch).length && text.includes('?')) return false
  if (patch.priority !== undefined) {
    const priorities = { earliest: /\b(earliest|asap|fastest|soonest)\b/, cheapest: /\b(cheapest|lowest (?:price|cost)|least expensive)\b/, fewest_transfers: /\b(fewest|fewer|minimum|minimize) transfers?\b/ }
    const requested = priorities[patch.priority]
    if (!requested.test(text) || Object.values(priorities).filter(pattern => pattern.test(text)).length !== 1 ||
      clauses.some(clause => requested.test(clause) && (negation.test(clause) || uncertainty.test(clause)))) return false
  }
  if (patch.drivingAllowed !== undefined) {
    const negative = /\b(no driving|avoid driving|do not drive|don't drive|cannot drive|can't drive|won't drive|without driving|disable driving)\b/
    const positive = /\b(allow driving|enable driving|can drive|will drive|willing to drive|driving is (?:ok|okay|allowed)|include driving)\b/
    const drivingClauses = clauses.filter(clause => /\b(drive|driving)\b/.test(clause))
    if (patch.drivingAllowed) {
      if (!positive.test(text) || drivingClauses.some(clause => negation.test(clause) || uncertainty.test(clause))) return false
    } else {
      if (!negative.test(text) || drivingClauses.some(clause => {
        const remainder = clause.replace(new RegExp(negative.source, 'g'), '')
        return uncertainty.test(clause) || negation.test(remainder) || positive.test(remainder)
      })) return false
    }
  }
  return true
}

/** Discovery may use explicit soft preferences before any canonical assessment. */
export function explicitlyRequestedCityPreferences(refinement: string): PreferencePatch {
  const patch: PreferencePatch = {}
  const driving = [true, false].filter(drivingAllowed => explicitlyRequestedCityPatch(refinement, { drivingAllowed }))
  if (driving.length === 1) patch.drivingAllowed = driving[0]
  const priorities = (['earliest', 'cheapest', 'fewest_transfers'] as const).filter(priority => explicitlyRequestedCityPatch(refinement, { priority }))
  if (priorities.length === 1) patch.priority = priorities[0]
  return patch
}
