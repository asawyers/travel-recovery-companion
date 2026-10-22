import assert from 'node:assert/strict'
import { test } from 'node:test'

// Negative cases intentionally omit the valid RECOVERY_ACCESS_TOKEN used by other suites.
const rawEndpoint = process.env.RECOVERY_API_URL ?? 'http://127.0.0.1:54321/functions/v1/recovery'
assert.match(rawEndpoint, /^http:\/\/127\.0\.0\.1(?::\d+)?\/functions\/v1\/recovery$/, 'Auth integration tests require the exact HTTP loopback recovery endpoint')
const endpoint = new URL(rawEndpoint)
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const forgedToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'forged-user', role: 'authenticated', exp: 4070908800 })}.invalid-signature`

for (const path of ['', '/city', '/travel']) {
  for (const authentication of ['missing', 'forged']) {
    test(`REAL HTTP ${path || '/'} rejects ${authentication} authentication before recovery input`, async () => {
      const response = await fetch(`${endpoint}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authentication === 'forged' ? { authorization: `Bearer ${forgedToken}` } : {}) },
        // Invalid JSON confirms auth happens before input parsing and provider/model work.
        body: '{',
      })
      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: 'Sign in to continue.' })
      assert.equal(response.headers.get('access-control-allow-origin'), '*')
      assert.equal(response.headers.get('cache-control'), 'no-store')
    })
  }
}

test('REAL HTTP preflight allows the bearer header without an authenticated session', async () => {
  const response = await fetch(endpoint, { method: 'OPTIONS', headers: {
    origin: 'http://127.0.0.1:5173',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type, authorization',
  } })
  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
  assert.match(response.headers.get('access-control-allow-headers'), /authorization/i)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})
