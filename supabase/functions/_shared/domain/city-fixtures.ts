import type { City, CityCandidate, CityLeg, CityPlace, CityTripRequest } from './city-contracts.ts'

const boston: City = { id: 'geonames:4930956', name: 'Boston', stateCode: 'MA', stateName: 'Massachusetts', countryCode: 'US', countyName: 'Suffolk County', latitude: 42.35843, longitude: -71.05977, timeZone: 'America/New_York' }
const portland: City = { id: 'geonames:4975802', name: 'Portland', stateCode: 'ME', stateName: 'Maine', countryCode: 'US', countyName: 'Cumberland County', latitude: 43.66147, longitude: -70.25533, timeZone: 'America/New_York' }
const losAngeles: City = { id: 'geonames:5368361', name: 'Los Angeles', stateCode: 'CA', stateName: 'California', countryCode: 'US', countyName: 'Los Angeles County', latitude: 34.05223, longitude: -118.24368, timeZone: 'America/Los_Angeles' }
const newYork: City = { id: 'geonames:5128581', name: 'New York City', stateCode: 'NY', stateName: 'New York', countryCode: 'US', countyName: null, latitude: 40.71427, longitude: -74.00597, timeZone: 'America/New_York' }
const place = (city: City): CityPlace => ({ name: `${city.name}, ${city.stateCode}`, latitude: city.latitude, longitude: city.longitude })
const at = (value: string, minutes: number) => new Date(Date.parse(value) + minutes * 60_000).toISOString()
export type CityFixture = { request: CityTripRequest; candidates: CityCandidate[]; origin: City; destination: City; now: string }

function fixture(originCity: City, destinationCity: City, crossCountry = false): CityFixture {
  const origin = { ...originCity }, destination = { ...destinationCity }
  const readyAt = '2026-11-18T08:00:00-05:00', now = '2026-11-18T07:55:00-05:00'
  const stationA = { ...place(origin), name: `Fictional ${origin.name} station` }
  const stationB = { ...place(destination), name: `Fictional ${destination.name} station` }
  const evidence: CityCandidate['evidence'] = [{ type: 'synthetic', provider: 'Fictional city journey fixture', sourceUrl: null, checkedAt: now,
    serviceDate: '2026-11-18', providerUpdatedAt: null, expiresAt: null, environment: 'synthetic', warnings: ['Fictional demonstration; no real schedule, price, or inventory claim.'] }]
  const leg = (id: string, mode: CityLeg['mode'], from: CityPlace, to: CityPlace, start: number, end: number, vehicleId: string | null): CityLeg => ({
    id, mode, from, to, startAt: at(readyAt, start), endAt: at(readyAt, end), departureTimeZone: from === stationB ? destination.timeZone : origin.timeZone,
    arrivalTimeZone: mode === 'rail' || from === stationB ? destination.timeZone : origin.timeZone,
    operator: mode === 'rail' ? 'Fictional Rail' : null, service: mode === 'rail' ? 'Fictional service' : null, vehicleId, assumptions: [],
  })
  const arrival = crossCountry ? 3000 : 180
  const candidate: CityCandidate = { id: 'fictional-city-rail', title: 'Fictional rail journey', kind: 'transit', originCityId: origin.id, destinationCityId: destination.id,
    legs: [leg('walk-origin', 'walk', place(origin), stationA, 0, 15, null), leg('wait-station', 'wait', stationA, stationA, 15, 30, null),
      leg('rail', 'rail', stationA, stationB, 30, arrival, 'fictional-rail-1'), leg('walk-destination', 'walk', stationB, place(destination), arrival, arrival + 15, null)],
    costs: [{ label: 'Fictional route fare including transfers', cents: crossCountry ? 25000 : 4500, currency: 'USD', includedInOtherCharge: false }], evidence, confirmations: [],
  }
  const candidates = [candidate]
  const request: CityTripRequest = { version: 2, mode: 'synthetic', originCityId: origin.id, destinationCityId: destination.id, readyAt, deadlineAt: null,
    budgetCents: null, budgetMode: 'soft', drivingAllowed: true, priority: 'earliest', confirmedOptions: candidates }
  return { request, candidates, origin, destination, now }
}
/** Fresh immutable-by-caller examples; metadata is injected and never looked up at runtime. */
export function cityFixture(): CityFixture { return fixture(boston, portland) }
export const namedCityFixtures = {
  boston: () => fixture(boston, portland),
  portland: () => fixture(portland, boston),
  losAngeles: () => fixture(losAngeles, newYork, true),
  newYork: () => fixture(newYork, losAngeles, true),
}
