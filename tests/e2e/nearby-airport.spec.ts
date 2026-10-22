import { expect, type Locator, type Page, test } from '@playwright/test'
import { findAirport } from '../../supabase/functions/_shared/domain/airport-metadata'
import { findCity } from '../../supabase/functions/_shared/domain/city-catalog'
import { planCityRecovery } from '../../supabase/functions/_shared/domain/city-planner'
import { travelFixture } from '../../supabase/functions/_shared/domain/travel-fixtures'
import { assessTravelSelection } from '../../supabase/functions/_shared/domain/travel-planner'
import {
  flightOfferFingerprint, flightOfferId, onwardOfferId, TravelRecoveryResponseSchema, travelRequestBinding,
  type FlightOffer, type TravelOnwardOffer, type TravelRecoveryInput,
} from '../../supabase/functions/_shared/domain/travel-contracts'

const now = '2026-11-18T14:00:00Z', expiry = '2026-11-18T14:05:00Z'
const alternate = (page: Page) => page.getByRole('region', { name: 'Nearby airport flight and onward planning', exact: true })
function flightQuote(input: TravelRecoveryInput, changed = false): FlightOffer {
  const f = travelFixture(), airport = findAirport(input.destinationAirportIata)!
  const flight: FlightOffer = {
    ...f.flight, departureDate: input.departureDate, destinationAirportIata: airport.iata,
    segments: [{ ...f.flight.segments[0], id: 'nonstop', boardingId: 'fixture-nonstop',
      originAirport: findAirport('SAN')!, destinationAirport: airport,
      departureAt: `${input.departureDate}T10:00:00-08:00`, arrivalAt: `${input.departureDate}T18:00:00-05:00`,
      durationMinutes: 300, carrier: 'Fixture Air', flightNumber: 'FIX100' }],
    costs: [{ label: 'Observed fixture fare', cents: changed ? 42000 : 25000, currency: 'USD', includedInOtherCharge: false }],
  }
  flight.id = flightOfferId(flight)
  flight.fingerprint = flightOfferFingerprint(flight)
  return flight
}
function groundQuotes(input: TravelRecoveryInput, flight: FlightOffer): TravelOnwardOffer[] {
  if (!input.onwardFlight || flight.fingerprint !== input.onwardFlight.flightFingerprint) return []
  const f = travelFixture(), airport = flight.segments.at(-1)!.destinationAirport
  const ready = new Date(Date.parse(flight.segments.at(-1)!.arrivalAt) + input.onwardFlight.arrivalProcessingMinutes * 60000).toISOString()
  const from = { name: 'Boston Logan International Airport (BOS)', latitude: airport.latitude, longitude: airport.longitude }
  const to = { name: 'Portland, ME city center', latitude: f.destination.latitude, longitude: f.destination.longitude }
  return (['rail', 'bus', 'drive'] as const).map((mode, index) => {
    const offer: TravelOnwardOffer = {
      id: 'pending', flightOfferId: flight.id, flightFingerprint: flight.fingerprint, arrivalAirportIata: airport.iata,
      destinationCityId: f.destination.id, airportReadyAt: ready, kind: mode === 'drive' ? 'drive' : 'transit',
      legs: [{ id: `onward-${mode}`, mode, from, to, startAt: ready,
        endAt: new Date(Date.parse(ready) + [195, 180, 120][index] * 60000).toISOString(),
        departureTimeZone: 'America/New_York', arrivalTimeZone: 'America/New_York',
        operator: mode === 'drive' ? null : 'Fixture Ground', service: `Fixture ${mode} to Portland`,
        vehicleId: `fixture-${mode}-vehicle`, assumptions: ['Deterministic airport-to-city fixture; no live service was checked.'] }],
      costs: [{ label: `Fixture ${mode} fare`, cents: [3500, 2800, 6000][index], currency: 'USD', includedInOtherCharge: false }],
      evidence: [{ ...f.flight.evidence[0], checkedAt: now, expiresAt: expiry, serviceDate: input.departureDate }],
      confirmations: mode === 'drive' ? ['Confirm vehicle, driver, rental fees and road conditions.'] : [],
    }
    offer.id = onwardOfferId(offer)
    return offer
  })
}
async function setup(page: Page, options: { emptyFlights?: boolean; emptyOnward?: boolean; changedFlight?: boolean } = {}) {
  const posts: TravelRecoveryInput[] = [], cityPosts: unknown[] = []
  await page.clock.setFixedTime(new Date(now))
  await page.route('**/functions/v1/recovery/city', async route => {
    const input = route.request().postDataJSON()
    cityPosts.push(input)
    const origin = findCity(input.request.originCityId)!, destination = findCity(input.request.destinationCityId)!
    await route.fulfill({ json: { version: 2,
      result: planCityRecovery(input.request, [], { origin, destination, now }),
      facts: { candidates: [], checkedAt: now, expiresAt: expiry, adapterRevision: 'public-city-v1' },
      ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
    } })
  })
  await page.route('**/functions/v1/recovery/travel', async route => {
    const input = route.request().postDataJSON() as TravelRecoveryInput
    posts.push(input)
    const f = travelFixture(), flight = flightQuote(input, options.changedFlight && !!input.selection)
    const flightOffers = options.emptyFlights ? [] : [flight]
    const onwardOffers = options.emptyOnward || !flightOffers.length || input.destinationAirportIata !== 'BOS' ? [] : groundQuotes(input, flight)
    const assessment = assessTravelSelection(input, { origin: f.origin, destination: f.destination, now,
      flightOffers, hotelOffers: [], onwardOffers })
    const response = TravelRecoveryResponseSchema.parse({ version: 3, request: travelRequestBinding(input),
      origin: f.origin, destination: f.destination, generatedAt: now, expiresAt: expiry,
      flightOffers, hotelOffers: [], onwardOffers, ...assessment,
      sourceStatuses: [{ source: 'flights', status: options.emptyFlights ? 'unavailable' : 'available',
        message: options.emptyFlights ? 'No observed flight inventory in this fixture.' : 'Deterministic flight inventory fixture.', checkedAt: now, expiresAt: expiry }],
      warnings: options.emptyOnward && input.onwardFlight ? ['No onward route was returned by the checked source.'] : ['Deterministic fixtures only; no live inventory requested.'],
      ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
    })
    await route.fulfill({ json: response })
  })
  return { posts, cityPosts }
}
async function start(page: Page, deadline?: string) {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'From city', exact: true }).fill('San Diego CA')
  await page.getByRole('option', { name: /^San Diego, CA/ }).click()
  await page.getByRole('combobox', { name: 'To city', exact: true }).fill('Portland ME')
  await page.getByRole('option', { name: /^Portland, ME/ }).click()
  if (deadline) {
    await page.getByLabel('By a date and time', { exact: true }).check()
    await page.getByLabel('Arrive by', { exact: true }).fill(deadline)
  }
  await page.getByRole('button', { name: 'Find my options', exact: true }).click()
  await expect(alternate(page).getByRole('heading', { name: 'SAN to BOS', exact: true })).toBeVisible()
}
async function discoverOnward(page: Page, panel = alternate(page)) {
  await panel.getByRole('button', { name: 'Plan this flight', exact: true }).click()
  const allowance = panel.getByRole('form', { name: 'Arrival allowance for onward search', exact: true })
  await allowance.getByLabel('Arrival processing allowance minutes', { exact: true }).fill('45')
  await allowance.getByRole('button', { name: 'Check onward options', exact: true }).click()
  return panel.getByRole('region', { name: 'Onward travel options', exact: true })
}
async function confirmFacts(panel: Locator) {
  for (const [label, value] of [['Origin transfer minutes', '30'], ['Airport processing allowance minutes', '120']]) {
    await panel.getByLabel(label, { exact: true }).fill(value)
    await panel.getByRole('button', { name: 'Confirm and continue', exact: true }).click()
  }
  await panel.getByRole('button', { name: 'Confirm facts and check journey', exact: true }).click()
}

