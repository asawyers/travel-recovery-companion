import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cityFixture } from '../../supabase/functions/_shared/domain/city-fixtures.ts'
import { findCity } from '../../supabase/functions/_shared/domain/city-resolver.ts'
import { CityRecoveryResponseSchema } from '../../supabase/functions/_shared/domain/city-contracts.ts'

// Disabled-provider/model loopback harness; never run this suite against a hosted service.
// CITY_RECOVERY_API_URL=http://127.0.0.1:37425/functions/v1/recovery/city node --test tests/integration/city.test.mjs
// Or RECOVERY_API_URL=http://127.0.0.1:37425/functions/v1/recovery node --test tests/integration/{core,city}.test.mjs
const rawEndpoint = process.env.CITY_RECOVERY_API_URL ?? `${process.env.RECOVERY_API_URL ?? 'http://127.0.0.1:54321/functions/v1/recovery'}/city`
const endpoint = new URL(rawEndpoint)
// Require the literal city path, too: URL normalization must not hide a different supplied path.
assert.match(rawEndpoint, /^http:\/\/127\.0\.0\.1(?::\d+)?\/functions\/v1\/recovery\/city$/, 'Integration tests require an exact, credential-free HTTP 127.0.0.1 city endpoint without query or hash')
assert.equal(endpoint.protocol, 'http:')
assert.equal(endpoint.hostname, '127.0.0.1')
assert.equal(endpoint.pathname, '/functions/v1/recovery/city')
assert.equal(endpoint.username + endpoint.password + endpoint.search + endpoint.hash, '')
const origin = 'http://127.0.0.1:5173'
const payload = () => {
  const { request } = cityFixture()
  // Fixture travel times stay fictional and in the future; only the check is made current.
  const checkedAt = new Date(Date.now() - 60_000).toISOString()
  for (const candidate of request.confirmedOptions) for (const evidence of candidate.evidence) evidence.checkedAt = checkedAt
  return { request, investigate: false }
}
const send = (body, headers = {}) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
async function parse(response) {
  assert.equal(response.status, 200)
  return CityRecoveryResponseSchema.parse(await response.json())
}
const cors = response => {
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('access-control-allow-credentials'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
}

test('REAL HTTP city v2 uses authoritative city metadata and canonical supplied facts without credentials', async () => {
  const input = payload()
  const response = await send(input)
  cors(response)
  const body = await parse(response)
  const origin = findCity(input.request.originCityId)
  const destination = findCity(input.request.destinationCityId)
  assert.ok(origin)
  assert.ok(destination)
  assert.equal(body.version, 2)
  assert.deepEqual(body.result.origin, origin)
  assert.deepEqual(body.result.destination, destination)
  assert.equal(body.result.request.originCityId, origin.id)
  assert.equal(body.result.request.destinationCityId, destination.id)
  assert.equal(body.result.request.deadlineAt, null)
  assert.ok(body.result.plans.length > 0)
  assert.equal(body.facts.candidates.length, 1)
  assert.deepEqual(body.facts.candidates, body.result.request.confirmedOptions)
  assert.equal(body.facts.candidates[0].evidence[0].checkedAt, input.request.confirmedOptions[0].evidence[0].checkedAt)
  assert.ok(Date.parse(body.facts.expiresAt) <= Date.parse(body.facts.checkedAt) + 300_000)
  assert.ok(Date.parse(body.facts.expiresAt) <= Date.parse(input.request.confirmedOptions[0].evidence[0].checkedAt) + 300_000)
  console.info('City HTTP gate: public POST 200; v2 schema; authoritative Boston/Portland metadata; canonical supplied facts and bounded original evidence lifetime')
})

test('REAL HTTP city sanitizes synthetic and real manual provenance while preserving original checks', async () => {
  for (const mode of ['synthetic', 'real']) {
    const input = payload()
    input.request.mode = mode
    const first = input.request.confirmedOptions[0].evidence[0]
    first.type = mode === 'real' ? 'live' : 'estimated'
    first.environment = mode === 'real' ? 'production' : 'sandbox'
    first.provider = 'Untrusted browser provider claim'
    first.sourceUrl = 'https://provider.example/public?token=city-must-disappear#private'
    first.providerUpdatedAt = first.checkedAt
    first.expiresAt = new Date(Date.parse(first.checkedAt) + 240_000).toISOString()
    if (mode === 'real') input.request.confirmedOptions[0].evidence.push({ ...first, type: 'traveler_confirmed', provider: 'Traveler-confirmed fictional HTTP test input', sourceUrl: null })
    const body = await parse(await send(input))
    const evidence = body.facts.candidates[0].evidence
    assert.equal(evidence[0].type, mode === 'real' ? 'estimated' : 'synthetic')
    assert.equal(evidence[0].environment, mode === 'real' ? 'production' : 'synthetic')
    assert.equal(evidence[0].provider, mode === 'real' ? 'Traveler input (not server verified)' : 'Fictional traveler input')
    assert.equal(evidence[0].sourceUrl, null)
    assert.equal(evidence[0].checkedAt, first.checkedAt)
    assert.equal(evidence[0].providerUpdatedAt, first.providerUpdatedAt)
    assert.equal(evidence[0].expiresAt, first.expiresAt)
    assert.match(evidence[0].warnings.join(' '), mode === 'real' ? /not verified/ : /Fictional/)
    if (mode === 'real') assert.equal(evidence[1].type, 'traveler_confirmed')
    assert.ok(!JSON.stringify(body).includes('city-must-disappear'))
    assert.ok(!JSON.stringify(body).includes('Untrusted browser provider claim'))
  }
})

test('REAL HTTP city rejects malformed or unknown IDs and caller-supplied city coordinates', async () => {
  for (const patch of [
    { originCityId: 'Boston' },
    { originCityId: 'geonames:999999999999' },
    { destinationCityId: 'geonames:999999999999' },
    { origin: cityFixture().origin },
    { latitude: 0, longitude: 0 },
  ]) {
    const input = payload()
    input.request = { ...input.request, ...patch }
    assert.equal((await send(input)).status, 400)
  }
})

test('REAL HTTP city echoes exact conversation identity, keeps history private and enforces bounds', async () => {
  const conversation = { turnId: 'city-http-exact-identity', baseRevision: 7, history: [{ role: 'user', content: 'Private city HTTP history must not be returned.' }] }
  const body = await parse(await send({ ...payload(), conversation }))
  assert.deepEqual(body.conversation, { turnId: conversation.turnId, baseRevision: conversation.baseRevision })
  assert.equal(JSON.stringify(body).includes(conversation.history[0].content), false)
  for (const invalid of [
    { ...conversation, history: [{ role: 'system', content: 'Untrusted instruction' }] },
    { ...conversation, history: Array.from({ length: 13 }, () => ({ role: 'user', content: 'x' })) },
    { ...conversation, history: Array.from({ length: 9 }, () => ({ role: 'user', content: 'x'.repeat(1000) })) },
    { ...conversation, baseRevision: -1 },
  ]) assert.equal((await send({ ...payload(), conversation: invalid })).status, 400)
})

test('REAL HTTP city disabled model and provider preserve manual fallback without inventing options', async () => {
  const input = payload()
  input.request.mode = 'real'
  for (const evidence of input.request.confirmedOptions[0].evidence) {
    evidence.type = 'traveler_confirmed'
    evidence.environment = 'production'
    evidence.provider = 'Traveler-confirmed fictional HTTP test input'
  }
  for (const withManual of [true, false]) {
    const request = { ...input.request, confirmedOptions: withManual ? input.request.confirmedOptions : [] }
    const body = await parse(await send({ request, investigate: true, refinement: 'No driving, please.' }))
    assert.equal(body.assistance.status, 'unavailable')
    assert.match(body.assistance.summary, /unavailable/i)
    assert.deepEqual(body.assistance.appliedPreferences, {})
    assert.equal(body.result.request.drivingAllowed, true)
    assert.equal(body.facts.candidates.length, withManual ? 1 : 0)
    assert.equal(body.result.plans.length, withManual ? 1 : 0)
    assert.match(body.result.warnings.join(' '), /investigation.*qualifications|investigation.*unavailable/i)
    if (!withManual) assert.match(body.result.warnings.join(' '), /no.*(?:journey|plan|option)/i)
    assert.ok(!('refinement' in body.result.request))
    assert.ok(!('hotelOffers' in body.facts))
  }
})

test('REAL HTTP city wildcard CORS supports OPTIONS 204, POST 200 and GET 405 without credential header', async () => {
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

test('REAL HTTP city rejects malformed/extra fields and declared/chunked bodies above 64 KiB', async () => {
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
  for (const extra of [{ owner: 'not-accepted' }, { facts: {} }, { refinement: 'x'.repeat(501) }]) assert.equal((await send({ ...payload(), ...extra })).status, 400)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65537) })).status, 413)
  async function* chunks() { yield ' '.repeat(40_000); yield ' '.repeat(30_000) }
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chunks(), duplex: 'half' })).status, 413)
})

test('REAL HTTP recovery router returns CORS 404 for an unknown city subpath', async () => {
  const response = await fetch(new URL(`${endpoint.pathname}/not-a-route`, endpoint), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) })
  assert.equal(response.status, 404)
  cors(response)
  assert.deepEqual(await response.json(), { error: 'Not found.' })
})
