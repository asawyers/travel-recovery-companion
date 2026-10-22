import assert from 'node:assert/strict'
import { test } from 'node:test'
import { travelFixture } from '../../supabase/functions/_shared/domain/travel-fixtures.ts'
import { TravelRecoveryResponseSchema } from '../../supabase/functions/_shared/domain/travel-contracts.ts'
import { findCity } from '../../supabase/functions/_shared/domain/city-resolver.ts'
import { findAirport } from '../../supabase/functions/_shared/domain/airport-metadata.ts'

// Disabled-provider/model loopback harness; never run this suite against a hosted service.
// TRAVEL_RECOVERY_API_URL=http://127.0.0.1:37425/functions/v1/recovery/travel node --test tests/integration/travel.test.mjs
// Or RECOVERY_API_URL=http://127.0.0.1:37425/functions/v1/recovery node --test tests/integration/{core,city,travel}.test.mjs
const rawEndpoint = process.env.TRAVEL_RECOVERY_API_URL ?? `${process.env.RECOVERY_API_URL ?? 'http://127.0.0.1:54321/functions/v1/recovery'}/travel`
const endpoint = new URL(rawEndpoint)
assert.match(rawEndpoint, /^http:\/\/127\.0\.0\.1(?::\d+)?\/functions\/v1\/recovery\/travel$/, 'Integration tests require an exact, credential-free HTTP 127.0.0.1 travel endpoint without query or hash')
assert.equal(endpoint.protocol, 'http:')
assert.equal(endpoint.hostname, '127.0.0.1')
assert.equal(endpoint.pathname, '/functions/v1/recovery/travel')
assert.equal(endpoint.username + endpoint.password + endpoint.search + endpoint.hash, '')

const origin = 'http://127.0.0.1:5173'
const payload = () => {
  const { input } = travelFixture()
  input.selection = null
  return input
}
const send = (body, headers = {}) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
async function parse(response) {
  assert.equal(response.status, 200)
  return TravelRecoveryResponseSchema.parse(await response.json())
}
const cors = response => {
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('access-control-allow-credentials'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
}

test('REAL HTTP travel resolves canonical SAN/PWM metadata and ignores forged coordinates', async () => {
  const input = payload()
  const body = await parse(await send(input))
  const originCity = findCity(input.trip.originCityId), destinationCity = findCity(input.trip.destinationCityId)
  const originAirport = findAirport(input.originAirportIata), destinationAirport = findAirport(input.destinationAirportIata)
  assert.ok(originCity && destinationCity && originAirport && destinationAirport)
  assert.deepEqual(body.origin, originCity)
  assert.deepEqual(body.destination, destinationCity)
  assert.deepEqual(body.request, input)
  assert.equal(body.request.originAirportIata, originAirport.iata)
  assert.equal(body.request.destinationAirportIata, destinationAirport.iata)
})

test('REAL HTTP travel rejects forged city or airport coordinates and unknown IDs', async () => {
  const base = payload()
  for (const patch of [
    { origin: { latitude: 0, longitude: 0 } },
    { originAirport: { iata: 'SAN', latitude: 0, longitude: 0 } },
    { destinationAirport: { iata: 'PWM', latitude: 0, longitude: 0 } },
    { trip: { ...base.trip, originCityId: 'geonames:999999999999' } },
    { trip: { ...base.trip, destinationCityId: 'geonames:999999999999' } },
    { originAirportIata: 'ZZZ' },
    { destinationAirportIata: 'ZZZ' },
  ]) assert.equal((await send({ ...base, ...patch })).status, 400)
})

test('REAL HTTP travel returns no quotes or journey when investigation is disabled', async () => {
  const body = await parse(await send(payload()))
  assert.equal(body.flightOffers.length, 0)
  assert.equal(body.hotelOffers.length, 0)
  assert.equal(body.journey, null)
})

test('REAL HTTP travel with investigation and disabled providers reports unavailable without fixtures', async () => {
  const input = payload()
  input.investigate = true
  input.overnight = { checkin: '2026-11-18', checkout: '2026-11-19' }
  const body = await parse(await send(input))
  assert.equal(body.flightOffers.length, 0)
  assert.equal(body.hotelOffers.length, 0)
  assert.ok(body.sourceStatuses.every(status => status.status === 'unavailable'))
  assert.deepEqual(body.sourceStatuses.map(status => status.source).sort(), ['flights', 'hotels'])
  assert.equal(body.journey, null)
  assert.ok(!JSON.stringify(body).includes('Example San Diego Hotel'))
  assert.ok(!JSON.stringify(body).includes('American'))
})

test('REAL HTTP travel preserves exact conversation echo without returning private history', async () => {
  const conversation = { turnId: 'travel-http-exact-identity', baseRevision: 4, history: [{ role: 'user', content: 'Private travel HTTP history must not be returned.' }] }
  const body = await parse(await send({ ...payload(), conversation }))
  assert.deepEqual(body.conversation, { turnId: conversation.turnId, baseRevision: conversation.baseRevision })
  assert.equal(JSON.stringify(body).includes(conversation.history[0].content), false)
})

test('REAL HTTP travel selected offer IDs cannot inject trusted provider data', async () => {
  const input = payload()
  input.selection = {
    flightOfferId: 'attacker-flight-id',
    flightFingerprint: 'attacker-flight-fingerprint',
    hotelOfferId: null,
    hotelFingerprint: null,
    facts: {
      originTransfer: { minutes: 30, costCents: 2000 },
      airportProcessingMinutes: 120,
      arrivalProcessingMinutes: 30,
      destinationTransfer: { minutes: 20, costCents: 2000 },
      connections: [],
      flightExtrasCents: 0,
      stay: null,
      checkedAt: new Date().toISOString(),
    },
  }
  const body = await parse(await send(input))
  assert.equal(body.flightOffers.length, 0)
  assert.equal(body.hotelOffers.length, 0)
  assert.equal(body.journey, null)
  assert.equal(body.selectionIssue, 'flight_missing')
})

test('REAL HTTP travel rejects malformed, noncanonical, or oversized requests', async () => {
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
  for (const invalid of [
    { ...payload(), unexpected: true },
    { ...payload(), quote: { id: 'provider-shaped-quote' } },
    { ...payload(), selection: { offer: { id: 'raw provider quote shape' } } },
  ]) assert.equal((await send(invalid)).status, 400)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65537) })).status, 413)
  async function* chunks() { yield ' '.repeat(40_000); yield ' '.repeat(30_000) }
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chunks(), duplex: 'half' })).status, 413)
})

test('REAL HTTP travel wildcard CORS supports OPTIONS 204, POST 200 and GET 405', async () => {
  for (const requestOrigin of [origin, 'https://arbitrary.example', 'null', null]) {
    const headers = requestOrigin === null ? {} : { origin: requestOrigin }
    const preflight = await fetch(endpoint, { method: 'OPTIONS', headers })
    const post = await send(payload(), headers)
    const wrong = await fetch(endpoint, { headers })
    assert.equal(preflight.status, 204)
    assert.equal(await preflight.text(), '')
    assert.equal(post.status, 200)
    assert.equal(wrong.status, 405)
    assert.equal(wrong.headers.get('allow'), 'POST, OPTIONS')
    for (const response of [preflight, post, wrong]) cors(response)
  }
})
