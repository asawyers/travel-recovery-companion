import { Temporal } from '@js-temporal/polyfill'
import type { City } from './city-types.ts'
import type { CostLine, SourceEvidence } from './schemas.ts'
import { sumCosts, toInstantMillis } from './time.ts'
import {
  FlightOfferSchema,
  TravelOnwardOfferSchema,
  onwardOfferId,
  type TravelOnwardOffer,
  NationalHotelOfferSchema,
  TravelRecoveryInputSchema,
  TRAVEL_MAX_FACT_AGE_MS,
  flightOfferFingerprint,
  flightOfferId,
  hotelOfferFingerprint,
  hotelOfferId,
  type FlightOffer,
  type NationalHotelOffer,
  type TravelJourney,
  type TravelLeg,
  type TravelPlace,
  type TravelRecoveryInput,
  type TravelSelectionIssue,
} from './travel-contracts.ts'
export type TravelPlanningContext = { origin: City; destination: City; now: string; onwardOffers?: TravelOnwardOffer[] }
export type TravelSelectionContext = TravelPlanningContext & {
  flightOffers: FlightOffer[]
  hotelOffers: NationalHotelOffer[]
}
const millis = toInstantMillis
const local = (at: string, zone: string) => Temporal.Instant.fromEpochMilliseconds(millis(at)).toZonedDateTimeISO(zone)
const shift = (at: string, minutes: number, zone: string) =>
  Temporal.Instant.fromEpochMilliseconds(millis(at) + minutes * 60000)
    .toZonedDateTimeISO(zone)
    .toString({ timeZoneName: 'never' })
const dateAt = (at: string, zone: string) => local(at, zone).toPlainDate().toString()
const place = (v: { name: string; latitude: number; longitude: number; timeZone: string }): TravelPlace => ({
  name: v.name,
  latitude: v.latitude,
  longitude: v.longitude,
  timeZone: v.timeZone,
})
const cost = (label: string, cents: number | null): CostLine => ({
  label,
  cents,
  currency: 'USD',
  includedInOtherCharge: false,
})
function originalEvidence(flight: FlightOffer, hotel: NationalHotelOffer | null): SourceEvidence[] {
  return [...flight.evidence, ...flight.segments.flatMap((s) => s.evidence), ...(hotel?.evidence ?? [])]
}
function expiryOf(e: SourceEvidence): number {
  return Math.min(millis(e.checkedAt) + TRAVEL_MAX_FACT_AGE_MS, e.expiresAt === null ? Infinity : millis(e.expiresAt))
}

/** Compose accepted source quotes without renewing their original observation timestamps. */
export function assessTravelSelection(
  raw: TravelRecoveryInput,
  context: TravelSelectionContext,
): { journey: TravelJourney | null; selectionIssue: TravelSelectionIssue | null } {
  const input = TravelRecoveryInputSchema.parse(raw),
    selection = input.selection
  if (!selection) return { journey: null, selectionIssue: null }
  const flight = context.flightOffers.find((f) => f.id === selection.flightOfferId)
  if (!flight) return { journey: null, selectionIssue: 'flight_missing' }
  if (
    flight.fingerprint !== selection.flightFingerprint ||
    flight.fingerprint !== flightOfferFingerprint(flight) ||
    flight.id !== flightOfferId(flight)
  )
    return { journey: null, selectionIssue: 'flight_changed' }
  const hotel =
    selection.hotelOfferId === null ? null : context.hotelOffers.find((h) => h.id === selection.hotelOfferId)
  if (hotel === undefined) return { journey: null, selectionIssue: 'hotel_missing' }
  if (
    hotel &&
    (hotel.fingerprint !== selection.hotelFingerprint ||
      hotel.fingerprint !== hotelOfferFingerprint(hotel) ||
      hotel.id !== hotelOfferId(hotel))
  )
    return { journey: null, selectionIssue: 'hotel_changed' }
  if (input.onwardFlight && !selection.onwardOfferId) return { journey: null, selectionIssue: 'onward_missing' }
  if (selection.onwardOfferId) {
    const onward = context.onwardOffers?.find(o => o.id === selection.onwardOfferId)
    if (!onward) return { journey: null, selectionIssue: 'onward_missing' }
    if (!TravelOnwardOfferSchema.safeParse(onward).success || onward.flightOfferId !== flight.id || onward.flightFingerprint !== flight.fingerprint) return { journey: null, selectionIssue: 'onward_changed' }
  }
  return { journey: composeTravelJourney(input, flight, hotel, context), selectionIssue: null }
}