test('discovers primary PWM and nearby BOS flights without enabling a standalone drive, then completes the airport-to-Portland train journey', async ({ page }) => {
  const { posts, cityPosts } = await setup(page)
  await start(page)
  await expect(page.getByRole('region', { name: 'Flight and overnight planning', exact: true }).getByRole('heading', { name: 'SAN to PWM', exact: true })).toBeVisible()
  expect(posts.map(p => p.destinationAirportIata).sort()).toEqual(['BOS', 'PWM'])
  expect(posts.every(p => p.trip.destinationCityId === 'geonames:4975802' && !p.trip.drivingAllowed)).toBe(true)
  expect(cityPosts).toHaveLength(1)
  expect(cityPosts[0]).toMatchObject({ request: { drivingAllowed: false } })
  await expect(page.getByRole('checkbox', { name: 'Allow driving', exact: true })).toHaveCount(0)
  const onward = await discoverOnward(page)
  await expect(onward).toContainText('Fixture rail to Portland')
  await expect(onward).toContainText('Fixture bus to Portland')
  await expect(onward).toContainText('Fixture drive to Portland')
  const query = posts.find(p => p.onwardFlight)!
  expect(query).toMatchObject({ destinationAirportIata: 'BOS', selection: null, onwardFlight: { arrivalProcessingMinutes: 45 } })
  await onward.getByRole('button', { name: 'Use this onward option', exact: true }).nth(0).click()
  await confirmFacts(alternate(page))
  const journey = alternate(page).getByRole('article', { name: 'Complete journey', exact: true })
  await expect(journey.getByText('Portland', { exact: true })).toBeVisible()
  await expect(journey).toContainText('2026-11-18 22:00 -05:00')
  await expect(journey).toContainText('Fixture rail to Portland')
  await expect(journey.getByRole('button', { name: 'Choose this journey', exact: true })).toBeEnabled()
  const selected = posts.at(-1)!
  expect(selected.selection?.onwardOfferId).toBeTruthy()
  expect(selected.onwardFlight).toEqual(query.onwardFlight)
  await journey.getByRole('button', { name: 'Choose this journey', exact: true }).click()
  await expect(journey.getByRole('button', { name: 'Chosen journey', exact: true })).toBeVisible()
})

