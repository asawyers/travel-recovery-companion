import { describe, expect, it, vi } from 'vitest'
import { createFlightAwareAdapter } from '../../supabase/functions/_shared/server/flightaware.ts'
import { daytimeFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import type { TripRequest } from '../../supabase/functions/_shared/domain/schemas.ts'

const now = '2026-10-21T12:00:00Z'
const context = () => ({ signal: new AbortController().signal })
function request(): TripRequest {
  return { ...daytimeFixture().request, mode: 'real', flight: { ident: 'AS390', departureDate: '2026-10-21' }, arrivalBasis: 'estimated_gate' }
}
const flight = (changes: Record<string, unknown> = {}) => ({
  ident: 'ASA390', ident_icao: 'ASA390', ident_iata: 'AS390', fa_flight_id: 'opaque-flight-id',
  codeshares: ['JAL7010'], codeshares_iata: ['JL7010'],
  origin: { code: 'KSAN', code_iata: 'SAN', code_icao: 'KSAN' },
  destination: { code: 'KBOS', code_iata: 'BOS', code_icao: 'KBOS' },
  scheduled_out: '2026-10-21T16:00:00Z', scheduled_off: '2026-10-21T16:15:00Z',
  scheduled_in: '2026-10-21T21:20:00Z', estimated_in: '2026-10-21T21:30:00Z',
  actual_in: '2026-10-21T21:35:00Z', actual_on: '2026-10-21T21:26:00Z',
  cancelled: false, diverted: false, position_only: false, ...changes,
})
function setup(flights: unknown[] = [flight()], envelope: Record<string, unknown> = {}) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ flights, links: null, num_pages: 1, ...envelope }), { headers: { 'Content-Type': 'application/json' } }))
  const adapter = createFlightAwareAdapter({ enabled: true, apiKey: 'fixture-secret', now: () => now, fetcher })
  return { fetcher, adapter }
}
async function data(changes: Record<string, unknown> = {}) {
  const { adapter } = setup([flight(changes)])
  const result = await adapter(request(), context())
  expect(result.status).toBe('ok')
  if (result.status !== 'ok') throw new Error('Expected normalized fixture')
  return result
}

