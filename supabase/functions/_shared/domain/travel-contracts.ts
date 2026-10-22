import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'
import { sumCosts, toInstantMillis } from './time.ts'
import { CostLineSchema, SourceEvidenceSchema } from './schemas.ts'
import { CitySchema } from './city-contracts.ts'
import { AgentActivitySchema, PreferencePatchSchema } from './assistance.ts'
import { ConversationContextSchema, ConversationEchoSchema } from './conversation.ts'
export type { City } from './city-types.ts'
export const TRAVEL_MAX_FACT_AGE_MS = 300_000
const text = z.string().trim().min(1).max(500)
const id = z.string().trim().min(1).max(100)
const notes = z.array(text).max(64)
const cityId = z
  .string()
  .max(100)
  .regex(/^geonames:\d+$/)
const iata = z.string().regex(/^[A-Z]{3}$/)
const cents = z.number().int().min(0).max(100_000_000)
const minutes = z.number().int().min(0).max(10_080)
const positiveMinutes = z.number().int().min(1).max(10_080)
const timestamp = z
  .string()
  .max(40)
  .refine((v) => {
    try {
      toInstantMillis(v)
      return true
    } catch {
      return false
    }
  }, 'Expected an offset timestamp')
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    try {
      Temporal.PlainDate.from(v, { overflow: 'reject' })
      return true
    } catch {
      return false
    }
  }, 'Expected calendar date')
const zone = z
  .string()
  .min(1)
  .max(100)
  .refine((v) => {
    try {
      if (/^[+-]/.test(v)) return false
      new Intl.DateTimeFormat('en', { timeZone: v })
      return true
    } catch {
      return false
    }
  }, 'Expected IANA time zone')
const latitude = z.number().min(-90).max(90),
  longitude = z.number().min(-180).max(180)
const evidence = z
  .array(SourceEvidenceSchema)
  .min(1)
  .max(16)
  .refine(
    (v) => v.every((e) => e.environment === 'production' && e.type !== 'synthetic'),
    'Travel discovery requires production evidence',
  )
const costs = z.array(CostLineSchema).min(1).max(32)
// Customer destinations are deliberately separate from provenance and provider API URLs.
const handoffUrl = (kind: 'flights' | 'hotels') =>
  z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value)
        return (
          url.protocol === 'https:' &&
          ['google.com', 'www.google.com'].includes(url.hostname) &&
          !url.port &&
          !url.username &&
          !url.password &&
          !url.hash &&
          (url.pathname === `/travel/${kind}` || url.pathname === `/travel/${kind}/`) &&
          [...url.searchParams.keys()].every((key) => ['q', 'hl', 'gl', 'curr', 'tfs', 'tfu'].includes(key))
        )
      } catch {
        return false
      }
    }, 'Expected an allowlisted customer Google Travel URL')
    .nullable()
export const AirportSchema = z.strictObject({
  iata,
  name: text,
  latitude,
  longitude,
  timeZone: zone,
  metadataSource: text,
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  stateCode: z.string().max(100),
  municipality: z.string().max(500),
  kind: z.enum(['large_airport', 'medium_airport', 'small_airport']),
})
export type TravelAirport = z.infer<typeof AirportSchema>
export const TravelTripSchema = z
  .strictObject({
    originCityId: cityId,
    destinationCityId: cityId,
    readyAt: timestamp,
    deadlineAt: timestamp.nullable(),
    budgetCents: cents.nullable(),
    budgetMode: z.enum(['hard', 'soft']),
    drivingAllowed: z.boolean(),
    priority: z.enum(['earliest', 'cheapest', 'fewest_transfers']),
  })
  .refine((v) => v.originCityId !== v.destinationCityId, 'Cities must be distinct')
