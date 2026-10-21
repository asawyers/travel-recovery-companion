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
