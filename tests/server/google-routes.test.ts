import { describe, expect, it, vi } from 'vitest'
import { createGoogleRoutesAdapter } from '../../supabase/functions/_shared/server/google-routes.ts'
import { daytimeFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { ConfirmedOptionSchema } from '../../supabase/functions/_shared/domain/schemas.ts'
import { planRecovery } from '../../supabase/functions/_shared/domain/planner.ts'

const NOW = '2026-11-18T12:55:00Z'
const signal = () => new AbortController().signal
const point = (latitude: number, longitude: number) => ({ latLng: { latitude, longitude } })
const BOS = point(42.365, -71.01)
const NORTH = point(42.3663, -71.0622)
const PORTLAND = point(43.653, -70.291)
function request() {
  return { ...daytimeFixture().request, mode: 'real' as const, confirmedOptions: [], arrivalAt: '2026-11-18T13:00:00Z', deadlineAt: '2026-11-18T20:00:00Z' }
}
function transit(kind: 'bus' | 'train' = 'bus') {
  return { routes: [{ duration: '9360s', warnings: ['Service times may change.'], travelAdvisory: { transitFare: { currencyCode: 'USD', units: '35', nanos: 500_000_000 } }, legs: [{
    startLocation: kind === 'bus' ? BOS : NORTH, endLocation: PORTLAND,
    steps: [
      { travelMode: 'WALK', staticDuration: '180s' },
      { travelMode: 'TRANSIT', staticDuration: '9000s', transitDetails: {
        stopDetails: { departureStop: { name: kind === 'bus' ? 'Logan Airport Terminal A' : 'North Station', location: kind === 'bus' ? BOS : NORTH }, departureTime: '2026-11-18T15:00:00Z', arrivalStop: { name: 'Portland Transportation Center', location: PORTLAND }, arrivalTime: '2026-11-18T17:30:00Z' },
        transitLine: { name: kind === 'bus' ? 'Concord Coach Lines' : 'Downeaster', agencies: [{ name: kind === 'bus' ? 'Concord Coach Lines' : 'Amtrak' }], vehicle: { type: kind === 'bus' ? 'BUS' : 'HEAVY_RAIL' } }, tripShortText: 'Fixture 123',
      } },
      { travelMode: 'WALK', staticDuration: '180s' },
    ],
  }] }] }
}
const drive = () => ({ routes: [{ duration: '1200s', legs: [{ startLocation: BOS, endLocation: NORTH }] }] })
function fetcher(replies: unknown[] = [transit(), drive(), transit('train')]) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(replies.shift() ?? {}), { headers: { 'Content-Type': 'application/json' } }))
}
const adapter = (fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) => createGoogleRoutesAdapter({ enabled: true, apiKey: 'fixture-key', now: () => NOW, fetcher: fetch, ...extra })