/** Pure composition retains every source timestamp and never treats a quote as reserved inventory. */
export function composeTravelJourney(
  raw: TravelRecoveryInput,
  flight: FlightOffer,
  hotel: NationalHotelOffer | null,
  context: TravelPlanningContext,
): TravelJourney {
  const input = TravelRecoveryInputSchema.parse(raw),
    { trip, selection } = input,
    { origin, destination, now } = context
  if (!selection) throw new Error('An explicit flight selection and traveler facts are required')
  if (origin.id !== trip.originCityId || destination.id !== trip.destinationCityId)
    throw new Error('Selected city metadata does not match the trip')
  const facts = selection.facts,
    violations: string[] = [],
    warnings: string[] = [],
    legs: TravelLeg[] = [],
    onward = selection.onwardOfferId ? context.onwardOffers?.find(o => o.id === selection.onwardOfferId) : undefined,
    sources = [...originalEvidence(flight, hotel), ...(onward?.evidence ?? [])]
  const addViolation = (message: string) => {
    if (!violations.includes(message)) violations.push(message)
  }
  const traveler: SourceEvidence = {
    type: 'traveler_confirmed',
    provider: 'Traveler supplied journey allowances',
    sourceUrl: null,
    checkedAt: facts.checkedAt,
    serviceDate: input.departureDate,
    providerUpdatedAt: null,
    expiresAt: null,
    environment: 'production',
    warnings: ['Transfer time, price and processing allowances require confirmation.'],
  }
  const allEvidence = [...sources, traveler]
  if (!FlightOfferSchema.safeParse(flight).success || (hotel && !NationalHotelOfferSchema.safeParse(hotel).success))
    throw new Error('Malformed normalized provider offer')
  if (
    flight.id !== flightOfferId(flight) ||
    flight.fingerprint !== flightOfferFingerprint(flight) ||
    selection.flightOfferId !== flight.id ||
    selection.flightFingerprint !== flight.fingerprint
  )
    addViolation('Selected flight identity or quote fingerprint changed.')
  if (
    flight.originCityId !== trip.originCityId ||
    flight.destinationCityId !== trip.destinationCityId ||
    flight.originAirportIata !== input.originAirportIata ||
    flight.destinationAirportIata !== input.destinationAirportIata ||
    flight.departureDate !== input.departureDate
  )
    addViolation('Flight offer does not match the selected cities, airports and departure date.')
  if (
    hotel &&
    (hotel.id !== hotelOfferId(hotel) ||
      hotel.fingerprint !== hotelOfferFingerprint(hotel) ||
      selection.hotelOfferId !== hotel.id ||
      selection.hotelFingerprint !== hotel.fingerprint)
  )
    addViolation('Selected hotel identity or quote fingerprint changed.')
  if ((selection.hotelOfferId !== null) !== (hotel !== null))
    addViolation('Selected hotel is missing from the journey.')
  if ((hotel !== null) !== (facts.stay !== null) || (hotel !== null) !== (input.overnight !== null))
    addViolation('A planned overnight requires a selected origin hotel, one-night dates and complete stay facts.')
  if (millis(facts.checkedAt) > millis(now)) addViolation('Traveler facts are checked in the future.')
  for (const e of sources) {
    if (
      millis(e.checkedAt) > millis(now) ||
      (e.providerUpdatedAt !== null && millis(e.providerUpdatedAt) > millis(now))
    )
      addViolation('Original source evidence is dated in the future.')
    if (e.expiresAt !== null && millis(e.expiresAt) < millis(e.checkedAt))
      addViolation('Original evidence expiry precedes its check.')
  }
  const first = flight.segments[0],
    last = flight.segments.at(-1)!,
    originPlace = place(origin),
    destinationPlace = place(destination)
  if (
    first.originAirport.iata !== input.originAirportIata ||
    last.destinationAirport.iata !== input.destinationAirportIata
  )
    addViolation('Flight segment endpoints do not match the selected airports.')
  if (dateAt(first.departureAt, first.originAirport.timeZone) !== input.departureDate)
    addViolation('Flight departure local date does not match the search date.')
  if (
    new Set(flight.segments.map((s) => s.id)).size !== flight.segments.length ||
    new Set(flight.segments.map((s) => s.boardingId)).size !== flight.segments.length
  )
    addViolation('Each flight segment must have a unique segment and boarding ID.')
  if (
    facts.connections.length !== flight.segments.length - 1 ||
    new Set(facts.connections.map((c) => c.afterSegmentId)).size !== facts.connections.length ||
    facts.connections.some((c) => !flight.segments.slice(0, -1).some((s) => s.id === c.afterSegmentId))
  )
    addViolation('Every flight connection requires exactly one bound allowance.')
  const add = (
    kind: TravelLeg['kind'],
    from: TravelPlace,
    to: TravelPlace,
    startAt: string,
    endAt: string,
    charges: CostLine[] = [],
    evidence: SourceEvidence[] = [traveler],
    extra: Partial<TravelLeg> = {},
  ) => {
    legs.push({
      id: `travel-leg-${legs.length + 1}`,
      kind,
      from,
      to,
      startAt,
      endAt,
      boardingId: null,
      operator: null,
      service: null,
      costs: charges,
      evidence,
      assumptions: [],
      ...extra,
    })
  }
  const transfer = (
    from: TravelPlace,
    to: TravelPlace,
    start: string,
    fact: { minutes: number; costCents: number | null },
    label: string,
  ) => {
    const end = shift(start, fact.minutes, to.timeZone)
    add('transfer', from, to, start, end, [cost(label, fact.costCents)])
    return end
  }
  const wait = (at: TravelPlace, start: string, end: string) => {
    if (millis(end) > millis(start)) add('wait', at, at, start, end)
  }
  const airport = place(first.originAirport),
    processingStart = shift(first.departureAt, -facts.airportProcessingMinutes, airport.timeZone)
  if (hotel && facts.stay) {
    const stay = facts.stay,
      property = place(hotel),
      originStart = shift(stay.hotelArrivalAt, -facts.originTransfer.minutes, origin.timeZone)
    if (hotel.originCityId !== origin.id || hotel.timeZone !== origin.timeZone)
      addViolation('Hotel must belong to the selected origin city and its estimated time zone.')
    if (!input.overnight || hotel.checkin !== input.overnight.checkin || hotel.checkout !== input.overnight.checkout)
      addViolation('Hotel quote dates do not match the requested overnight.')
    if (
      dateAt(stay.hotelArrivalAt, hotel.timeZone) !== hotel.checkin ||
      dateAt(stay.hotelDepartureAt, hotel.timeZone) !== hotel.checkout ||
      dateAt(first.departureAt, first.originAirport.timeZone) !== hotel.checkout
    )
      addViolation('Hotel arrival, departure and next-day flight must match the local check-in and checkout dates.')
    if (!stay.arrangementsConfirmed)
      addViolation(
        'Confirm hotel check-in, checkout and early or late arrival arrangements against the property policy.',
      )
    if (millis(originStart) < millis(trip.readyAt))
      addViolation('Origin hotel access starts before the traveler is ready.')
    if (millis(originStart) < millis(now))
      addViolation('Origin hotel access would already have started; confirm a new prospective journey.')
    wait(originPlace, trip.readyAt, originStart)
    transfer(originPlace, property, originStart, facts.originTransfer, 'Origin city to hotel transfer')
    const checkedIn = shift(stay.hotelArrivalAt, stay.checkinMinutes, hotel.timeZone)
    add(
      'checkin',
      property,
      property,
      stay.hotelArrivalAt,
      checkedIn,
      hotel.costs.some((charge) => !charge.includedInOtherCharge) ? [] : [cost('Unspecified total hotel charge', null)],
      [traveler],
    )
    if (millis(checkedIn) >= millis(stay.hotelDepartureAt))
      addViolation('Hotel check-in must finish before hotel departure, allowing a positive stay.')
    add(
      'hotel',
      property,
      property,
      checkedIn,
      stay.hotelDepartureAt,
      [...hotel.costs, cost('Additional hotel fees', stay.extraFeesCents)],
      hotel.evidence,
    )
    const reached = transfer(property, airport, stay.hotelDepartureAt, stay.hotelToAirport, 'Hotel to airport transfer')
    if (millis(reached) > millis(processingStart))
      addViolation('Hotel departure and airport transfer leave insufficient airport processing time.')
    wait(airport, reached, processingStart)
    warnings.push(
      'Hotel time zone is estimated from the origin city. Confirm the property location, room, cancellation and arrival arrangements.',
    )
  } else {
    const originStart = shift(processingStart, -facts.originTransfer.minutes, origin.timeZone)
    if (millis(originStart) < millis(trip.readyAt))
      addViolation('Origin airport access starts before the traveler is ready.')
    if (millis(originStart) < millis(now))
      addViolation('Origin airport access would already have started; confirm a new prospective journey.')
    if (millis(originStart) > millis(trip.readyAt))
      add('wait', originPlace, originPlace, trip.readyAt, originStart, [], [traveler], {
        assumptions: ['Waiting at the selected origin city; accommodation and lodging are not included.'],
      })
    transfer(originPlace, airport, originStart, facts.originTransfer, 'Origin city to airport transfer')
  }
  add(
    'processing',
    airport,
    airport,
    processingStart,
    first.departureAt,
    flight.costs.some((charge) => !charge.includedInOtherCharge) ? [] : [cost('Unspecified total flight fare', null)],
  )
  flight.segments.forEach((segment, index) => {
    const from = place(segment.originAirport),
      to = place(segment.destinationAirport)
    if (millis(segment.arrivalAt) <= millis(segment.departureAt))
      addViolation('Flight arrival must follow departure by elapsed time.')
    if (Math.abs((millis(segment.arrivalAt) - millis(segment.departureAt)) / 60000 - segment.durationMinutes) > 1)
      addViolation('Flight duration is inconsistent with its original departure and arrival instants.')
    if (index > 0) {
      const previous = flight.segments[index - 1],
        after = place(previous.destinationAirport),
        connection = facts.connections.find((c) => c.afterSegmentId === previous.id)
      let cursor = previous.arrivalAt
      if (previous.destinationAirport.iata !== segment.originAirport.iata) {
        if (!connection?.airportTransfer)
          addViolation('An airport change requires an explicit airport transfer duration and cost fact.')
        else cursor = transfer(after, from, cursor, connection.airportTransfer, 'Connection airport transfer')
      } else if (connection?.airportTransfer)
        addViolation('A same-airport connection must not include an unexplained airport transfer.')
      if (!connection) addViolation('Missing connection processing allowance for a flight segment.')
      else {
        const processed = shift(cursor, connection.allowanceMinutes, from.timeZone)
        add('processing', from, from, cursor, processed)
        cursor = processed
      }
      if (millis(cursor) > millis(segment.departureAt))
        addViolation('Connection transfer and processing allowance do not fit before the next flight.')
      wait(from, cursor, segment.departureAt)
    }
    add(
      'flight',
      from,
      to,
      segment.departureAt,
      segment.arrivalAt,
      index === 0 ? [...flight.costs, cost('Additional flight fees and baggage', facts.flightExtrasCents)] : [],
      segment.evidence,
      { boardingId: segment.boardingId, operator: segment.carrier, service: segment.flightNumber },
    )
  })
  const arrivalPlace = place(last.destinationAirport),
    arrivalEnd = shift(last.arrivalAt, facts.arrivalProcessingMinutes, arrivalPlace.timeZone)
  add('processing', arrivalPlace, arrivalPlace, last.arrivalAt, arrivalEnd)
  let finalArrivalAt: string
  if (selection.onwardOfferId && !onward) addViolation('Selected onward route is missing; search again.')
  if (onward) {
    if (!TravelOnwardOfferSchema.safeParse(onward).success || onward.id !== onwardOfferId(onward) || onward.flightOfferId !== flight.id || onward.flightFingerprint !== flight.fingerprint || onward.arrivalAirportIata !== flight.destinationAirportIata || onward.destinationCityId !== destination.id) addViolation('Onward route does not match the selected flight and final destination.')
    if (!input.onwardFlight || input.onwardFlight.flightOfferId !== flight.id || input.onwardFlight.flightFingerprint !== flight.fingerprint || input.onwardFlight.arrivalProcessingMinutes !== facts.arrivalProcessingMinutes || millis(onward.airportReadyAt) !== millis(arrivalEnd)) addViolation('Onward route readiness does not match the confirmed airport arrival allowance.')
    if (onward.kind === 'drive' && selection.onwardVehicleConfirmed !== true) addViolation('Confirm a vehicle and driver for this onward airport journey.')
    const firstGround = onward.legs[0].from, lastGround = onward.legs.at(-1)!.to
    if (firstGround.latitude !== arrivalPlace.latitude || firstGround.longitude !== arrivalPlace.longitude || lastGround.latitude !== destination.latitude || lastGround.longitude !== destination.longitude) addViolation('Onward route must begin at the arrival airport and reach the final destination.')
    onward.legs.forEach((leg, index) => {
      const from = { name: leg.from.name, latitude: leg.from.latitude ?? NaN, longitude: leg.from.longitude ?? NaN, timeZone: leg.departureTimeZone }
      const to = { name: leg.to.name, latitude: leg.to.latitude ?? NaN, longitude: leg.to.longitude ?? NaN, timeZone: leg.arrivalTimeZone }
      // Airport and city anchors carry canonical names and zones; intermediate stops retain source labels.
      add(leg.mode, index === 0 ? arrivalPlace : from, index === onward.legs.length - 1 ? destinationPlace : to, leg.startAt, leg.endAt, index === 0 ? onward.costs : [], onward.evidence, { boardingId: leg.vehicleId, operator: leg.operator, service: leg.service, assumptions: leg.assumptions })
    })
    finalArrivalAt = onward.legs.at(-1)!.endAt
    warnings.push(...onward.confirmations)
  } else finalArrivalAt = transfer(arrivalPlace, destinationPlace, arrivalEnd, facts.destinationTransfer, 'Destination airport to city transfer')
  const allCosts = legs.flatMap((l) => l.costs)
  const totals = sumCosts(allCosts)
  if (!totals.priceComplete)
    warnings.push('Total price is incomplete: confirm unknown fees, transfers and non-USD amounts before booking.')
  if (trip.budgetCents !== null) {
    if (trip.budgetMode === 'hard' && (!totals.priceComplete || totals.knownCostCents > trip.budgetCents))
      addViolation('The complete journey cannot be verified within the hard budget, including unknown costs.')
    else if (totals.knownCostCents > trip.budgetCents) warnings.push('Known journey costs exceed the preferred budget.')
  }
  if (trip.deadlineAt !== null && millis(finalArrivalAt) > millis(trip.deadlineAt))
    addViolation('Complete journey arrives after the hard destination deadline.')
  if (trip.deadlineAt === null) {
    warnings.push('ASAP discovery covers a seven-day complete journey horizon.')
    if (millis(finalArrivalAt) > millis(trip.readyAt) + 7 * 86400000)
      addViolation('Complete journey exceeds the seven-day ASAP coverage horizon.')
  }
  if (millis(first.departureAt) <= millis(now)) addViolation('The selected flight has already departed.')
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    if (millis(leg.endAt) < millis(leg.startAt)) addViolation('Journey chronology contains an inverted leg.')
    if (i > 0) {
      const previous = legs[i - 1]
      if (millis(previous.endAt) !== millis(leg.startAt)) addViolation('Journey chronology contains a gap or overlap.')
      if (JSON.stringify(previous.to) !== JSON.stringify(leg.from))
        addViolation('Journey locations are disconnected; an explicit transfer is required.')
    }
  }
  const explicitExpiries = sources.filter((e) => e.expiresAt !== null).map((e) => e.expiresAt!)
  const earliest = explicitExpiries.reduce<string | null>(
    (best, next) => (best === null || millis(next) < millis(best) ? next : best),
    null,
  )
  const evidenceExpiresAt =
    earliest !== null && millis(earliest) <= Math.min(...sources.map(expiryOf))
      ? earliest
      : Temporal.Instant.fromEpochMilliseconds(Math.min(...sources.map(expiryOf))).toString()
  return structuredClone({
    id: `journey-${flight.id.slice(7)}${hotel ? '-' + hotel.id.slice(6, 22) : ''}${onward ? '-' + onward.id.slice(7, 23) : ''}`,
    title: onward ? `Flight and onward ${onward.kind === 'drive' ? 'driving' : 'public transit'} journey` : hotel ? 'Origin overnight and connecting flight journey' : 'Complete flight journey',
    originCityId: trip.originCityId,
    destinationCityId: trip.destinationCityId,
    flightOfferId: flight.id,
    hotelOfferId: hotel?.id ?? null,
    legs,
    costs: allCosts,
    evidence: allEvidence,
    finalArrivalAt,
    durationMinutes: Math.max(0, (millis(finalArrivalAt) - millis(trip.readyAt)) / 60000),
    boardings: legs.filter(l => ['flight', 'bus', 'rail', 'subway', 'tram', 'ferry'].includes(l.kind)).length,
    transfers: Math.max(0, legs.filter(l => ['flight', 'bus', 'rail', 'subway', 'tram', 'ferry'].includes(l.kind)).length - 1),
    knownCostCents: totals.knownCostCents,
    priceComplete: totals.priceComplete,
    feasibility: violations.length ? 'infeasible' : 'requires_confirmation',
    selectable: violations.length === 0,
    violations,
    warnings,
    confirmations: [
      'Flight and hotel quotes are discovery results, not reservations. Confirm availability and final prices with the provider before booking.',
      'Confirm all traveler transfer and airport processing allowances.',
    ],
    evidenceExpiresAt,
  })
}
