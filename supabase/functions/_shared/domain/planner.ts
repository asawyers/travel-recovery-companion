import { RecoveryPlanSchema, RecoveryResultSchema, TripRequestSchema } from './schemas.ts'
import type { ConfirmedOption, CostLine, JourneyLeg, RecoveryPlan, RecoveryResult, SourceEvidence, TransferInput, TransitOption, TripRequest } from './schemas.ts'
import { normalizeCandidates } from './candidates.ts'
import { addMinutes, minutesBetween, sumCosts, toInstantMillis, toTripLocalTime } from './time.ts'

const localDate = (time: string) => toTripLocalTime(time).slice(0, 10)
const unique = (values: string[]) => [...new Set(values)]
function boundedNotes(values: string[]): string[] {
  const notes = unique(values)
  return notes.length <= 32 ? notes : [...notes.slice(0, 31), `${notes.length - 31} additional provider notes; inspect source evidence before booking.`]
}
const money = (label: string, cents: number | null): CostLine[] => [{ label, cents, currency: 'USD', includedInOtherCharge: false }]
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

class UnsupportedJourney extends Error {}
function requireFact(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new UnsupportedJourney(reason)
}

/** A builder keeps every supported journey contiguous in place and elapsed time. */
class Journey {
  legs: JourneyLeg[] = []
  at: string
  place: string
  constructor(at: string, place: string) { this.at = at; this.place = place }
  add(kind: JourneyLeg['kind'], to: string, endAt: string, evidence: SourceEvidence[], costs: CostLine[] = [], vehicleId: string | null = null, assumptions: string[] = [], handoffId: string | null = null) {
    requireFact(minutesBetween(this.at, endAt) >= 0, 'Chronology would require a negative-duration leg.')
    this.legs.push({ id: `leg-${this.legs.length + 1}`, kind, from: this.place, to, startAt: this.at, endAt, vehicleId, costs, evidence, assumptions, handoffId })
    this.at = endAt; this.place = to
  }
  transfer(input: TransferInput) {
    requireFact(input.from === this.place, `Disconnected transfer: ${input.from} does not connect to ${this.place}.`)
    const vehicle = input.kind === 'walk' ? null : input.vehicleId ?? `unspecified-transfer-${this.legs.length + 1}`
    this.add(input.kind, input.to, addMinutes(this.at, input.minutes), input.evidence, money('Transfer', input.costCents), vehicle, input.assumptions)
  }
}

function checkService(evidence: SourceEvidence[], date: string, label: string) {
  requireFact(evidence.every(e => e.serviceDate === date), `${label} service date does not match the intended local service/stay date ${date}.`)
}

function transit(journey: Journey, option: TransitOption) {
  checkService(option.evidence, localDate(option.departureAt), 'Transit')
  checkService(option.access.evidence, localDate(journey.at), 'Access transfer')
  journey.transfer(option.access)
  const cutoff = addMinutes(option.departureAt, -option.boardingMinutes)
  const margin = minutesBetween(journey.at, cutoff)
  requireFact(margin >= 0, `Boarding cutoff missed by ${-margin} minutes, including airport exit and access.`)
  journey.add('wait', journey.place, option.departureAt, option.evidence, [], null, [`Includes ${option.boardingMinutes} minutes required for boarding.`])
  journey.add(option.kind, option.finalTransfer.from, option.arrivalAt, option.evidence, money('Intercity fare', option.fareCents), option.id)
  checkService(option.finalTransfer.evidence, localDate(option.arrivalAt), 'Final transfer')
  journey.transfer(option.finalTransfer)
}

function transferCount(legs: JourneyLeg[]): number {
  const vehicleLegs = legs.filter(l => ['transfer', 'train', 'bus', 'car'].includes(l.kind) && l.vehicleId !== null)
  let changes = 0
  for (let index = 1; index < vehicleLegs.length; index++) if (vehicleLegs[index].vehicleId !== vehicleLegs[index - 1].vehicleId) changes++
  return changes
}

