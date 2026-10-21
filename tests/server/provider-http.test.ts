import { describe, expect, it, vi } from 'vitest'
import { providerJson } from '../../supabase/functions/_shared/server/provider-http.ts'

describe('bounded provider JSON requests', () => {
  it('returns JSON and prevents redirects without exposing request details', async () => {
    const fetcher = vi.fn(async () => Response.json({ value: 1 }))
    expect(await providerJson(fetcher, 'https://provider.test', {}, new AbortController().signal)).toEqual({ ok: true, body: { value: 1 } })
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })
  it.each([[429, 'rate_limited'], [500, 'http']] as const)('sanitizes status %s', async (status, kind) => {
    expect(await providerJson(async () => new Response('SECRET', { status }), 'https://provider.test', {}, new AbortController().signal)).toEqual({ ok: false, kind, status })
  })
  it('identifies the departure-time/traffic-unaware conflict without returning upstream text', async () => {
    const result = await providerJson(async () => Response.json({ error: { status: 'INVALID_ARGUMENT', message: 'SECRET departure_time must not be set with TRAFFIC_UNAWARE. https://secret.test/key' } }, { status: 400 }), 'https://provider.test', {}, new AbortController().signal)
    expect(result).toEqual({ ok: false, kind: 'http', status: 400, diagnostic: 'departure_time_with_traffic_unaware' })
    expect(JSON.stringify(result)).not.toMatch(/SECRET|secret.test/)
  })
  it('maps only allowlisted Google validation fields to fixed diagnostics', async () => {
    const result = await providerJson(async () => Response.json({ error: { status: 'INVALID_ARGUMENT', message: 'SECRET', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'destination.address', description: 'SECRET address' }] }] } }, { status: 400 }), 'https://provider.test', {}, new AbortController().signal)
    expect(result).toEqual({ ok: false, kind: 'http', status: 400, diagnostic: 'invalid_destination' })
  })
  it('identifies invalid field masks with a fixed diagnostic', async () => {
    const result = await providerJson(async () => Response.json({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid field mask: SECRET' } }, { status: 400 }), 'https://provider.test', {}, new AbortController().signal)
    expect(result).toEqual({ ok: false, kind: 'http', status: 400, diagnostic: 'invalid_field_mask' })
  })
  it('returns only allowlisted RPC statuses for unrecognized validation details', async () => {
    for (const status of ['PERMISSION_DENIED', 'SECRET_STATUS']) {
      const result = await providerJson(async () => Response.json({ error: { status, message: 'SECRET', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'SECRET', description: 'SECRET' }] }] } }, { status: 403 }), 'https://provider.test', {}, new AbortController().signal)
      expect(result).toEqual({ ok: false, kind: 'http', status: 403, ...(status === 'PERMISSION_DENIED' ? { diagnostic: status } : {}) })
    }
  })
  it('preserves HTTP failure categories for oversized error bodies', async () => {
    for (const status of [400, 429]) {
      const large = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(131073)); c.close() } })
      const result = await providerJson(async () => new Response(large, { status }), 'https://provider.test', {}, new AbortController().signal)
      expect(result).toEqual({ ok: false, kind: status === 429 ? 'rate_limited' : 'http', status })
    }
  })
  it('bounds stalled error response bodies at three seconds', async () => {
    vi.useFakeTimers()
    try {
      const pending = providerJson(async () => new Response(new ReadableStream({ start() {} }), { status: 400 }), 'https://provider.test', {}, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(3001)
      expect(await pending).toEqual({ ok: false, kind: 'timeout' })
    } finally { vi.useRealTimers() }
  })
  it('rejects malformed and oversized streamed JSON', async () => {
    expect(await providerJson(async () => new Response('SECRET'), 'https://provider.test', {}, new AbortController().signal)).toEqual({ ok: false, kind: 'invalid' })
    const large = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(131073)); c.close() } })
    expect(await providerJson(async () => new Response(large), 'https://provider.test', {}, new AbortController().signal)).toEqual({ ok: false, kind: 'invalid' })
  })
  it('bounds stalled fetches and stalled bodies at three seconds', async () => {
    vi.useFakeTimers()
    try {
      for (const fetcher of [(() => new Promise<Response>(() => {})), (async () => new Response(new ReadableStream({ start() {} })))]) {
        const pending = providerJson(fetcher, 'https://provider.test', {}, new AbortController().signal)
        await vi.advanceTimersByTimeAsync(3001)
        expect(await pending).toEqual({ ok: false, kind: 'timeout' })
      }
    } finally { vi.useRealTimers() }
  })
  it('aborts with the parent signal and sanitizes network errors', async () => {
    const controller = new AbortController()
    const pending = providerJson(() => new Promise<Response>(() => {}), 'https://provider.test', {}, controller.signal)
    controller.abort()
    expect(await pending).toEqual({ ok: false, kind: 'aborted' })
    expect(await providerJson(async () => { throw new Error('SECRET') }, 'https://provider.test', {}, new AbortController().signal)).toEqual({ ok: false, kind: 'network' })
  })
})
