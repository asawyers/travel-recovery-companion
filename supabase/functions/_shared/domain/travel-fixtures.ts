/** Deterministic test examples, never provider inventory. */
import type { City } from './city-types.ts'
import {
  flightOfferFingerprint,
  flightOfferId,
  hotelOfferFingerprint,
  hotelOfferId,
  type FlightOffer,
  type NationalHotelOffer,
  type TravelAirport,
  type TravelRecoveryInput,
} from './travel-contracts.ts'
import type { SourceEvidence } from './schemas.ts'
export function travelFixture() {
  const now = '2026-11-18T06:00:00-08:00'
  const origin: City = {
    id: 'geonames:5391811',
    name: 'San Diego',
    stateCode: 'CA',
    stateName: 'California',
    countryCode: 'US',
    countyName: 'San Diego County',
    latitude: 32.7157,
    longitude: -117.1611,
    timeZone: 'America/Los_Angeles',
  }
  const destination: City = {
    id: 'geonames:4975802',
    name: 'Portland',
    stateCode: 'ME',
    stateName: 'Maine',
    countryCode: 'US',
    countyName: 'Cumberland County',
    latitude: 43.6591,
    longitude: -70.2568,
    timeZone: 'America/New_York',
  }
  const airport = (
    iata: string,
    name: string,
    latitude: number,
    longitude: number,
    timeZone: string,
    stateCode: string,
  ): TravelAirport => ({
    iata,
    name,
    latitude,
    longitude,
    timeZone,
    stateCode,
    countryCode: 'US',
    municipality: name,
    kind: 'large_airport',
    metadataSource: 'Test fixture airport metadata',
  })
  const san = airport('SAN', 'San Diego International', 32.7336, -117.1897, origin.timeZone, 'CA'),
    ord = airport('ORD', 'Chicago O’Hare', 41.9742, -87.9073, 'America/Chicago', 'IL'),
    pwm = airport('PWM', 'Portland International Jetport', 43.6462, -70.3093, destination.timeZone, 'ME')
  const evidence: SourceEvidence = {
    type: 'estimated',
    environment: 'production',
    provider: 'Test-only quoted inventory',
    sourceUrl: null,
    checkedAt: now,
    expiresAt: '2026-11-18T06:05:00-08:00',
    providerUpdatedAt: null,
    serviceDate: '2026-11-19',
    warnings: ['Deterministic test fixture, not a live quote.'],
  }
  const flight: FlightOffer = {
    id: 'pending',
    fingerprint: 'pending',
    handoffUrl: null,
    originCityId: origin.id,
    destinationCityId: destination.id,
    departureDate: '2026-11-19',
    originAirportIata: 'SAN',
    destinationAirportIata: 'PWM',
    segments: [
      {
        id: 'segment-1',
        boardingId: 'AA-1',
        originAirport: san,
        destinationAirport: ord,
        departureAt: '2026-11-19T09:00:00-08:00',
        arrivalAt: '2026-11-19T15:00:00-06:00',
        carrier: 'American',
        flightNumber: 'AA1',
        durationMinutes: 240,
        evidence: [structuredClone(evidence)],
      },
      {
        id: 'segment-2',
        boardingId: 'AA-2',
        originAirport: ord,
        destinationAirport: pwm,
        departureAt: '2026-11-19T16:00:00-06:00',
        arrivalAt: '2026-11-19T19:00:00-05:00',
        carrier: 'American',
        flightNumber: 'AA2',
        durationMinutes: 120,
        evidence: [structuredClone(evidence)],
      },
    ],
    costs: [{ label: 'Total quoted flight fare', cents: 25000, currency: 'USD', includedInOtherCharge: false }],
    evidence: [structuredClone(evidence)],
  }
  flight.id = flightOfferId(flight)
  flight.fingerprint = flightOfferFingerprint(flight)
  const hotel: NationalHotelOffer = {
    id: 'pending',
    fingerprint: 'pending',
    handoffUrl: null,
    originCityId: origin.id,
    propertyId: 'property-san-1',
    name: 'Example San Diego Hotel',
    latitude: 32.72,
    longitude: -117.17,
    address: null,
    timeZone: origin.timeZone,
    timeZoneStatus: 'estimated_from_origin_city',
    checkin: '2026-11-18',
    checkout: '2026-11-19',
    adults: 1,
    rooms: 1,
    room: null,
    cancellation: null,
    checkinPolicy: null,
    checkoutPolicy: null,
    costs: [{ label: 'One night total quote', cents: 12000, currency: 'USD', includedInOtherCharge: false }],
    evidence: [{ ...structuredClone(evidence), serviceDate: '2026-11-18' }],
  }
  hotel.id = hotelOfferId(hotel)
  hotel.fingerprint = hotelOfferFingerprint(hotel)
  const input: TravelRecoveryInput = {
    version: 3,
    trip: {
      originCityId: origin.id,
      destinationCityId: destination.id,
      readyAt: '2026-11-18T08:00:00-08:00',
      deadlineAt: null,
      budgetCents: null,
      budgetMode: 'soft',
      drivingAllowed: false,
      priority: 'earliest',
    },
    originAirportIata: 'SAN',
    destinationAirportIata: 'PWM',
    departureDate: flight.departureDate,
    overnight: null,
    investigate: false,
    selection: {
      flightOfferId: flight.id,
      flightFingerprint: flight.fingerprint,
      hotelOfferId: null,
      hotelFingerprint: null,
      facts: {
        originTransfer: { minutes: 30, costCents: 2000 },
        airportProcessingMinutes: 120,
        arrivalProcessingMinutes: 30,
        destinationTransfer: { minutes: 20, costCents: 2000 },
        connections: [{ afterSegmentId: 'segment-1', allowanceMinutes: 45, airportTransfer: null }],
        flightExtrasCents: 0,
        stay: null,
        checkedAt: now,
      },
    },
  }
  return { now, origin, destination, input, flight, hotel, flightOffers: [flight], hotelOffers: [hotel] }
}
export function overnightTravelFixture() {
  const f = travelFixture()
  f.input.overnight = { checkin: f.hotel.checkin, checkout: f.hotel.checkout }
  Object.assign(f.input.selection!, { hotelOfferId: f.hotel.id, hotelFingerprint: f.hotel.fingerprint })
  f.input.selection!.facts.stay = {
    hotelArrivalAt: '2026-11-18T16:00:00-08:00',
    hotelDepartureAt: '2026-11-19T06:30:00-08:00',
    checkinMinutes: 15,
    hotelToAirport: { minutes: 30, costCents: 2000 },
    extraFeesCents: 0,
    arrangementsConfirmed: true,
  }
  return f
}
