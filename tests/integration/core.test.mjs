import assert from 'node:assert/strict'
import { test } from 'node:test'
import { daytimeFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { RecoveryResponseSchema } from '../../supabase/functions/_shared/domain/api.ts'

// Refuse any non-loopback target before registering or executing network tests.
const endpoint = new URL(process.env.RECOVERY_API_URL ?? 'http://127.0.0.1:54321/functions/v1/recovery')
assert.equal(endpoint.protocol, 'http:', 'Integration tests require plain HTTP loopback')
assert.equal(endpoint.hostname, '127.0.0.1', 'Integration tests must never target hosted services')
assert.equal(endpoint.pathname, '/functions/v1/recovery')
assert.equal(endpoint.username + endpoint.password + endpoint.search + endpoint.hash, '')
const origin = 'http://127.0.0.1:5173'
const payload = () => ({ request: daytimeFixture().request, investigate: false })
const send = (body, headers = {}) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('REAL HTTP public recovery: no authorization, apikey, users or rows', async () => {
  const response = await send(payload())
  assert.equal(response.status, 200)
  const body = RecoveryResponseSchema.parse(await response.json())
  assert.ok(body.result.plans.length > 0)
  assert.equal(body.facts.candidates.length, 3)
  assert.ok(Date.parse(body.facts.expiresAt) <= Date.parse(body.facts.checkedAt) + 300_000)
  assert.equal(body.facts.arrivalEvidence[0].type, 'synthetic')
  console.info(`HTTP gate: POST 200; ${body.result.plans.length} plans; ${body.facts.candidates.length} normalized candidates; revision ${body.facts.adapterRevision}; no credentials`)
})

test('REAL HTTP wildcard origin and method contract: 204/200/405', async () => {
  for (const requestOrigin of [origin, 'https://arbitrary.example', 'null', null]) {
    const headers = requestOrigin === null ? {} : { origin: requestOrigin }
    const preflight = await fetch(endpoint, { method: 'OPTIONS', headers })
    const response = await send(payload(), headers)
    const wrong = await fetch(endpoint, { headers })
    assert.equal(preflight.status, 204)
    assert.equal(response.status, 200)
    assert.equal(wrong.status, 405)
    for (const result of [preflight, response, wrong]) {
      assert.equal(result.headers.get('access-control-allow-origin'), '*')
      assert.equal(result.headers.get('access-control-allow-credentials'), null)
    }
  }
  console.info('HTTP gate: any Origin or no Origin; OPTIONS 204; POST 200; GET 405; wildcard CORS without credentials')
})

test('REAL HTTP invalid JSON, strict fields and oversized body: 400/413', async () => {
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
  assert.equal((await send({ ...payload(), owner: 'not-accepted' })).status, 400)
  assert.equal((await send({ ...payload(), facts: {} })).status, 400)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65537) })).status, 413)
  // Async iterable body forces chunked HTTP and omits Content-Length.
  async function* chunks() { yield ' '.repeat(40_000); yield ' '.repeat(30_000) }
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chunks(), duplex: 'half' })).status, 413)
  console.info('HTTP gate: malformed/extra fields 400; declared and chunked oversized bodies 413')
})

test('REAL HTTP no-plan investigation remains useful and honestly disabled', async () => {
  const request = { ...payload().request, confirmedOptions: [] }
  const response = await send({ request, investigate: true })
  assert.equal(response.status, 200)
  const body = RecoveryResponseSchema.parse(await response.json())
  assert.deepEqual(body.facts.candidates, [])
  assert.match(body.result.warnings.join(' '), /unavailable/i)
  assert.match(body.result.warnings.join(' '), /No feasible/)
  console.info('HTTP gate: no-plan POST 200; provider/model unavailable; no fixtures added')
})

test('REAL HTTP manual real-mode facts cannot impersonate provider-live provenance', async () => {
  const request = payload().request
  request.mode = 'real'
  request.arrivalBasis = 'actual_gate'
  const convert = value => {
    if (Array.isArray(value)) return value.forEach(convert)
    if (value && typeof value === 'object') {
      if ('environment' in value && 'type' in value) {
        value.environment = 'production'; value.type = 'live'
        value.provider = 'Browser claimed provider API'
        value.sourceUrl = 'https://provider.example/public?token=must-disappear'
      }
      Object.values(value).forEach(convert)
    }
  }
  convert(request.confirmedOptions)
  const response = await send({ request, investigate: false }, { origin })
  assert.equal(response.status, 200)
  const body = RecoveryResponseSchema.parse(await response.json())
  assert.ok(body.result.plans.length > 0)
  assert.equal(body.facts.arrival.arrivalBasis, 'traveler_confirmed')
  assert.equal(body.facts.arrivalEvidence[0].type, 'traveler_confirmed')
  assert.equal(body.facts.candidates[0].evidence[0].type, 'estimated')
  assert.equal(body.facts.candidates[0].evidence[0].sourceUrl, null)
  assert.equal(body.facts.candidates[0].evidence[0].checkedAt, request.confirmedOptions[0].evidence[0].checkedAt)
  assert.ok(!JSON.stringify(body).includes('must-disappear'))
  console.info('HTTP gate: manual real-mode POST 200; browser provider claims downgraded; original timestamps preserved')
})

test('REAL HTTP refinement is separate, bounded, and honestly unavailable without model activation', async () => {
  const request = payload().request
  request.mode = 'real'
  request.confirmedOptions = []
  const response = await send({ request, investigate: false, refinement: 'No driving, please.' })
  assert.equal(response.status, 200)
  const body = RecoveryResponseSchema.parse(await response.json())
  assert.equal(body.assistance.status, 'unavailable')
  assert.deepEqual(body.assistance.appliedPreferences, {})
  assert.equal(body.result.request.drivingAllowed, true)
  assert.ok(!('refinement' in body.result.request))
  assert.equal((await send({ request, investigate: false, refinement: 'x'.repeat(501) })).status, 400)
  console.info('HTTP gate: disabled model keeps original preferences; bounded refinement never enters saved trip facts')
})

test('REAL HTTP fictional refinement never becomes live model assistance', async () => {
  const response = await send({ ...payload(), investigate: true, refinement: 'Cheapest please' })
  assert.equal(response.status, 200)
  const body = RecoveryResponseSchema.parse(await response.json())
  assert.equal(body.assistance.status, 'unavailable')
  assert.ok(body.result.plans.length > 0)
  assert.ok(!body.facts.hotelOffers?.length)
  console.info('HTTP gate: fictional comparison remains deterministic; no live hotel or model claim')
})