describe('FlightAware adapter (fixture responses only)', () => {
  it('preserves gate timestamps and opaque id while preferring actual gate arrival', async () => {
    const result = await data()
    expect(result.data.arrival).toEqual({ arrivalAt: '2026-10-21T21:35:00Z', arrivalBasis: 'actual_gate' })
    expect(result.data.report).toEqual({ ident: 'ASA390', faFlightId: 'opaque-flight-id', scheduledIn: '2026-10-21T21:20:00Z', estimatedIn: '2026-10-21T21:30:00Z', actualIn: '2026-10-21T21:35:00Z', actualOn: '2026-10-21T21:26:00Z', outcome: 'gate_available' })
    expect(result.evidence[0]).toMatchObject({ type: 'live', provider: 'FlightAware AeroAPI', checkedAt: now, providerUpdatedAt: null, environment: 'production' })
    expect(new URL(result.evidence[0].sourceUrl!).search).toBe('')
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
  })
  it.each([
    [{ actual_in: null }, 'estimated_gate', '2026-10-21T21:30:00Z', 'estimated'],
    [{ actual_in: null, estimated_in: null, actual_on: null }, 'scheduled_gate', '2026-10-21T21:20:00Z', 'schedule'],
  ])('selects the available gate basis without inventing actual data', async (changes, basis, at, evidenceType) => {
    const result = await data(changes)
    expect(result.data.arrival).toEqual({ arrivalAt: at, arrivalBasis: basis })
    expect(result.evidence[0].type).toBe(evidenceType)
  })
  it('retains runway-only fallback after touchdown even when an old gate schedule remains', async () => {
    const result = await data({ actual_in: null, estimated_in: null, actual_on: '2026-10-21T22:26:00Z' })
    expect(result.data.arrival).toBeNull()
    expect(result.data.report).toMatchObject({ outcome: 'runway_only', scheduledIn: '2026-10-21T21:20:00Z', actualOn: '2026-10-21T22:26:00Z' })
    expect(result.warnings.join(' ')).toMatch(/runway.*gate/i)
  })
  it.each([
    [{ actual_in: null, estimated_in: null, scheduled_in: null }, 'runway_only'],
    [{ cancelled: true }, 'cancelled'], [{ diverted: true }, 'diverted'], [{ position_only: true }, 'position_only'],
  ])('retains a report but no gate arrival for unsafe flight state', async (changes, outcome) => {
    const result = await data(changes)
    expect(result.data.arrival).toBeNull()
    expect(result.data.report.outcome).toBe(outcome)
    expect(result.warnings.length).toBeGreaterThan(0)
    if (outcome === 'cancelled') expect(result.warnings.join(' ')).toMatch(/tracking.*airline|airline.*tracking/i)
  })
  it('uses a single fixed HTTPS endpoint, SAN local calendar boundaries, a secret header and no redirects', async () => {
    const { adapter, fetcher } = setup()
    await adapter({ ...request(), flight: { ident: ' as 390 ', departureDate: '2026-10-21' } }, context())
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [input, init] = fetcher.mock.calls[0]
    const url = new URL(String(input))
    expect(url.origin).toBe('https://aeroapi.flightaware.com')
    expect(url.pathname).toBe('/aeroapi/flights/AS390')
    expect(Object.fromEntries(url.searchParams)).toEqual({ ident_type: 'designator', start: '2026-10-21T07:00:00Z', end: '2026-10-22T07:00:00Z', max_pages: '1' })
    expect(new Headers(init?.headers).get('x-apikey')).toBe('fixture-secret')
    expect(init?.redirect).toBe('error')
  })
  it.each(['ASA390', 'AS390', 'JL7010', 'JAL7010'])('matches operating and codeshare alias %s', async ident => {
    const { adapter } = setup()
    expect((await adapter({ ...request(), flight: { ident, departureDate: '2026-10-21' } }, context())).status).toBe('ok')
  })
  it('matches the SAN departure date even when UTC has rolled into the next day', async () => {
    const { adapter } = setup([flight({ scheduled_out: '2026-10-22T06:55:00Z' })])
    expect((await adapter(request(), context())).status).toBe('ok')
  })
  it('falls back to scheduled runway departure only for missing scheduled_out', async () => {
    const { adapter } = setup([flight({ scheduled_out: null })])
    expect((await adapter(request(), context())).status).toBe('ok')
  })
  it.each([
    { origin: { code: 'KLAX', code_iata: 'LAX', code_icao: 'KLAX' } },
    { destination: { code: 'KJFK', code_iata: 'JFK', code_icao: 'KJFK' } },
    { scheduled_out: '2026-10-21T06:59:59Z' },
    { scheduled_out: '2026-10-22T07:00:00Z' },
    { ident: 'ASA999', ident_icao: 'ASA999', ident_iata: 'AS999', codeshares: null, codeshares_iata: null },
  ])('does not use mismatched flight data', async changes => {
    const { adapter } = setup([flight(changes)])
    expect((await adapter(request(), context())).status).toBe('unavailable')
  })
  it('matches explicit ICAO route codes when IATA codes are missing', async () => {
    const { adapter } = setup([flight({ origin: { code: 'KSAN', code_icao: 'KSAN', code_iata: null }, destination: { code: 'KBOS', code_icao: 'KBOS', code_iata: null } })])
    expect((await adapter(request(), context())).status).toBe('ok')
  })
  it('does not choose between multiple plausible flights, including repeated diversion ids', async () => {
    const { adapter } = setup([flight(), flight({ diverted: true })])
    expect((await adapter(request(), context())).status).toBe('ambiguous')
  })
  it('treats truncated pagination as ambiguous without fetching another page', async () => {
    const { adapter, fetcher } = setup([flight()], { links: { next: 'https://untrusted.invalid/next?secret=payload' } })
    const result = await adapter(request(), context())
    expect(result.status).toBe('ambiguous')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('untrusted.invalid')
  })
  it.each([{}, { flights: 'wrong' }, { flights: [null] }, { flights: [{ ...flight(), actual_in: '2026-10-21T21:35:00' }] }, { flights: [{ ...flight(), cancelled: 'false' }] }])('rejects malformed provider responses', async body => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)))
    const result = await createFlightAwareAdapter({ enabled: true, apiKey: 'fixture-secret', now: () => now, fetcher })(request(), context())
    expect(result.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
  })
  it('returns unavailable for no matching flights', async () => {
    const { adapter } = setup([])
    expect((await adapter(request(), context())).status).toBe('unavailable')
  })
  it.each([
    { enabled: false, apiKey: 'fixture-secret' }, { enabled: true, apiKey: undefined },
  ])('does not fetch without explicit enablement and credentials', async options => {
    const fetcher = vi.fn<typeof fetch>()
    const result = await createFlightAwareAdapter({ ...options, now: () => now, fetcher })(request(), context())
    expect(result.status).toBe('unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { mode: 'synthetic' }, { flight: null },
    { flight: { ident: 'https://evil.invalid', departureDate: '2026-10-21' } },
    { flight: { ident: 'AS390', departureDate: '2026-10-01' } },
    { flight: { ident: 'AS390', departureDate: '2026-10-25' } },
  ])('does not fetch unsupported requests', async changes => {
    const { adapter, fetcher } = setup()
    expect((await adapter({ ...request(), ...changes } as TripRequest, context())).status).toBe('unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('handles rate limiting with no retry and no provider-body disclosure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('SECRET upstream failure', { status: 429 }))
    const result = await createFlightAwareAdapter({ enabled: true, apiKey: 'fixture-secret', now: () => now, fetcher })(request(), context())
    expect(result.status).toBe('error')
    if (result.status !== 'ok') expect(result.retryable).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toMatch(/SECRET|fixture-secret/)
  })
})