export type TravelTrip = z.infer<typeof TravelTripSchema>
export const TravelOvernightSchema = z.strictObject({ checkin: date, checkout: date }).refine((v) => {
  try {
    return Temporal.PlainDate.from(v.checkin).add({ days: 1 }).toString() === v.checkout
  } catch {
    return false
  }
}, 'Stay must be exactly one night')
export const FlightSegmentSchema = z.strictObject({
  id,
  boardingId: id,
  originAirport: AirportSchema,
  destinationAirport: AirportSchema,
  departureAt: timestamp,
  arrivalAt: timestamp,
  carrier: text,
  flightNumber: text,
  durationMinutes: z.number().positive().max(10_080),
  evidence,
})
export type FlightSegment = z.infer<typeof FlightSegmentSchema>
export const FlightOfferSchema = z
  .strictObject({
    id,
    fingerprint: id,
    originCityId: cityId,
    destinationCityId: cityId,
    departureDate: date,
    originAirportIata: iata,
    destinationAirportIata: iata,
    handoffUrl: handoffUrl('flights'),
    segments: z.array(FlightSegmentSchema).min(1).max(8),
    costs,
    evidence,
  })
  .superRefine((v, ctx) => {
    if (
      v.segments[0]?.originAirport.iata !== v.originAirportIata ||
      v.segments.at(-1)?.destinationAirport.iata !== v.destinationAirportIata
    )
      ctx.addIssue({ code: 'custom', message: 'Flight segment endpoints must match the advertised airports' })
    if (
      new Set(v.segments.map((s) => s.id)).size !== v.segments.length ||
      new Set(v.segments.map((s) => s.boardingId)).size !== v.segments.length
    )
      ctx.addIssue({ code: 'custom', message: 'Flight segment IDs and boarding identities must be unique' })
  })
export type FlightOffer = z.infer<typeof FlightOfferSchema>
export const NationalHotelOfferSchema = z
  .strictObject({
    id,
    fingerprint: id,
    originCityId: cityId,
    propertyId: id,
    handoffUrl: handoffUrl('hotels'),
    name: text,
    latitude,
    longitude,
    address: text.nullable(),
    timeZone: zone,
    timeZoneStatus: z.literal('estimated_from_origin_city'),
    checkin: date,
    checkout: date,
    adults: z.literal(1),
    rooms: z.literal(1),
    room: text.nullable(),
    cancellation: z.string().trim().min(1).max(4000).nullable(),
    checkinPolicy: z.string().trim().min(1).max(4000).nullable(),
    checkoutPolicy: z.string().trim().min(1).max(4000).nullable(),
    costs,
    evidence,
  })
  .refine(
    (v) => TravelOvernightSchema.safeParse({ checkin: v.checkin, checkout: v.checkout }).success,
    'Stay must be exactly one night',
  )
export type NationalHotelOffer = z.infer<typeof NationalHotelOfferSchema>
export const TravelTransferFactSchema = z.strictObject({ minutes: positiveMinutes, costCents: cents.nullable() })
export const TravelJourneyFactsSchema = z.strictObject({
  originTransfer: TravelTransferFactSchema,
  airportProcessingMinutes: positiveMinutes,
  arrivalProcessingMinutes: minutes,
  destinationTransfer: TravelTransferFactSchema,
  connections: z
    .array(
      z.strictObject({
        afterSegmentId: id,
        allowanceMinutes: positiveMinutes,
        airportTransfer: TravelTransferFactSchema.nullable(),
      }),
    )
    .max(7),
  flightExtrasCents: cents.nullable(),
  stay: z
    .strictObject({
      hotelArrivalAt: timestamp,
      hotelDepartureAt: timestamp,
      checkinMinutes: positiveMinutes,
      hotelToAirport: TravelTransferFactSchema,
      extraFeesCents: cents.nullable(),
      arrangementsConfirmed: z.boolean(),
    })
    .nullable(),
  checkedAt: timestamp,
})
export type TravelJourneyFacts = z.infer<typeof TravelJourneyFactsSchema>
export const TravelSelectionSchema = z
  .strictObject({
    flightOfferId: id,
    flightFingerprint: id,
    hotelOfferId: id.nullable(),
    hotelFingerprint: id.nullable(),
    facts: TravelJourneyFactsSchema,
  })
  .refine(
    (v) => (v.hotelOfferId === null) === (v.hotelFingerprint === null),
    'Hotel selection requires its fingerprint',
  )