test('on a phone, onward drive requires explicit vehicle and driver confirmation and starts after the real BOS arrival', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { posts } = await setup(page)
  await start(page)
  const onward = await discoverOnward(page), drive = onward.getByRole('button', { name: 'Use this onward option', exact: true }).nth(2)
  await expect(drive).toBeDisabled()
  await onward.getByRole('checkbox', { name: 'I have confirmed a vehicle and driver for this onward trip.', exact: true }).check()
  await expect(drive).toBeEnabled()
  await drive.click()
  await confirmFacts(alternate(page))
  const journey = alternate(page).getByRole('article', { name: 'Complete journey', exact: true })
  await expect(journey).toContainText('2026-11-18 18:45 -05:00')
  await expect(journey).toContainText('2026-11-18 20:45 -05:00')
  await expect(journey.getByRole('button', { name: 'Choose this journey', exact: true })).toBeEnabled()
  expect(posts.at(-1)?.selection?.onwardVehicleConfirmed).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('a changed BOS flight quote invalidates its previously selected onward route', async ({ page }) => {
  await setup(page, { changedFlight: true })
  await start(page)
  const onward = await discoverOnward(page)
  await onward.getByRole('button', { name: 'Use this onward option', exact: true }).first().click()
  await confirmFacts(alternate(page))
  await expect(alternate(page).getByText(/A selected quote changed/)).toBeVisible()
  await expect(alternate(page).getByRole('article', { name: 'Complete journey', exact: true })).toHaveCount(0)
  await expect(alternate(page).getByRole('button', { name: 'Use this onward option', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save on this device', exact: true })).toBeDisabled()
})

test('a flight arriving before the deadline cannot be chosen when onward travel reaches Portland too late', async ({ page }) => {
  const { posts } = await setup(page)
  await start(page, '2026-11-18T20:30')
  const onward = await discoverOnward(page)
  await onward.getByRole('button', { name: 'Use this onward option', exact: true }).first().click()
  await confirmFacts(alternate(page))
  const journey = alternate(page).getByRole('article', { name: 'Complete journey', exact: true })
  await expect(journey).toContainText('Complete journey arrives after the hard destination deadline.')
  await expect(journey.getByRole('button', { name: 'Choose this journey', exact: true })).toBeDisabled()
  expect(posts.at(-1)?.trip.deadlineAt).toBe('2026-11-18T20:30:00-05:00')
})

test('an empty onward source supplies no invented transit or drive itinerary', async ({ page }) => {
  await setup(page, { emptyOnward: true })
  await start(page)
  await discoverOnward(page)
  await expect(alternate(page)).toContainText('No onward route was returned by the checked source.')
  await expect(alternate(page).getByRole('button', { name: 'Use this onward option', exact: true })).toHaveCount(0)
  await expect(alternate(page).getByRole('article', { name: 'Complete journey', exact: true })).toHaveCount(0)
})

test('empty primary and alternate flight sources do not create sample flights or ground choices', async ({ page }) => {
  const { posts } = await setup(page, { emptyFlights: true })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'From city', exact: true }).fill('San Diego CA')
  await page.getByRole('option', { name: /^San Diego, CA/ }).click()
  await page.getByRole('combobox', { name: 'To city', exact: true }).fill('Portland ME')
  await page.getByRole('option', { name: /^Portland, ME/ }).click()
  await page.getByRole('button', { name: 'Find my options', exact: true }).click()
  await expect(alternate(page)).toContainText('No observed flight inventory in this fixture.')
  await expect(page.getByRole('button', { name: 'Plan this flight', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Use this onward option', exact: true })).toHaveCount(0)
  expect(posts.map(p => p.destinationAirportIata).sort()).toEqual(['BOS', 'PWM'])
})


test('explicitly choosing BOS as the arrival airport still requires actual onward travel to Portland', async ({ page }) => {
  const { posts } = await setup(page)
  await page.goto('/')
  await page.getByRole('combobox', { name: 'From city', exact: true }).fill('San Diego CA')
  await page.getByRole('option', { name: /^San Diego, CA/ }).click()
  await page.getByRole('combobox', { name: 'To city', exact: true }).fill('Portland ME')
  await page.getByRole('option', { name: /^Portland, ME/ }).click()
  await page.getByText('Change nearby airports', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Arrival airport', exact: true }).selectOption('BOS')
  await page.getByRole('button', { name: 'Find my options', exact: true }).click()
  const primary = page.getByRole('region', { name: 'Flight and overnight planning', exact: true })
  await expect(primary.getByRole('heading', { name: 'SAN to BOS', exact: true })).toBeVisible()
  const onward = await discoverOnward(page, primary)
  await expect(primary.getByRole('form', { name: 'Complete journey facts', exact: true })).toHaveCount(0)
  await expect(primary.getByLabel('Destination transfer minutes', { exact: true })).toHaveCount(0)
  await onward.getByRole('button', { name: 'Use this onward option', exact: true }).nth(1).click()
  await confirmFacts(primary)
  const journey = primary.getByRole('article', { name: 'Complete journey', exact: true })
  await expect(journey.getByText('Portland', { exact: true })).toBeVisible()
  await expect(journey).toContainText('Fixture bus to Portland')
  await expect(journey).toContainText('2026-11-18 18:45 -05:00')
  await expect(journey).toContainText('2026-11-18 21:45 -05:00')
  await expect(journey.getByRole('button', { name: 'Choose this journey', exact: true })).toBeEnabled()
  expect(posts.at(-1)).toMatchObject({ destinationAirportIata: 'BOS', trip: { destinationCityId: 'geonames:4975802', drivingAllowed: false }, onwardFlight: { arrivalProcessingMinutes: 45 } })
  expect(posts.at(-1)?.selection?.onwardOfferId).toBeTruthy()
})
