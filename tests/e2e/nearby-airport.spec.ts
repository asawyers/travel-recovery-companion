import { expect, type Locator, type Page, test } from './auth-fixture'
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
const walkingWarning = 'Includes 11 min walking; consider luggage and station access.'
const zoneWarning = 'Times are shown in local time zones.'
const walkingEstimate = 'Walking duration and its start/end times are estimated from provider step duration; confirm pedestrian access and transfer time.'
const zoneEstimate = 'Stop time zone is estimated from the nearest selected endpoint when the provider omits its stop time zone; timestamp instants are preserved.'
const routeWarning = 'Deterministic airport-to-city fixture; no live service was checked.'
const alternate = (page: Page) => page.getByRole('region', { name: 'Nearby airport flight and onward planning', exact: true })
function flightQuote(input: TravelRecoveryInput, changed = false, lateArrival = false): FlightOffer {
  const f = travelFixture(), airport = findAirport(input.destinationAirportIata)!
  const flight: FlightOffer = {
    ...f.flight, departureDate: input.departureDate, destinationAirportIata: airport.iata,
    segments: [{ ...f.flight.segments[0], id: 'nonstop', boardingId: 'fixture-nonstop',
      originAirport: findAirport('SAN')!, destinationAirport: airport,
      departureAt: `${input.departureDate}T${lateArrival ? '15' : '10'}:00:00-08:00`, arrivalAt: `${input.departureDate}T${lateArrival ? '23' : '18'}:00:00-05:00`,
      durationMinutes: 300, carrier: 'Fixture Air', flightNumber: 'FIX100' }],
    costs: [{ label: 'Observed fixture fare', cents: changed ? 42000 : 25000, currency: 'USD', includedInOtherCharge: false }],
  }
  flight.id = flightOfferId(flight)
  flight.fingerprint = flightOfferFingerprint(flight)
  return flight
}
function groundQuotes(input: TravelRecoveryInput, flight: FlightOffer, detailedTransfers = false): TravelOnwardOffer[] {
  if (!input.onwardFlight || flight.fingerprint !== input.onwardFlight.flightFingerprint) return []
  const f = travelFixture(), airport = flight.segments.at(-1)!.destinationAirport
  const ready = new Date(Date.parse(flight.segments.at(-1)!.arrivalAt) + input.onwardFlight.arrivalProcessingMinutes * 60000).toISOString()
  const from = { name: 'Boston Logan International Airport (BOS)', latitude: airport.latitude, longitude: airport.longitude }
  const to = { name: 'Portland, ME city center', latitude: f.destination.latitude, longitude: f.destination.longitude }
  return (['rail', 'bus', 'drive'] as const).map((mode, index) => {
    const at = (minutes: number) => new Date(Date.parse(ready) + minutes * 60000).toISOString()
    const duration = [195, 180, 120][index]
    const station = { ...from, name: `Airport ${mode} station` }
    const arrivalStation = { ...to, name: `Portland ${mode} station` }
    const commonLeg = { departureTimeZone: 'America/New_York', arrivalTimeZone: 'America/New_York',
      operator: null, service: null, vehicleId: null,
      assumptions: detailedTransfers ? [routeWarning, walkingWarning, zoneWarning, walkingEstimate, zoneEstimate, routeWarning] : [routeWarning] }
    const mainLeg = { ...commonLeg, id: `onward-${mode}`, mode, from: mode === 'drive' ? from : station,
      to: mode === 'drive' ? to : arrivalStation, startAt: mode === 'drive' ? ready : at(15),
      endAt: at(mode === 'drive' ? duration : duration - 4),
      operator: mode === 'drive' ? null : 'Fixture Ground', service: `Fixture ${mode} to Portland`,
      vehicleId: `fixture-${mode}-vehicle` }
    const legs: TravelOnwardOffer['legs'] = mode === 'drive' ? [mainLeg] : [
      { ...commonLeg, id: `walk-to-${mode}`, mode: 'walk', from, to: station,
        startAt: ready, endAt: at(7), service: `Walk to airport ${mode} station` },
      { ...commonLeg, id: `wait-for-${mode}`, mode: 'wait', from: station, to: station,
        startAt: at(7), endAt: at(15), service: `Wait for ${mode} boarding` },
      mainLeg,
      { ...commonLeg, id: `walk-from-${mode}`, mode: 'walk', from: arrivalStation, to,
        startAt: at(duration - 4), endAt: at(duration), service: `Walk from Portland ${mode} station` },
    ]
    if (detailedTransfers && mode !== 'drive') {
      const terminalDoor = { ...from, name: `Terminal ${mode} exit` }
      const corridor = { ...from, name: `Airport ${mode} covered corridor` }
      const concourse = { ...from, name: `Airport ${mode} concourse` }
      const sidewalk = { ...to, name: `Portland ${mode} station sidewalk` }
      const walk = (id: string, source: typeof from, destination: typeof from, begin: number, end: number, service: string): TravelOnwardOffer['legs'][number] =>
        ({ ...commonLeg, id, mode: 'walk', from: source, to: destination, startAt: at(begin), endAt: at(end), service })
      legs.splice(0, 1,
        walk(`walk-exit-${mode}`, from, terminalDoor, 0, 1, `Walk to airport ${mode} terminal exit`),
        walk(`walk-connector-${mode}`, terminalDoor, terminalDoor, 1, 1, `Airport ${mode} door connector`),
        walk(`walk-corridor-${mode}`, terminalDoor, corridor, 1, 3, `Follow airport ${mode} corridor`),
        walk(`walk-concourse-${mode}`, corridor, concourse, 3, 5, `Cross airport ${mode} concourse`),
        walk(`walk-to-${mode}`, concourse, station, 5, 7, `Walk to airport ${mode} station`),
      )
      legs.splice(legs.length - 1, 1,
        walk(`walk-sidewalk-${mode}`, arrivalStation, sidewalk, duration - 4, duration - 2, `Leave Portland ${mode} station`),
        walk(`walk-from-${mode}`, sidewalk, to, duration - 2, duration, `Walk from Portland ${mode} station`),
      )
    }
    const offer: TravelOnwardOffer = {
      id: 'pending', flightOfferId: flight.id, flightFingerprint: flight.fingerprint, arrivalAirportIata: airport.iata,
      destinationCityId: f.destination.id, airportReadyAt: ready, kind: mode === 'drive' ? 'drive' : 'transit',
      legs,
      costs: [{ label: `Fixture ${mode} fare`, cents: [3500, 2800, 6000][index], currency: 'USD', includedInOtherCharge: false }],
      evidence: [{ ...f.flight.evidence[0], checkedAt: now, expiresAt: expiry, serviceDate: input.departureDate }],
      confirmations: mode === 'drive' ? ['Confirm vehicle, driver, rental fees and road conditions.'] : [],
    }
    offer.id = onwardOfferId(offer)
    return offer
  })
}
async function setup(page: Page, options: { emptyFlights?: boolean; emptyOnward?: boolean; changedFlight?: boolean; detailedTransfers?: boolean } = {}) {
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
    const f = travelFixture(), flight = flightQuote(input, options.changedFlight && !!input.onwardFlight, options.detailedTransfers)
    const flightOffers = options.emptyFlights ? [] : [flight]
    const onwardOffers = options.emptyOnward || !flightOffers.length || input.destinationAirportIata !== 'BOS' ? [] : groundQuotes(input, flight, options.detailedTransfers)
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
  await expect(journey.getByText('Final city arrival', { exact: true }).locator('..').getByText('Portland', { exact: true })).toBeVisible()
  await expect(journey.locator('time[datetime="2026-11-19T03:00:00.000Z"]:visible').first()).toContainText('10:00 PM')
  await expect(journey).toContainText('Fixture rail to Portland')
  await expect(journey.getByRole('button', { name: 'Choose this journey', exact: true })).toBeEnabled()
  expect(posts).toHaveLength(3) // Confirmation uses the accepted onward route locally.
  expect(posts.at(-1)?.onwardFlight).toEqual(query.onwardFlight)
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
  await expect(onward.getByRole('checkbox', { name: 'I have confirmed a vehicle and driver for this onward trip.', exact: true })).toBeChecked()
  await drive.click()
  await confirmFacts(alternate(page))
  const journey = alternate(page).getByRole('article', { name: 'Complete journey', exact: true })
  await expect(journey.locator('time[datetime="2026-11-18T23:45:00.000Z"]').first()).toContainText('6:45 PM')
  await expect(journey.locator('time[datetime="2026-11-19T01:45:00.000Z"]:visible').first()).toContainText('8:45 PM')
  await expect(journey.getByRole('button', { name: 'Choose this journey', exact: true })).toBeEnabled()
  expect(posts).toHaveLength(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('a changed BOS flight quote cannot create onward routes bound to the old flight', async ({ page }) => {
  const { posts } = await setup(page, { changedFlight: true })
  await start(page)
  await discoverOnward(page)
  await expect(alternate(page).getByRole('article', { name: 'Complete journey', exact: true })).toHaveCount(0)
  await expect(alternate(page).getByRole('button', { name: 'Use this onward option', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save on this device', exact: true })).toBeDisabled()
  expect(posts.at(-1)?.onwardFlight?.flightFingerprint).not.toBe(flightQuote(posts.at(-1)!, true).fingerprint)
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
  await expect(journey.getByText('Final city arrival', { exact: true }).locator('..').getByText('Portland', { exact: true })).toBeVisible()
  await expect(journey).toContainText('Fixture bus to Portland')
  await expect(journey.locator('time[datetime="2026-11-18T23:45:00.000Z"]').first()).toContainText('6:45 PM')
  await expect(journey.locator('time[datetime="2026-11-19T02:45:00.000Z"]:visible').first()).toContainText('9:45 PM')
  await expect(journey.getByRole('button', { name: 'Choose this journey', exact: true })).toBeEnabled()
  expect(posts.at(-1)).toMatchObject({ destinationAirportIata: 'BOS', trip: { destinationCityId: 'geonames:4975802', drivingAllowed: false }, onwardFlight: { arrivalProcessingMinutes: 45 } })
  expect(posts.at(-1)?.selection).toBeNull() // No re-fetch during local composition.
})


test('on a phone, rail and bus show the main ride while transfer details stay collapsed through journey selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { posts } = await setup(page)
  await start(page)
  const onward = await discoverOnward(page)
  const quotes = onward.getByRole('article')
  for (const [index, mode, _arrival, fare] of [[0, 'rail', '22:00', '35.00'], [1, 'bus', '21:45', '28.00']] as const) {
    const quote = quotes.nth(index)
    await expect(quote.getByText(new RegExp(`Fixture Ground Fixture ${mode} to Portland`)).first()).toBeVisible()
    await expect(quote.getByText('Includes 11 min walking; consider luggage and station access.', { exact: true })).toBeVisible()
    await expect(quote.getByText(new RegExp(`Walk to airport ${mode} station`))).toBeHidden()
    await expect(quote.getByText(new RegExp(`Wait for ${mode} boarding`))).toBeHidden()
    await expect(quote.getByText(new RegExp(`Walk from Portland ${mode} station`))).toBeHidden()
    const finalAt = index === 0 ? '2026-11-19T03:00:00.000Z' : '2026-11-19T02:45:00.000Z'
    await expect(quote.locator(`time[datetime="${finalAt}"]:visible`).first()).toContainText(index === 0 ? '10:00 PM' : '9:45 PM')
    await expect(quote.locator('.companion-price').filter({ hasText: `$${fare}` }).first()).toBeVisible()
    await quote.getByText('Cost breakdown', { exact: true }).click()
    await expect(quote.getByText(`Fixture ${mode} fare: $${fare} USD`, { exact: true })).toBeVisible()
  }
  const rail = quotes.first()
  await rail.screenshot({ path: test.info().outputPath('rail-onward-collapsed.png') })
  await rail.getByText('Transfer details', { exact: true }).click()
  await rail.getByText('Walking and waiting details (2)', { exact: true }).click()
  await expect(rail.getByText(/Walk to airport rail station/)).toBeVisible()
  await expect(rail.getByText(/Wait for rail boarding/)).toBeVisible()
  await expect(rail.getByText(/Walk from Portland rail station/)).toBeVisible()
  await rail.getByText('Transfer details', { exact: true }).click()
  await rail.getByRole('button', { name: 'Use this onward option', exact: true }).click()
  await confirmFacts(alternate(page))
  const journey = alternate(page).getByRole('article', { name: 'Complete journey', exact: true })
  await expect(journey.getByText(/Fixture Ground Fixture rail to Portland/).first()).toBeVisible()
  await expect(journey.getByText('Includes 11 min walking; consider luggage and station access.', { exact: true })).toBeVisible()
  await expect(journey.getByText(/Walk to airport rail station/)).toBeHidden()
  await expect(journey.getByText(/Wait for rail boarding/)).toBeHidden()
  await expect(journey.getByText(/Walk from Portland rail station/)).toBeHidden()
  await expect(journey.locator('time[datetime="2026-11-19T03:00:00.000Z"]:visible').first()).toContainText('10:00 PM')
  await expect(journey.getByText('$285.00', { exact: true })).toBeVisible()
  const selected = posts.at(-1)!, selectedOffer = groundQuotes(selected, flightQuote(selected))[0]
  expect(selected.selection).toBeNull() // Local composition preserves the accepted onward facts.
  expect(selectedOffer.airportReadyAt).toBe('2026-11-18T23:45:00.000Z')
  expect(selectedOffer.legs.at(-1)?.endAt).toBe('2026-11-19T03:00:00.000Z')
  expect(selectedOffer.costs[0].cents).toBe(3500)
  await journey.screenshot({ path: test.info().outputPath('complete-journey-collapsed.png') })
  await journey.getByText('Transfer details', { exact: true }).click()
  await journey.getByText('Walking and waiting details (2)', { exact: true }).click()
  await expect(journey.getByText(/Walk to airport rail station/)).toBeVisible()
  await expect(journey.getByText(/Wait for rail boarding/)).toBeVisible()
  await expect(journey.getByText(/Walk from Portland rail station/)).toBeVisible()
  await journey.getByRole('button', { name: 'Choose this journey', exact: true }).click()
  await expect(journey.getByRole('button', { name: 'Chosen journey', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('on phones, grouped transfers preserve overnight times, costs and warnings through journey selection', async ({ page }) => {
  test.setTimeout(60000)
  const { posts } = await setup(page, { detailedTransfers: true })
  const disclosure = (card: Locator, title: string) => card.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${title}$`) }) }).first()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await start(page)
    const onward = await discoverOnward(page)
    const quotes = onward.getByRole('article')
    for (const [index, mode, arrival, fare] of [[0, 'rail', '3:00 AM', '35.00'], [1, 'bus', '2:45 AM', '28.00']] as const) {
      const quote = quotes.nth(index)
      await expect(quote.getByText(new RegExp(`Fixture Ground Fixture ${mode} to Portland`)).first()).toBeVisible()
      await expect(quote.getByText(walkingWarning, { exact: true })).toHaveCount(1)
      await expect(quote.getByText(routeWarning, { exact: true })).toHaveCount(1)
      await expect(disclosure(quote, 'Route notes')).not.toHaveAttribute('open')
      await expect(quote.getByText('Stop time zones are estimated from the nearest route endpoint when the provider omits them; original timestamp instants are preserved.', { exact: true })).toHaveCount(1)
      await expect(quote.getByText(zoneWarning, { exact: true })).toHaveCount(0)
      await expect(quote.getByText(/Local times.*EST.*UTC-05:00/)).toBeVisible()
      await expect(disclosure(quote, 'Transfer details')).not.toHaveAttribute('open')
      await expect(disclosure(quote, 'Onward source and freshness')).not.toHaveAttribute('open')
      await expect(disclosure(quote, 'Cost breakdown')).not.toHaveAttribute('open')
      await expect(quote.getByText(new RegExp(`Walk to airport ${mode} station`))).toBeHidden()
      await expect(quote.getByText(new RegExp(`Wait for ${mode} boarding`))).toBeHidden()
      await expect(quote.getByText(new RegExp(`Walk from Portland ${mode} station`))).toBeHidden()
      await expect(quote.getByText('Final city arrival', { exact: true })).toBeVisible()
      const boarding = quote.locator('time[datetime="2026-11-19T05:00:00.000Z"]:visible').first()
      await expect(boarding).toContainText('12:00 AM')
      await expect(boarding).toContainText('Thu, Nov 19, 2026')
      const finalAt = index === 0 ? '2026-11-19T08:00:00.000Z' : '2026-11-19T07:45:00.000Z'
      const finalTime = quote.locator(`time[datetime="${finalAt}"]:visible`).first()
      await expect(finalTime).toContainText(arrival)
      await expect(finalTime).toContainText('Thu, Nov 19, 2026')
      expect(await finalTime.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(24)
      await expect(quote.getByText('Total travel time', { exact: true })).toBeVisible()
      await expect(quote.getByText(index === 0 ? '3 hr 15 min' : '3 hr', { exact: true }).first()).toBeVisible()
      await expect(quote.getByText('Onward fare', { exact: true })).toBeVisible()
      const price = quote.locator('.companion-price').filter({ hasText: `$${fare}` }).first()
      await expect(price).toBeVisible()
      expect(await price.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(28)
      await expect(quote.locator('svg[aria-hidden="true"]').first()).toBeVisible()
    }
    const rail = quotes.first()
    await rail.screenshot({ path: test.info().outputPath(`rail-onward-collapsed-${width}.png`) })
    await rail.getByText('Transfer details', { exact: true }).click()
    const railTransfers = disclosure(rail, 'Transfer details')
    await expect(railTransfers.getByRole('listitem', { name: /^Route step / })).toHaveCount(3)
    await expect(railTransfers.getByText('Walk & wait', { exact: true })).toBeVisible()
    await expect(railTransfers.getByText('Walk', { exact: true })).toBeVisible()
    await expect(rail.getByText(/Airport rail door connector/)).toBeHidden()
    await expect(rail.getByText(walkingWarning, { exact: true })).toHaveCount(1)
    await expect(rail.getByText(routeWarning, { exact: true })).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await rail.screenshot({ path: test.info().outputPath(`rail-onward-expanded-${width}.png`) })
    await railTransfers.getByText('Walking and waiting details (6)', { exact: true }).click()
    await expect(railTransfers.getByText(/Airport rail door connector/)).toBeVisible()
    await expect(railTransfers.locator('time[datetime="2026-11-19T04:46:00.000Z"]:visible').first()).toContainText('11:46 PM')
    await railTransfers.getByText('Walking and waiting details (6)', { exact: true }).click()
    const railCost = disclosure(rail, 'Cost breakdown')
    await railCost.locator('summary').click()
    await expect(railCost.getByText('Fixture rail fare: $35.00 USD', { exact: true })).toBeVisible()
    await rail.getByText('Transfer details', { exact: true }).click()
    await rail.getByRole('button', { name: 'Use this onward option', exact: true }).click()
    await confirmFacts(alternate(page))
    const journey = alternate(page).getByRole('article', { name: 'Complete journey', exact: true })
    await expect(journey.getByText(/Fixture Ground Fixture rail to Portland/).first()).toBeVisible()
    await expect(journey.getByText(walkingWarning, { exact: true })).toHaveCount(1)
    await expect(journey.getByText(routeWarning, { exact: true })).toHaveCount(1)
    await expect(journey.getByText(zoneWarning, { exact: true })).toHaveCount(0)
    await expect(disclosure(journey, 'Source and freshness')).not.toHaveAttribute('open')
    await expect(disclosure(journey, 'Transfer details')).not.toHaveAttribute('open')
    await expect(journey.getByText(/Walk to airport rail station/)).toBeHidden()
    await expect(journey.getByText(/Wait for rail boarding/)).toBeHidden()
    await expect(journey.getByText(/Walk from Portland rail station/)).toBeHidden()
    const finalArrival = journey.locator('time[datetime="2026-11-19T08:00:00.000Z"]:visible').first()
    await expect(finalArrival).toContainText('3:00 AM')
    await expect(finalArrival).toContainText('Thu, Nov 19, 2026')
    await expect(journey.getByText('Known costs', { exact: true })).toBeVisible()
    await expect(journey.getByText('$285.00', { exact: true })).toBeVisible()
    const selected = posts.at(-1)!, selectedOffer = groundQuotes(selected, flightQuote(selected, false, true), true)[0]
    expect(selected.selection).toBeNull() // Local composition preserves the accepted onward facts.
    expect(selectedOffer.airportReadyAt).toBe('2026-11-19T04:45:00.000Z')
    expect(selectedOffer.legs.at(-1)?.endAt).toBe('2026-11-19T08:00:00.000Z')
    expect(selectedOffer.legs).toHaveLength(9)
    expect(selectedOffer.legs[1].startAt).toBe(selectedOffer.legs[1].endAt)
    expect(selectedOffer.costs[0].cents).toBe(3500)
    await journey.screenshot({ path: test.info().outputPath(`complete-journey-collapsed-${width}.png`) })
    await journey.getByText('Transfer details', { exact: true }).click()
    const journeyTransfers = disclosure(journey, 'Transfer details')
    await expect(journeyTransfers.getByText('Walk & wait', { exact: true })).toBeVisible()
    await expect(journeyTransfers.getByText('Walk', { exact: true })).toBeVisible()
    await journeyTransfers.getByText('Walking and waiting details (6)', { exact: true }).click()
    await expect(journeyTransfers.getByText(/Airport rail door connector/)).toBeVisible()
    await expect(journeyTransfers.locator('time[datetime="2026-11-19T04:46:00.000Z"]:visible').first()).toContainText('11:46 PM')
    await journeyTransfers.getByText('Walking and waiting details (6)', { exact: true }).click()
    await expect(journey.getByText(walkingWarning, { exact: true })).toHaveCount(1)
    await expect(journey.getByText(routeWarning, { exact: true })).toHaveCount(1)
    const journeyCost = disclosure(journey, 'Cost breakdown')
    await journeyCost.locator('summary').click()
    await expect(journeyCost.getByText('Observed fixture fare: $250.00 USD', { exact: true })).toBeVisible()
    await expect(journeyCost.getByText('Fixture rail fare: $35.00 USD', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await journey.screenshot({ path: test.info().outputPath(`complete-journey-expanded-${width}.png`) })
    await journey.getByRole('button', { name: 'Choose this journey', exact: true }).click()
    await expect(journey.getByRole('button', { name: 'Chosen journey', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 3200 })
  const desktopJourney = alternate(page).getByRole('article', { name: 'Complete journey', exact: true })
  await desktopJourney.evaluate(node => {
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) ancestor.scrollTop = 0
    window.scrollTo(0, 0)
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await desktopJourney.screenshot({ path: test.info().outputPath('complete-journey-expanded-desktop.png') })
  await disclosure(desktopJourney, 'Transfer details').locator('summary').first().click()
  await disclosure(desktopJourney, 'Cost breakdown').locator('summary').click()
  await desktopJourney.screenshot({ path: test.info().outputPath('complete-journey-collapsed-desktop.png') })
})