const inputFields = {
  version: z.literal(3),
  trip: TravelTripSchema,
  originAirportIata: iata,
  destinationAirportIata: iata,
  departureDate: date,
  overnight: TravelOvernightSchema.nullable(),
  selection: TravelSelectionSchema.nullable(),
  investigate: z.boolean(),
}
export const TravelRequestBindingSchema = z.strictObject(inputFields)
export type TravelRequestBinding = z.infer<typeof TravelRequestBindingSchema>
export const TravelRecoveryInputSchema = z.strictObject({
  ...inputFields,
  refinement: z.string().trim().min(1).max(500).optional(),
  conversation: ConversationContextSchema.optional(),
})
export type TravelRecoveryInput = z.infer<typeof TravelRecoveryInputSchema>
export function travelRequestBinding(input: TravelRecoveryInput): TravelRequestBinding {
  const { refinement: _, conversation: __, ...binding } = input
  return TravelRequestBindingSchema.parse(binding)
}
export const TravelPlaceSchema = z.strictObject({ name: text, latitude, longitude, timeZone: zone })
export type TravelPlace = z.infer<typeof TravelPlaceSchema>
export const TravelLegSchema = z.strictObject({
  id,
  kind: z.enum(['transfer', 'wait', 'processing', 'flight', 'hotel', 'checkin']),
  from: TravelPlaceSchema,
  to: TravelPlaceSchema,
  startAt: timestamp,
  endAt: timestamp,
  boardingId: id.nullable(),
  operator: text.nullable(),
  service: text.nullable(),
  // At most 32 original quote charges plus one explicit traveler extras line.
  costs: z.array(CostLineSchema).max(33),
  evidence,
  assumptions: notes,
})
export type TravelLeg = z.infer<typeof TravelLegSchema>
export const TravelJourneySchema = z
  .strictObject({
    id,
    title: text,
    originCityId: cityId,
    destinationCityId: cityId,
    flightOfferId: id,
    hotelOfferId: id.nullable(),
    legs: z.array(TravelLegSchema).max(64),
    costs: z.array(CostLineSchema).max(128),
    evidence: z.array(SourceEvidenceSchema).min(1).max(161),
    finalArrivalAt: timestamp,
    durationMinutes: z.number().nonnegative(),
    boardings: z.number().int().min(0).max(8),
    transfers: z.number().int().min(0).max(7),
    knownCostCents: z.number().int().nonnegative(),
    priceComplete: z.boolean(),
    feasibility: z.enum(['requires_confirmation', 'infeasible']),
    selectable: z.boolean(),
    violations: notes,
    warnings: notes,
    confirmations: notes,
    evidenceExpiresAt: timestamp.nullable(),
  })
  .refine(
    (v) => v.violations.length > 0 === (v.feasibility === 'infeasible') && v.selectable === (v.violations.length === 0),
    'Assessment must agree with violations',
  )
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (v.finalArrivalAt !== v.legs.at(-1)?.endAt) issue('Final arrival must equal the final leg end')
    if (JSON.stringify(v.costs) !== JSON.stringify(v.legs.flatMap((leg) => leg.costs)))
      issue('Journey cost lines must equal all per-leg charges exactly once')
    // Refinements can run after field-range failures; aggregate validation must remain non-throwing.
    try {
      const totals = sumCosts(v.costs)
      if (totals.knownCostCents !== v.knownCostCents || totals.priceComplete !== v.priceComplete)
        issue('Journey total must match its complete cost lines')
    } catch {
      issue('Journey costs must contain valid nonnegative integer amounts')
    }
    const flights = v.legs.filter((l) => l.kind === 'flight')
    if (flights.length !== v.boardings || v.transfers !== Math.max(0, flights.length - 1))
      issue('Flight and transfer counts must match the legs')
    if (v.selectable) {
      try {
        if (
          !v.legs[0] ||
          v.durationMinutes !== (toInstantMillis(v.finalArrivalAt) - toInstantMillis(v.legs[0].startAt)) / 60000
        )
          issue('Journey duration must equal the fully represented elapsed time')
        for (const [index, leg] of v.legs.entries()) {
          if (toInstantMillis(leg.endAt) < toInstantMillis(leg.startAt))
            issue('Selectable journey cannot contain an inverted leg')
          if (
            ['wait', 'processing', 'hotel', 'checkin'].includes(leg.kind) &&
            JSON.stringify(leg.from) !== JSON.stringify(leg.to)
          )
            issue('Stationary legs cannot move the traveler')
          if (index > 0) {
            const prior = v.legs[index - 1]
            if (
              toInstantMillis(prior.endAt) !== toInstantMillis(leg.startAt) ||
              JSON.stringify(prior.to) !== JSON.stringify(leg.from)
            )
              issue('Selectable journey must have contiguous times and locations')
          }
        }
      } catch {
        /* Field validation reports invalid timestamps. */
      }
    }
  })
