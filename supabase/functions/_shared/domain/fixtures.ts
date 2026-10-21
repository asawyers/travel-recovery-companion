import { TripRequestSchema } from './schemas.ts'
import type { CarOption, ConfirmedOption, CostLine, HotelOption, SourceEvidence, TransferInput, TransitOption, TripRequest } from './schemas.ts'

// Fictional, deterministic examples only. Never use these as fallback data for a real request.
const NOW = '2026-11-18T07:55:00-05:00'
const DESTINATION = 'Portland, ME'
const AIRPORT = 'BOS terminal exit'
const HOTEL = 'Fictional Airport Example Hotel'
const at = (time: string, day = '18') => `2026-11-${day}T${time}:00-05:00`
const evidence = (serviceDate = '2026-11-18'): SourceEvidence[] => [{
  type: 'synthetic', provider: 'Fictional example source', sourceUrl: null, checkedAt: NOW,
  serviceDate, providerUpdatedAt: null, expiresAt: at('12:00', '19'), environment: 'synthetic',
  warnings: ['Fictional scenario; no real availability, quote, or traveler confirmation.'],
}]
const cost = (label: string, cents: number): CostLine => ({ label, cents, currency: 'USD', includedInOtherCharge: false })
const transfer = (from: string, to: string, minutes: number, costCents: number, kind: 'walk' | 'transfer' = 'transfer', day = '18'): TransferInput => ({
  from, to, minutes, costCents, kind, vehicleId: null, evidence: evidence(`2026-11-${day}`), assumptions: ['Synthetic transfer duration and price.'],
})
const bus = (overnight = false): TransitOption => ({
  kind: 'bus', id: overnight ? 'next-day-bus' : 'bus', title: 'Fictional intercity bus',
  departureAt: overnight ? at('08:00', '19') : at('09:30'), arrivalAt: overnight ? at('10:20', '19') : at('11:50'),
  boardingMinutes: overnight ? 15 : 10, fareCents: 3500,
  access: overnight ? transfer(HOTEL, 'Boston example bus terminal', 25, 1500, 'transfer', '19') : transfer(AIRPORT, 'Boston example bus terminal', 15, 0),
  finalTransfer: transfer('Portland example bus terminal', DESTINATION, 20, 1200, 'transfer', overnight ? '19' : '18'),
  evidence: evidence(overnight ? '2026-11-19' : '2026-11-18'), confirmations: [],
})
const car = (overnight = false): CarOption => ({
  kind: 'car', id: 'car', title: 'Fictional one-way rental car',
  access: transfer(AIRPORT, 'Fictional rental pickup', 15, 0), pickupMinutes: 30, driveMinutes: 110, returnMinutes: 15,
  finalTransfer: transfer('Fictional Portland rental return', DESTINATION, 10, 0, 'walk', overnight ? '19' : '18'),
  costs: [cost('Rental', overnight ? 19500 : 10000), cost('Tax and one-way fee', 2500), cost('Fuel', 1500), cost('Tolls', 500)],
  pickupHoursConfirmed: overnight, returnLocationConfirmed: overnight, evidence: evidence(),
  confirmations: overnight ? [] : ['Fictional inventory, pickup hours, and return location need confirmation.'],
})
const baseRequest = (confirmedOptions: ConfirmedOption[]): TripRequest => ({
  mode: 'synthetic', airport: 'BOS', destination: DESTINATION, timeZone: 'America/New_York',
  arrivalAt: at('08:00'), arrivalBasis: 'scheduled_gate', flight: null, originalDepartureAt: at('09:15'),
  originalAccessMinutes: 30, originalBoardingMinutes: 15, airportExitMinutes: 45,
  deadlineAt: at('14:00'), budgetCents: 15000, budgetMode: 'soft', drivingAllowed: true,
  overnightAllowed: false, priority: 'earliest', confirmedOptions, stay: null,
})
function fixture(request: TripRequest): { request: TripRequest; candidates: ConfirmedOption[]; now: string } {
  const parsed = TripRequestSchema.parse(request)
  return { request: parsed, candidates: parsed.confirmedOptions, now: NOW }
}

export function daytimeFixture(): { request: TripRequest; candidates: ConfirmedOption[]; now: string } {
  const train: TransitOption = {
    kind: 'train', id: 'train', title: 'Fictional intercity train', departureAt: at('10:00'), arrivalAt: at('12:30'),
    boardingMinutes: 15, fareCents: 4500, access: transfer(AIRPORT, 'North Station', 30, 1500),
    finalTransfer: transfer('Portland example train station', DESTINATION, 20, 1200), evidence: evidence(), confirmations: [],
  }
  return fixture(baseRequest([train, bus(), car()]))
}

export function overnightFixture(): { request: TripRequest; candidates: ConfirmedOption[]; now: string } {
  const hotel: HotelOption = {
    id: 'fictional-hotel', name: HOTEL, address: 'Fictional airport-area address, Boston, MA',
    room: 'Fictional standard queen room', board: 'No meals included in this example',
    checkin: '2026-11-18', checkout: '2026-11-19', timeZone: 'America/New_York', adults: 1, rooms: 1,
    costs: [cost('Room', 10000), cost('Hotel tax', 2000)], cancellation: null, lateCheckinConfirmed: false,
    quoteExpiresAt: at('23:00'), evidence: evidence(), handoffId: 'hotel-search',
  }
  const options: ConfirmedOption[] = [{
    kind: 'overnight', id: 'hotel-bus', title: 'Fictional overnight hotel and morning bus', hotel,
    hotelAccess: transfer(AIRPORT, HOTEL, 20, 2000), checkinMinutes: 15,
    leaveHotelAt: at('07:20', '19'), nextDayTransit: bus(true), confirmations: ['Late check-in is unconfirmed in this fictional example.'],
  }, car(true)]
  return fixture({
    ...baseRequest(options), arrivalAt: at('22:00'), originalDepartureAt: at('23:15'),
    deadlineAt: at('12:00', '19'), budgetCents: 25000, overnightAllowed: true,
    // US is an explicit fictional fixture choice, never an inference about a traveler.
    stay: { checkin: '2026-11-18', checkout: '2026-11-19', adults: 1, rooms: 1, guestNationality: 'US' },
  })
}