// All provider responses here are invented test fixtures; no paid service is called.
describe('Google Routes server adapter', () => {
  it('normalizes direct bus and North Station rail with at most three fixed POST requests', async () => {
    const fetch = fetcher()
    const result = await adapter(fetch)(request(), { signal: signal() })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('expected facts')
    expect(result.data.candidates).toHaveLength(2)
    const [bus, train] = result.data.candidates
    expect(bus.kind).toBe('bus'); expect(train.kind).toBe('train')
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
      expect(init?.method).toBe('POST')
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Goog-Api-Key')).toBe('fixture-key')
      expect(headers.get('X-Goog-FieldMask')).not.toContain('*')
      expect(headers.get('X-Goog-FieldMask')).not.toMatch(/polyline|\.uri/)
    }
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies[0].origin.address).toMatch(/Logan/)
    expect(bodies[0].destination.address).toBe('Portland, ME')
    expect(bodies[0].travelMode).toBe('TRANSIT')
    expect(bodies[1].destination.address).toMatch(/135 Causeway/)
    expect(bodies[1].travelMode).toBe('DRIVE')
    expect(bodies[2].origin.address).toMatch(/135 Causeway/)
    expect(bodies[2].departureTime).toBe('2026-11-18T14:20:00Z')
    expect(bodies.every(body => body.arrivalTime === undefined && body.intermediates === undefined)).toBe(true)
    for (const candidate of result.data.candidates) expect(ConfirmedOptionSchema.safeParse(candidate).success).toBe(true)
    if (bus.kind !== 'bus' || train.kind !== 'train') throw new Error('expected transit')
    expect(bus.fareCents).toBe(3550)
    expect(bus.access).toMatchObject({ from: 'BOS terminal exit', kind: 'walk', minutes: 3, costCents: 0 })
    expect(train.access).toMatchObject({ from: 'BOS terminal exit', kind: 'transfer', minutes: 23, costCents: null })
    expect(bus.boardingMinutes).toBe(10); expect(train.boardingMinutes).toBe(15)
    expect(bus.finalTransfer.to).toBe('Portland, ME')
    expect(bus.evidence[0]).toMatchObject({ type: 'schedule', provider: 'Google Maps Routes API', environment: 'production', checkedAt: NOW, providerUpdatedAt: null, expiresAt: '2026-11-18T13:00:00.000Z' })
    expect(bus.access.evidence[0].type).toBe('estimated')
    expect(JSON.stringify(result)).not.toContain('fixture-key')
    expect(result.warnings.join(' ')).toMatch(/terminal/i)
    expect(JSON.stringify(result)).toMatch(/boarding/i)
    expect(planRecovery(request(), result.data.candidates, { now: NOW }).plans).toHaveLength(2)
  })

  it.each([{ enabled: false }, { apiKey: undefined }, { apiKey: ' ' }])('makes no call when disabled or unconfigured: %j', async extra => {
    const fetch = fetcher()
    expect((await adapter(fetch, extra)(request(), { signal: signal() })).status).toBe('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('makes no provider calls for synthetic requests', async () => {
    const fetch = fetcher()
    expect((await adapter(fetch)(daytimeFixture().request, { signal: signal() })).status).toBe('unavailable')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined], ['non-USD', { currencyCode: 'EUR', units: '35' }],
    ['fractional cent', { currencyCode: 'USD', units: '35', nanos: 1 }],
    ['negative', { currencyCode: 'USD', units: '-1', nanos: 0 }],
    ['unsafe units', { currencyCode: 'USD', units: '99999999999999999', nanos: 0 }],
  ])('keeps unsupported %s fares unknown', async (_name, fare) => {
    const bus = transit(); bus.routes[0].travelAdvisory.transitFare = fare as never
    const result = await adapter(fetcher([bus, {}, {}]))(request(), { signal: signal() })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.data.candidates[0]).toMatchObject({ fareCents: null })
  })

  it.each(['multiple vehicles', 'missing walking duration', 'wrong geography', 'reversed chronology', 'unknown operator', 'wrong vehicle', 'missing stop name', 'impossible duration'])('omits unsupported %s rather than inventing a usable route', async scenario => {
    const bus = transit(); const steps = bus.routes[0].legs[0].steps
    const detail = steps[1].transitDetails!
    if (scenario === 'multiple vehicles') steps.push(structuredClone(steps[1]))
    if (scenario === 'missing walking duration') delete (steps[0] as { staticDuration?: string }).staticDuration
    if (scenario === 'wrong geography') detail.stopDetails.arrivalStop.location = point(45.52, -122.67)
    if (scenario === 'reversed chronology') detail.stopDetails.arrivalTime = '2026-11-18T14:00:00Z'
    if (scenario === 'unknown operator') { detail.transitLine.name = 'Another service'; detail.transitLine.agencies = [{ name: 'Other' }] }
    if (scenario === 'wrong vehicle') detail.transitLine.vehicle.type = 'SUBWAY'
    if (scenario === 'missing stop name') detail.stopDetails.arrivalStop.name = ''
    if (scenario === 'impossible duration') bus.routes[0].duration = '30s'
    const result = await adapter(fetcher([bus, {}, {}]))(request(), { signal: signal() })
    expect(result.status).not.toBe('ok')
    expect(JSON.stringify(result)).toMatch(/route|coverage|unsupported/i)
  })

  it('rejects missing final walking from Portland Transportation Center to downtown', async () => {
    const bus = transit()
    bus.routes[0].legs[0].steps.pop()
    bus.routes[0].legs[0].endLocation = point(43.657, -70.25)
    const fetch = fetcher([bus, {}])
    const result = await adapter(fetch)(request(), { signal: signal() })
    expect(result.status).toBe('unavailable')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['absent', 'zero-duration'])('rejects %s airport walking when the boarding stop is far from the route origin', async walking => {
    const bus = transit()
    if (walking === 'absent') bus.routes[0].legs[0].steps.shift()
    else bus.routes[0].legs[0].steps[0].staticDuration = '0s'
    bus.routes[0].legs[0].steps.find(item => item.transitDetails)!.transitDetails!.stopDetails.departureStop.location = point(42.38, -71.01)
    const result = await adapter(fetcher([bus, {}]))(request(), { signal: signal() })
    expect(result.status).toBe('unavailable')
  })

  it('rejects absent North Station walking when rail origin and departure stop do not connect', async () => {
    const train = transit('train')
    train.routes[0].legs[0].steps.shift()
    train.routes[0].legs[0].steps[0].transitDetails!.stopDetails.departureStop.location = point(42.371, -71.0622)
    const fetch = fetcher([{}, drive(), train])
    expect((await adapter(fetch)(request(), { signal: signal() })).status).toBe('unavailable')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('rejects a North Station drive endpoint disconnected from the onward rail origin', async () => {
    const access = drive()
    access.routes[0].legs[0].endLocation = point(42.371, -71.0622)
    const fetch = fetcher([{}, access, transit('train')])
    expect((await adapter(fetch)(request(), { signal: signal() })).status).toBe('unavailable')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('permits zero walking only for co-located route endpoints and transit stops', async () => {
    const bus = transit()
    bus.routes[0].legs[0].steps = [bus.routes[0].legs[0].steps[1]]
    const result = await adapter(fetcher([bus, {}]))(request(), { signal: signal() })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.data.candidates[0]).toMatchObject({ access: { minutes: 0 }, finalTransfer: { minutes: 0 } })
  })

  it('skips North Station investigation when DRIVE timing would be in the past', async () => {
    const fetch = fetcher([{}])
    await adapter(fetch, { now: () => '2026-11-18T15:00:00Z' })(request(), { signal: signal() })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).travelMode).toBe('TRANSIT')
  })

  it('does not call Google beyond documented transit date coverage', async () => {
    const fetch = fetcher()
    const result = await adapter(fetch, { now: () => '2026-01-01T00:00:00Z' })(request(), { signal: signal() })
    expect(result.status).toBe('unavailable'); expect(fetch).not.toHaveBeenCalled()
  })

  it('retains an independent bus when optional rail access fails without retrying', async () => {
    const fetch = fetcher([transit()])
    fetch.mockImplementationOnce(async () => new Response(JSON.stringify(transit())))
    fetch.mockImplementationOnce(async () => new Response('SECRET upstream payload', { status: 429 }))
    const result = await adapter(fetch)(request(), { signal: signal() })
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.data.candidates).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(JSON.stringify(result)).toMatch(/unavailable|rate|limit/i)
  })

  it.each([400, 403, 500])('reports upstream HTTP %s without exposing the response or mislabeling it malformed', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('SECRET upstream payload', { status }))
    const result = await adapter(fetch)(request(), { signal: signal() })
    expect(result.status).toBe('unavailable')
    const diagnostic = JSON.stringify(result)
    expect(diagnostic).toContain(`HTTP ${status}`)
    expect(diagnostic).not.toMatch(/SECRET|fixture-key|malformed/)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('propagates only the fixed upstream validation diagnostic', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ error: { status: 'INVALID_ARGUMENT', message: 'SECRET departure_time must not be set with TRAFFIC_UNAWARE' } }, { status: 400 }))
    const result = await adapter(fetch)(request(), { signal: signal() })
    expect(JSON.stringify(result)).toContain('HTTP 400; departure_time_with_traffic_unaware')
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('identifies a malformed bus response shape without exposing provider content', async () => {
    const fetch = fetcher([{ routes: Array.from({ length: 5 }, () => ({ secret: 'SECRET upstream value' })) }, {}])
    const result = await adapter(fetch)(request(), { signal: signal() })
    expect(result.status).toBe('unavailable')
    expect(JSON.stringify(result)).toContain('Google Routes bus response was malformed (routes=array, count=5)')
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('returns safe manual fallback on malformed upstream responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{not json'))
    const result = await adapter(fetch)(request(), { signal: signal() })
    expect(result.status).not.toBe('ok')
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3)
    expect(JSON.stringify(result)).not.toContain('{not json')
  })

  it('does not start any request after cancellation', async () => {
    const fetch = fetcher(); const controller = new AbortController(); controller.abort()
    const result = await adapter(fetch)(request(), { signal: controller.signal })
    expect(result.status).not.toBe('ok'); expect(fetch).not.toHaveBeenCalled()
  })

  it('does not follow arbitrary destination URLs or accept Oregon coverage', async () => {
    const fetch = fetcher()
    for (const destination of ['https://example.test/Portland, ME', 'Portland, Oregon']) {
      expect((await adapter(fetch)({ ...request(), destination }, { signal: signal() })).status).toBe('unavailable')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})