export type TravelJourney = z.infer<typeof TravelJourneySchema>
export const TravelSourceStatusSchema = z.strictObject({
  source: z.enum(['flights', 'hotels']),
  status: z.enum(['available', 'empty', 'unavailable', 'limited']),
  message: text,
  checkedAt: timestamp,
  expiresAt: timestamp.nullable(),
})
export type TravelSourceStatus = z.infer<typeof TravelSourceStatusSchema>
export const TravelSelectionIssueSchema = z.enum([
  'flight_missing',
  'flight_changed',
  'hotel_missing',
  'hotel_changed',
  'expired',
])
export type TravelSelectionIssue = z.infer<typeof TravelSelectionIssueSchema>
export const TravelAssistanceSchema = z
  .strictObject({
    status: z.enum(['completed', 'unavailable', 'limited']),
    summary: z.string().trim().min(1).max(1500),
    appliedPreferences: PreferencePatchSchema,
    selectedPlanId: id.nullable(),
    activity: z.array(AgentActivitySchema).max(32),
    clarification: z
      .strictObject({
        field: z.enum(['flight', 'airport', 'transfer', 'hotel', 'readyAt', 'deadlineAt', 'budget', 'preference']),
        reason: z.enum(['required', 'ambiguous', 'conflicting', 'unsupported']),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.clarification &&
      (v.status !== 'limited' || Object.keys(v.appliedPreferences).length !== 0 || v.selectedPlanId !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Clarification requires limited status, unchanged preferences and no selection',
      })
  })
export type TravelAssistance = z.infer<typeof TravelAssistanceSchema>
export const TravelRecoveryResponseSchema = z
  .strictObject({
    version: z.literal(3),
    request: TravelRequestBindingSchema,
    origin: CitySchema,
    destination: CitySchema,
    generatedAt: timestamp,
    expiresAt: timestamp,
    flightOffers: z.array(FlightOfferSchema).max(3),
    hotelOffers: z.array(NationalHotelOfferSchema).max(3),
    sourceStatuses: z.array(TravelSourceStatusSchema).max(2),
    journey: TravelJourneySchema.nullable(),
    selectionIssue: TravelSelectionIssueSchema.nullable(),
    warnings: notes,
    assistance: TravelAssistanceSchema.optional(),
    conversation: ConversationEchoSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (v.origin.id !== v.request.trip.originCityId || v.destination.id !== v.request.trip.destinationCityId)
      issue('City metadata must match request')
    try {
      const generated = toInstantMillis(v.generatedAt),
        expiry = toInstantMillis(v.expiresAt)
      const ev = [
        ...v.flightOffers.flatMap((f) => [...f.evidence, ...f.segments.flatMap((s) => s.evidence)]),
        ...v.hotelOffers.flatMap((h) => h.evidence),
      ]
      if (
        expiry > generated + TRAVEL_MAX_FACT_AGE_MS ||
        ev.some(
          (e) =>
            expiry > toInstantMillis(e.checkedAt) + TRAVEL_MAX_FACT_AGE_MS ||
            (e.expiresAt !== null && expiry > toInstantMillis(e.expiresAt)),
        )
      )
        issue('Collection cannot outlive original evidence or five minutes')
      if (ev.some((e) => toInstantMillis(e.checkedAt) > generated)) issue('Collection cannot precede original evidence')
    } catch {
      /* Invalid timestamps already have field issues. */
    }
    for (const flight of v.flightOffers) {
      if (
        flight.originCityId !== v.request.trip.originCityId ||
        flight.destinationCityId !== v.request.trip.destinationCityId ||
        flight.originAirportIata !== v.request.originAirportIata ||
        flight.destinationAirportIata !== v.request.destinationAirportIata ||
        flight.departureDate !== v.request.departureDate
      )
        issue('Flight offer must match the exact request binding')
      if (flight.id !== flightOfferId(flight) || flight.fingerprint !== flightOfferFingerprint(flight))
        issue('Flight identity and fingerprint must match its original quote')
    }
    for (const hotel of v.hotelOffers) {
      if (
        hotel.originCityId !== v.request.trip.originCityId ||
        hotel.timeZone !== v.origin.timeZone ||
        !v.request.overnight ||
        hotel.checkin !== v.request.overnight.checkin ||
        hotel.checkout !== v.request.overnight.checkout
      )
        issue('Hotel offer must match the origin city and requested overnight dates')
      if (hotel.id !== hotelOfferId(hotel) || hotel.fingerprint !== hotelOfferFingerprint(hotel))
        issue('Hotel identity and fingerprint must match its original quote')
    }
    if (
      new Set(v.flightOffers.map((f) => f.id)).size !== v.flightOffers.length ||
      new Set(v.hotelOffers.map((h) => h.id)).size !== v.hotelOffers.length
    )
      issue('Offer identities must be unique')
    if (v.journey && v.request.selection) {
      const selection = v.request.selection,
        flight = v.flightOffers.find((f) => f.id === selection.flightOfferId),
        hotel = v.hotelOffers.find((h) => h.id === selection.hotelOfferId)
      if (
        v.journey.flightOfferId !== selection.flightOfferId ||
        !flight ||
        flight.fingerprint !== selection.flightFingerprint
      )
        issue('Journey must use the selected original flight quote')
      if (
        v.journey.hotelOfferId !== selection.hotelOfferId ||
        (selection.hotelOfferId !== null && (!hotel || hotel.fingerprint !== selection.hotelFingerprint))
      )
        issue('Journey must use the selected original hotel quote')
      if (v.journey.selectable && (v.journey.hotelOfferId !== null) !== (v.request.overnight !== null))
        issue('Selectable journey must include exactly the requested overnight')
      const journey = v.journey,
        facts = selection.facts
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
      const place = (p: { name: string; latitude: number; longitude: number; timeZone: string }) => ({
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        timeZone: p.timeZone,
      })
      const extraCost = (label: string, cents: number | null) => ({
        label,
        cents,
        currency: 'USD',
        includedInOtherCharge: false,
      })
      const flightLegs = journey.legs.filter((leg) => leg.kind === 'flight')
      if (flight) {
        if (flightLegs.length !== flight.segments.length) issue('Journey must retain every selected flight segment')
        flight.segments.forEach((segment, index) => {
          const leg = flightLegs[index]
          if (
            !leg ||
            leg.boardingId !== segment.boardingId ||
            leg.operator !== segment.carrier ||
            leg.service !== segment.flightNumber ||
            leg.startAt !== segment.departureAt ||
            leg.endAt !== segment.arrivalAt ||
            !same(leg.from, place(segment.originAirport)) ||
            !same(leg.to, place(segment.destinationAirport)) ||
            !same(leg.evidence, segment.evidence)
          )
            issue(
              'Journey flight legs must preserve the selected segment airports, schedule, boarding and source evidence',
            )
          const charges =
            index === 0
              ? [...flight.costs, extraCost('Additional flight fees and baggage', facts.flightExtrasCents)]
              : []
          if (leg && !same(leg.costs, charges)) issue('Selected flight fare and extras must be charged exactly once')
        })
      }
      // Bind the entire payable ledger to selected inventory and traveler facts. This also prevents
      // a valid source fare being copied onto an unrelated leg while preserving arithmetic totals.
      if (flight) {
        const hasStay = Boolean(hotel && facts.stay)
        const expectedCosts = [
          extraCost(
            hasStay ? 'Origin city to hotel transfer' : 'Origin city to airport transfer',
            facts.originTransfer.costCents,
          ),
        ]
        if (hotel && facts.stay) {
          if (!hotel.costs.some((charge) => !charge.includedInOtherCharge))
            expectedCosts.push(extraCost('Unspecified total hotel charge', null))
          expectedCosts.push(
            ...hotel.costs,
            extraCost('Additional hotel fees', facts.stay.extraFeesCents),
            extraCost('Hotel to airport transfer', facts.stay.hotelToAirport.costCents),
          )
        }
        if (!flight.costs.some((charge) => !charge.includedInOtherCharge))
          expectedCosts.push(extraCost('Unspecified total flight fare', null))
        expectedCosts.push(...flight.costs, extraCost('Additional flight fees and baggage', facts.flightExtrasCents))
        flight.segments.slice(0, -1).forEach((segment, index) => {
          const connection = facts.connections.find((c) => c.afterSegmentId === segment.id)
          if (
            segment.destinationAirport.iata !== flight.segments[index + 1].originAirport.iata &&
            connection?.airportTransfer
          )
            expectedCosts.push(extraCost('Connection airport transfer', connection.airportTransfer.costCents))
        })
        expectedCosts.push(extraCost('Destination airport to city transfer', facts.destinationTransfer.costCents))
        if (!same(journey.costs, expectedCosts))
          issue('Journey charges must preserve the selected source totals and bound traveler costs exactly once')
      }
      const hotelLegs = journey.legs.filter((leg) => leg.kind === 'hotel')
      if (hotel && facts.stay) {
        const leg = hotelLegs[0],
          stay = facts.stay
        if (
          hotelLegs.length !== 1 ||
          !leg ||
          !same(leg.from, place(hotel)) ||
          !same(leg.to, place(hotel)) ||
          leg.endAt !== stay.hotelDepartureAt ||
          !same(leg.evidence, hotel.evidence)
        )
          issue('Journey hotel leg must preserve the selected property, departure and original evidence')
        if (leg && !same(leg.costs, [...hotel.costs, extraCost('Additional hotel fees', stay.extraFeesCents)]))
          issue('Selected hotel quote and extras must be charged exactly once')
        try {
          if (
            leg &&
            toInstantMillis(leg.startAt) !== toInstantMillis(stay.hotelArrivalAt) + stay.checkinMinutes * 60000
          )
            issue('Hotel stay must start after the selected arrival and check-in allowance')
        } catch {
          /* Timestamp fields already carry validation issues. */
        }
      } else if (hotelLegs.length > 0) issue('A hotel leg requires the selected property and explicit stay facts')
      try {
        const elapsed = Math.max(
          0,
          (toInstantMillis(journey.finalArrivalAt) - toInstantMillis(v.request.trip.readyAt)) / 60000,
        )
        if (journey.durationMinutes !== elapsed) issue('Journey duration must match the original request readiness')
        if (
          journey.selectable &&
          (!journey.legs[0] || toInstantMillis(journey.legs[0].startAt) !== toInstantMillis(v.request.trip.readyAt))
        )
          issue('Selectable journey must represent all time from original readiness')
      } catch {
        /* Timestamp fields already carry validation issues. */
      }
    }
    if (v.assistance) {
      for (const key of ['priority', 'drivingAllowed'] as const)
        if (
          v.assistance.appliedPreferences[key] !== undefined &&
          v.assistance.appliedPreferences[key] !== v.request.trip[key]
        )
          issue('Applied preferences must match the canonical request')
    }
    if (v.journey && (!v.request.selection || v.selectionIssue !== null))
      issue('Journey requires an unchanged explicit selection')
    if (v.journey && (v.journey.originCityId !== v.origin.id || v.journey.destinationCityId !== v.destination.id))
      issue('Journey city binding mismatch')
    if (
      v.assistance?.selectedPlanId !== null &&
      v.assistance?.selectedPlanId !== undefined &&
      (!v.journey?.selectable || v.assistance.selectedPlanId !== v.journey.id)
    )
      issue('Assistance may select only the assessed eligible journey')
  })
export type TravelRecoveryResponse = z.infer<typeof TravelRecoveryResponseSchema>

/** Canonical non-security identity. Freshness is intentionally excluded: a re-fetch must compare the actual quote. */
function canonical(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return '[' + value.map((v) => canonical(v, depth + 1)).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([k]) => k !== 'evidence' && (depth !== 0 || !['id', 'fingerprint'].includes(k)))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v, depth + 1))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}
function digest(value: unknown): string {
  const s = canonical(value)
  return [2166136261, 3335557771, 1234567891, 4093082899]
    .map((seed) => {
      let h = seed
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
      return (h >>> 0).toString(16).padStart(8, '0')
    })
    .join('')
}
type FlightPayload = Omit<FlightOffer, 'id' | 'fingerprint'>
type HotelPayload = Omit<NationalHotelOffer, 'id' | 'fingerprint'>
export function flightOfferFingerprint(offer: FlightPayload): string {
  return 'flight-quote-' + digest(offer)
}
export function flightOfferId(offer: FlightPayload): string {
  return (
    'flight-' +
    digest({
      originCityId: offer.originCityId,
      destinationCityId: offer.destinationCityId,
      departureDate: offer.departureDate,
      originAirportIata: offer.originAirportIata,
      destinationAirportIata: offer.destinationAirportIata,
      segments: offer.segments.map((s) => ({
        origin: s.originAirport.iata,
        destination: s.destinationAirport.iata,
        departureAt: s.departureAt,
        arrivalAt: s.arrivalAt,
        carrier: s.carrier,
        flightNumber: s.flightNumber,
        boardingId: s.boardingId,
      })),
    })
  )
}
export function hotelOfferFingerprint(offer: HotelPayload): string {
  return 'hotel-quote-' + digest(offer)
}
export function hotelOfferId(offer: HotelPayload): string {
  return (
    'hotel-' +
    digest({
      originCityId: offer.originCityId,
      propertyId: offer.propertyId,
      checkin: offer.checkin,
      checkout: offer.checkout,
      adults: offer.adults,
      rooms: offer.rooms,
    })
  )
}
