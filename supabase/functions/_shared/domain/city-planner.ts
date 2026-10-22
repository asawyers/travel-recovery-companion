import { CityCandidateSchema, CityPlanSchema, CityRecoveryResultSchema, CitySchema, CityTripRequestSchema } from './city-contracts.ts'
import type { City, CityCandidate, CityLeg, CityPlace, CityPlan, CityRecoveryResult, CityTripRequest } from './city-contracts.ts'
import { sumCosts, toInstantMillis } from './time.ts'

const MINUTE = 60_000
const COVERAGE_MINUTES = 10_080
// A city center query must finish near that selected point, not somewhere in its state.
const CITY_CENTER_TOLERANCE_METERS = 5_000
const CONNECTION_TOLERANCE_METERS = 250
const transitModes = new Set<CityLeg['mode']>(['bus', 'rail', 'subway', 'tram', 'ferry'])
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US').replace(/[.,]/g, '').replace(/\s+/g, ' ')
const bounded = (values: string[]) => [...new Set(values)].slice(0, 32).map(value => value.slice(0, 500))
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (value: number) => value * Math.PI / 180
  const lat = radians(b.latitude - a.latitude), lon = radians(b.longitude - a.longitude)
  const haversine = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lon / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)))
}
function hasCoordinates(place: CityPlace): place is CityPlace & { latitude: number; longitude: number } {
  return place.latitude !== null && place.longitude !== null
}
function connected(a: CityPlace, b: CityPlace): boolean {
  // A label cannot erase a known geographic anchor between adjacent legs.
  if (hasCoordinates(a) !== hasCoordinates(b)) return false
  if (hasCoordinates(a) && hasCoordinates(b)) return distance(a, b) <= CONNECTION_TOLERANCE_METERS
  return normalize(a.name) === normalize(b.name)
}
function atCity(place: CityPlace, city: City): boolean {
  if (hasCoordinates(place)) return distance(place, city) <= CITY_CENTER_TOLERANCE_METERS
  const names = [city.name, `${city.name} ${city.stateCode}`, `${city.name} ${city.stateName}`, `${city.name} city center`, `${city.name} city centre`].map(normalize)
  return names.includes(normalize(place.name))
}
function transferCount(legs: CityLeg[]): number {
  let boardings = 0, previous: string | null = null
  for (const leg of legs) {
    if (transitModes.has(leg.mode)) {
      if (leg.vehicleId !== null && leg.vehicleId !== previous) boardings++
      previous = leg.vehicleId
    } else if (leg.mode !== 'wait') previous = null
  }
  return Math.max(0, boardings - 1)
}
function evaluate(request: CityTripRequest, candidate: CityCandidate, context: { now: string; origin: City; destination: City }): CityPlan {
  const legs = structuredClone(candidate.legs), warnings = [...candidate.confirmations, ...candidate.evidence.flatMap(e => e.warnings)], violations: string[] = []
  const ready = toInstantMillis(request.readyAt), now = toInstantMillis(context.now)
  const first = legs[0], last = legs.at(-1)!
  let confirmation = candidate.confirmations.length > 0
  if (candidate.originCityId !== request.originCityId || candidate.destinationCityId !== request.destinationCityId) violations.push('Candidate city IDs do not match the selected origin and destination.')
  const originMatches = atCity(first.from, context.origin)
  if (!originMatches) violations.push('Journey does not start at the selected origin city center.')
  if (!atCity(last.to, context.destination)) violations.push('Journey does not finish at the selected destination city center.')
  if (toInstantMillis(first.startAt) < ready) violations.push('Journey starts before the traveler is ready.')
  for (let index = 0; index < legs.length; index++) {
    const leg = legs[index], previous = legs[index - 1]
    if (previous) {
      if (!connected(previous.to, leg.from)) violations.push(`Disconnected places before leg ${leg.id}; a transfer is missing.`)
      if (toInstantMillis(previous.endAt) !== toInstantMillis(leg.startAt)) violations.push(`Leg ${leg.id} overlaps or leaves an unexplained time gap; supply the actual transfer or wait.`)
    }
    if (leg.mode === 'wait' && (!connected(leg.from, leg.to) || (hasCoordinates(leg.from) && hasCoordinates(leg.to) && distance(leg.from, leg.to) > 1))) violations.push(`Wait ${leg.id} changes place without a travel leg.`)
    if (transitModes.has(leg.mode) && leg.vehicleId === null) violations.push(`Transit leg ${leg.id} has no boarding vehicle ID; a transfer count cannot be verified.`)
  }
  const unknownPlaces = legs.some(leg => !hasCoordinates(leg.from) || !hasCoordinates(leg.to))
  if (unknownPlaces) {
    if (candidate.evidence.some(e => ['live', 'schedule', 'estimated'].includes(e.type))) violations.push('Provider route legs require real coordinates; traveler labels cannot be claimed as provider-verified locations.')
    warnings.push('Some locations are traveler labels without verified coordinates; confirm the exact access and final destination.')
    confirmation = true
  }
  // Initial waiting never adds a vehicle or bridges a missing walking transfer.
  if (originMatches && toInstantMillis(first.startAt) > ready && legs.length < 96) {
    const ids = new Set(legs.map(leg => leg.id))
    let waitId = 'initial-wait'
    for (let suffix = 1; ids.has(waitId); suffix++) waitId = `initial-wait-${suffix}`
    legs.unshift({ id: waitId, mode: 'wait', from: { ...first.from }, to: { ...first.from }, startAt: request.readyAt,
      endAt: first.startAt, departureTimeZone: first.departureTimeZone, arrivalTimeZone: first.departureTimeZone,
      operator: null, service: null, vehicleId: null, assumptions: ['Wait at the supplied origin place until the first supplied departure.'] })
  } else if (originMatches && toInstantMillis(first.startAt) > ready && legs.length === 96) {
    violations.push('Journey needs an initial wait but exceeds the 96-leg representation limit.')
  }
  const finalArrivalAt = last.endAt, final = toInstantMillis(finalArrivalAt)
  if (request.deadlineAt !== null && final > toInstantMillis(request.deadlineAt)) violations.push('Complete journey arrives after the hard destination deadline.')
  if (request.deadlineAt === null && final > ready + COVERAGE_MINUTES * MINUTE) violations.push('Complete journey is outside the seven-day ASAP lookup coverage horizon.')
  const driveMinutes = legs.filter(leg => leg.mode === 'drive').reduce((sum, leg) => sum + (toInstantMillis(leg.endAt) - toInstantMillis(leg.startAt)) / MINUTE, 0)
  const hasDrive = legs.some(leg => leg.mode === 'drive')
  if ((hasDrive || candidate.kind === 'driving_estimate') && !request.drivingAllowed) violations.push('Driving is not allowed by the traveler.')
  if (candidate.kind === 'driving_estimate' && !hasDrive) violations.push('Driving estimate does not contain a driving leg.')
  const longDrive = driveMinutes > 480
  if (hasDrive) {
    confirmation = true
    warnings.push('Driving time is an estimate. Confirm vehicle access, road conditions, breaks, fuel, tolls, parking, and any rental charges; no vehicle inventory is reserved.')
    if (longDrive) warnings.push('Driving over eight hours is informational only until a rest and vehicle plan is supplied; it is not a complete selectable journey.')
  }
  if (candidate.evidence.some(e => e.type === 'estimated')) confirmation = true
  for (const evidence of candidate.evidence) {
    if (toInstantMillis(evidence.checkedAt) > now) violations.push('Evidence check is in the future; its freshness cannot be verified.')
    if (evidence.providerUpdatedAt !== null && toInstantMillis(evidence.providerUpdatedAt) > now) violations.push('Provider update is in the future; its freshness cannot be verified.')
    if (evidence.expiresAt !== null && toInstantMillis(evidence.expiresAt) <= now) violations.push('Original source evidence has expired; obtain a fresh check before selection.')
  }
  const expiries = candidate.evidence.flatMap(e => e.expiresAt === null ? [] : [e.expiresAt])
  const evidenceExpiresAt = expiries.reduce<string | null>((best, next) => best === null || toInstantMillis(next) < toInstantMillis(best) ? next : best, null)
  const cost = sumCosts(candidate.costs)
  cost.priceComplete = cost.priceComplete && candidate.costs.some(line => !line.includedInOtherCharge)
  if (!cost.priceComplete) {
    confirmation = true
    warnings.push('Price is incomplete. Known USD charges are only a lower bound; unknown costs have not been treated as free.')
  }
  if (cost.unsupportedCurrency) warnings.push('Unsupported currency is excluded from the USD total; no conversion was inferred.')
  if (request.budgetCents !== null) {
    if (request.budgetMode === 'hard') {
      if (!cost.priceComplete) violations.push('Unknown or unsupported prices cannot satisfy a hard budget.')
      if (cost.knownCostCents > request.budgetCents) violations.push('Known charges exceed the hard budget.')
    } else if (cost.knownCostCents > request.budgetCents) warnings.push('Known charges exceed the preferred budget.')
  }
  if (candidate.evidence.some(e => e.type === 'synthetic')) warnings.push('Fictional demonstration only; schedules, prices, and inventory are not real travel offers.')
  else warnings.push('Schedule feasibility does not reserve a seat or guarantee availability; confirm current service before booking.')
  const uniqueIds = new Set(legs.map(leg => leg.id))
  if (uniqueIds.size !== legs.length) violations.push('Leg IDs must be unique within the journey.')
  return CityPlanSchema.parse({ ...candidate, legs, finalArrivalAt, durationMinutes: Math.max(0, (final - ready) / MINUTE),
    transfers: transferCount(legs), knownCostCents: cost.knownCostCents, priceComplete: cost.priceComplete,
    feasibility: violations.length ? 'infeasible' : confirmation ? 'requires_confirmation' : 'schedule_feasible',
    selectable: violations.length === 0 && !longDrive, violations: bounded(violations), warnings: bounded(warnings), evidenceExpiresAt })
}
function rank(priority: CityTripRequest['priority'], a: CityPlan, b: CityPlan): number {
  const arrival = toInstantMillis(a.finalArrivalAt) - toInstantMillis(b.finalArrivalAt)
  const price = Number(b.priceComplete) - Number(a.priceComplete) || a.knownCostCents - b.knownCostCents
  const transfers = a.transfers - b.transfers
  return (priority === 'cheapest' ? price || arrival || transfers : priority === 'fewest_transfers' ? transfers || arrival || price : arrival || price || transfers) || compareId(a.id, b.id)
}