function buildPlan(request: TripRequest, candidate: ConfirmedOption, now: string): RecoveryPlan {
  const warnings: string[] = []
  const violations: string[] = []
  let confirmation = candidate.confirmations.length > 0
  const firstAccess = candidate.kind === 'overnight' ? candidate.hotelAccess : candidate.access
  requireFact(firstAccess.from === 'BOS' || firstAccess.from === 'BOS terminal exit', 'Airport access does not connect to the BOS terminal exit.')
  const journey = new Journey(toTripLocalTime(request.arrivalAt), 'BOS gate')
  journey.add('exit', firstAccess.from, addMinutes(journey.at, request.airportExitMinutes), firstAccess.evidence, [], null, ['Airport exit allowance supplied in the trip request.'])
  let hotel: RecoveryPlan['hotel'] = null
  if (candidate.kind === 'train' || candidate.kind === 'bus') {
    transit(journey, candidate)
    warnings.push('Schedule feasibility does not reserve a seat; confirm inventory before booking.')
  } else if (candidate.kind === 'car') {
    if (!request.drivingAllowed) violations.push('Driving is not allowed by the traveler.')
    checkService(candidate.access.evidence, localDate(journey.at), 'Rental access')
    journey.transfer(candidate.access)
    checkService(candidate.evidence, localDate(journey.at), 'Car pickup')
    journey.add('pickup', journey.place, addMinutes(journey.at, candidate.pickupMinutes), candidate.evidence)
    journey.add('car', candidate.finalTransfer.from, addMinutes(journey.at, candidate.driveMinutes), candidate.evidence, candidate.costs, candidate.id)
    journey.add('return', journey.place, addMinutes(journey.at, candidate.returnMinutes), candidate.evidence)
    checkService(candidate.finalTransfer.evidence, localDate(journey.at), 'Rental final transfer')
    journey.transfer(candidate.finalTransfer)
    if (!candidate.pickupHoursConfirmed) { confirmation = true; warnings.push('Rental pickup hours need confirmation.') }
    if (!candidate.returnLocationConfirmed) { confirmation = true; warnings.push('Rental return location needs confirmation.') }
    warnings.push('Rental inventory and payable charges need confirmation before booking.')
    // Even confirmed hours/location do not constitute reserved inventory.
    confirmation = true
  } else if (candidate.kind === 'overnight') {
    hotel = candidate.hotel
    if (!request.overnightAllowed) violations.push('Overnight travel is not allowed by the traveler.')
    requireFact(request.stay !== null && hotel.checkin === request.stay.checkin && hotel.checkout === request.stay.checkout && hotel.adults === request.stay.adults && hotel.rooms === request.stay.rooms, 'Hotel stay dates or occupancy do not match the intended stay.')
    checkService(hotel.evidence, hotel.checkin, 'Hotel stay')
    checkService(candidate.hotelAccess.evidence, localDate(journey.at), 'Hotel access')
    requireFact(candidate.hotelAccess.to === hotel.name && candidate.nextDayTransit.access.from === hotel.name, 'Hotel transfers do not connect to the selected property.')
    journey.transfer(candidate.hotelAccess)
    const arrivalDate = localDate(journey.at)
    requireFact(arrivalDate >= hotel.checkin && arrivalDate <= hotel.checkout, 'Hotel arrival falls outside the intended local stay dates.')
    const checkedInAt = addMinutes(journey.at, candidate.checkinMinutes)
    requireFact(minutesBetween(checkedInAt, candidate.leaveHotelAt) > 0, 'Hotel departure must follow completed check-in and a positive stay.')
    requireFact(localDate(candidate.leaveHotelAt) === hotel.checkout && localDate(candidate.nextDayTransit.departureAt) === hotel.checkout, 'Next-day travel must match the hotel checkout date.')
    // Keep check-in and stay on a single activity leg: hotel prices occur exactly once.
    journey.add('hotel', hotel.name, candidate.leaveHotelAt, hotel.evidence, hotel.costs, null, [`Check-in takes ${candidate.checkinMinutes} minutes; intended stay ${hotel.checkin} to ${hotel.checkout}.`], hotel.handoffId)
    transit(journey, candidate.nextDayTransit)
    warnings.push(...candidate.nextDayTransit.confirmations, 'Hotel room and next-day seat availability need confirmation before booking.')
    confirmation = true
    if (!hotel.lateCheckinConfirmed) warnings.push('Late check-in must be confirmed for the intended hotel night, including arrivals after midnight.')
    if (hotel.quoteExpiresAt && toInstantMillis(hotel.quoteExpiresAt) <= toInstantMillis(now)) violations.push('Hotel quote expired; obtain a new quote before selection.')
  }
  requireFact(journey.place === request.destination, 'Journey does not connect through the final destination.')
  const total = sumCosts(journey.legs.flatMap(l => l.costs))
  if (!total.priceComplete) warnings.push('Missing or unsupported price: total is incomplete; known charges are only a lower bound.')
  if (total.unsupportedCurrency) warnings.push('Unsupported currency is excluded from the USD total; no conversion was inferred.')
  if (minutesBetween(request.deadlineAt, journey.at) > 0) violations.push('Final destination arrival exceeds the deadline.')
  if (request.budgetCents !== null) {
    const overBudget = total.knownCostCents > request.budgetCents
    if (request.budgetMode === 'hard') {
      if (!total.priceComplete) violations.push('Incomplete price cannot qualify within a hard budget.')
      if (overBudget) violations.push('Known journey charges exceed the hard budget.')
    } else if (overBudget) warnings.push('Known journey charges exceed the soft budget.')
  }
  const evidences = journey.legs.flatMap(l => l.evidence)
  for (const e of evidences) {
    warnings.push(...e.warnings)
    if (e.expiresAt && toInstantMillis(e.expiresAt) <= toInstantMillis(now)) { violations.push('Source evidence expired; refresh these facts before selection.') }
    if (toInstantMillis(e.checkedAt) > toInstantMillis(now)) { confirmation = true; warnings.push('Source evidence was checked after the planning time; verify its timestamp.') }
    if (e.type === 'estimated') { confirmation = true; warnings.push('Estimated journey facts require confirmation.') }
  }
  if (!total.priceComplete) confirmation = true
  const expiries = [...evidences.map(e => e.expiresAt), hotel?.quoteExpiresAt ?? null].filter((t): t is string => t !== null).sort((a, b) => toInstantMillis(a) - toInstantMillis(b))
  const result = {
    id: candidate.id, title: candidate.title, legs: journey.legs, finalArrivalAt: journey.at, hotel,
    durationMinutes: minutesBetween(request.arrivalAt, journey.at), knownCostCents: total.knownCostCents,
    priceComplete: total.priceComplete, transfers: transferCount(journey.legs),
    feasibility: violations.length ? 'infeasible' : confirmation ? 'requires_confirmation' : 'schedule_feasible',
    violations: unique(violations), warnings: boundedNotes([...warnings, ...candidate.confirmations]), selectable: violations.length === 0, evidenceExpiresAt: expiries[0] ?? null,
  }
  const parsed = RecoveryPlanSchema.safeParse(result)
  requireFact(parsed.success, 'Journey exceeds supported output bounds; candidate omitted.')
  return parsed.data
}

function rank(priority: TripRequest['priority'], a: RecoveryPlan, b: RecoveryPlan): number {
  const price = () => Number(b.priceComplete) - Number(a.priceComplete) || (a.priceComplete && b.priceComplete ? a.knownCostCents - b.knownCostCents : 0)
  const arrival = toInstantMillis(a.finalArrivalAt) - toInstantMillis(b.finalArrivalAt)
  const primary = priority === 'cheapest' ? price() : priority === 'fewest_transfers' ? a.transfers - b.transfers : arrival
  return primary || arrival || price() || a.transfers - b.transfers || compareId(a.id, b.id)
}

/** Pure, portable arithmetic. All time comes from the request and injected clock. */
export function planRecovery(input: TripRequest, inputs: readonly unknown[], context: { now: string }): RecoveryResult {
  const request = TripRequestSchema.parse(input)
  toInstantMillis(context.now)
  const { candidates, warnings } = normalizeCandidates(request, inputs)
  const plans: RecoveryPlan[] = []; const rejected: RecoveryPlan[] = []
  for (const candidate of candidates) {
    try {
      const plan = buildPlan(request, candidate, context.now)
      if (plan.selectable) plans.push(plan); else rejected.push(plan)
    } catch (error) {
      if (!(error instanceof UnsupportedJourney)) throw error
      warnings.push(`${candidate.id}: ${error.message}`.slice(0, 500))
    }
  }
  plans.sort((a, b) => rank(request.priority, a, b))
  rejected.sort((a, b) => compareId(a.id, b.id))
  if (!plans.length) warnings.push('No feasible complete journey satisfies the supplied facts and limits; no limits were relaxed.')
  const readyAt = addMinutes(request.arrivalAt, request.airportExitMinutes + request.originalAccessMinutes)
  const requiredReadyAt = addMinutes(request.originalDepartureAt, -request.originalBoardingMinutes)
  const marginMinutes = minutesBetween(readyAt, requiredReadyAt)
  return RecoveryResultSchema.parse({
    request, generatedAt: context.now,
    originalConnection: { readyAt, requiredReadyAt, marginMinutes, shortfallMinutes: Math.max(0, -marginMinutes), missed: marginMinutes < 0 },
    plans: plans.slice(0, 3), rejected, warnings: unique(warnings),
    activity: [{ tool: 'deterministic-planner', message: `Compared ${candidates.length} validated candidates using ${request.priority}; schedule feasibility is not reserved inventory.`, checkedAt: context.now }],
  })
}