/** Pure assessment of already normalized city facts. City lookup and provider authentication live outside this boundary. */
export function planCityRecovery(input: CityTripRequest, candidates: CityCandidate[], context: { now: string; origin: City; destination: City }): CityRecoveryResult {
  const request = CityTripRequestSchema.parse(input), origin = CitySchema.parse(context.origin), destination = CitySchema.parse(context.destination)
  toInstantMillis(context.now)
  if (origin.id !== request.originCityId) throw new RangeError('Origin city metadata does not match the selected originCityId.')
  if (destination.id !== request.destinationCityId) throw new RangeError('Destination city metadata does not match the selected destinationCityId.')
  if (candidates.length > 12) throw new RangeError('At most 12 normalized city candidates can be assessed.')
  const plans: CityPlan[] = [], rejected: CityPlan[] = [], accepted: CityCandidate[] = [], warnings: string[] = [], ids = new Set<string>()
  if (request.deadlineAt === null) warnings.push('ASAP lookup covers complete journeys arriving within a seven-day (7-day) window after readiness. Later journeys are outside this search coverage; this is not a traveler deadline.')
  for (const [index, raw] of candidates.entries()) {
    const parsed = CityCandidateSchema.safeParse(raw)
    if (!parsed.success) { warnings.push(`Candidate ${index + 1} was rejected: ${parsed.error.issues[0]?.message ?? 'invalid city route facts'}.`); continue }
    const candidate = parsed.data
    if (ids.has(candidate.id)) { warnings.push(`Duplicate candidate ID ${candidate.id} was rejected.`); continue }
    ids.add(candidate.id)
    if (candidate.evidence.some(e => request.mode === 'real' ? e.environment !== 'production' || e.type === 'synthetic' : e.environment === 'production')) {
      warnings.push(`${candidate.id}: rejected because source evidence does not match the request mode.`); continue
    }
    accepted.push(candidate)
    const plan = evaluate(request, candidate, { now: context.now, origin, destination })
    if (plan.selectable) plans.push(plan); else rejected.push(plan)
  }
  plans.sort((a, b) => rank(request.priority, a, b))
  rejected.sort((a, b) => compareId(a.id, b.id))
  if (plans.length === 0) warnings.push('No complete selectable journey satisfies the supplied facts and limits; no limits were relaxed.')
  return CityRecoveryResultSchema.parse({ version: 2, request: { ...request, confirmedOptions: accepted }, origin, destination,
    generatedAt: context.now, plans: plans.slice(0, 3), rejected, warnings: bounded(warnings) })
}
