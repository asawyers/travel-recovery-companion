import { afterEach, describe, expect, it, vi } from 'vitest'
import { serpApiJson } from '../../supabase/functions/_shared/server/serpapi-http'

const KEY = 'fixture-secret-key'
const signal = () => new AbortController().signal
const response = (body: string | Uint8Array, init: { status?: number; headers?: HeadersInit } = {}) => new Response(body, init)
const ok = (body = '{"flights":[1]}') => response(body)
const encoder = new TextEncoder()
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const readStream = (chunks: Uint8Array[], onCancel?: () => void) => new ReadableStream<Uint8Array>({
  start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close() },
  cancel() { onCancel?.() },
})

const invoke = (fetcher: typeof fetch, options: Partial<Parameters<typeof serpApiJson>[0]> = {}) => serpApiJson({
  apiKey: KEY,
  engine: 'google_flights',
  parameters: { departure_id: 'SFO', arrival_id: 'LAX' },
  signal: signal(),
  fetch: fetcher,
  ...options,
})

afterEach(() => vi.useRealTimers())

describe('serpApiJson', () => {
  it('fetches the fixed HTTPS endpoint and returns a parsed JSON fixture', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => ok())
    await expect(invoke(fetcher)).resolves.toEqual({ ok: true, body: { flights: [1] } })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://serpapi.com/search.json?departure_id=SFO&arrival_id=LAX&api_key=fixture-secret-key&engine=google_flights')
    expect(init?.method).toBe('GET')
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('does not make a request when the API key is empty or whitespace', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(invoke(fetcher, { apiKey: '  \t' })).resolves.toEqual({ ok: false, kind: 'unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails closed when parameters try to replace reserved credentials or engine', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(invoke(fetcher, { parameters: { api_key: 'attacker', engine: 'google_hotels' } })).resolves.toEqual({ ok: false, kind: 'unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('times out even when fetch ignores abort and never resolves', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}))
    const pending = invoke(fetcher)
    await vi.advanceTimersByTimeAsync(18_000)
    await expect(pending).resolves.toEqual({ ok: false, kind: 'timeout' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('uses one total deadline across fetch and a stalled response body', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ pull() {} })))
    const pending = invoke(fetcher)
    await vi.advanceTimersByTimeAsync(17_999)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual({ ok: false, kind: 'timeout' })
  })

  it('returns cancelled when the caller signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn<typeof fetch>()
    await expect(invoke(fetcher, { signal: controller.signal })).resolves.toEqual({ ok: false, kind: 'cancelled' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns cancelled when the caller aborts while fetch is pending', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}))
    const pending = invoke(fetcher, { signal: controller.signal })
    controller.abort()
    await expect(pending).resolves.toEqual({ ok: false, kind: 'cancelled' })
  })

  it('returns cancelled when the caller aborts while reading the body', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ pull() {} })))
    const pending = invoke(fetcher, { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(pending).resolves.toEqual({ ok: false, kind: 'cancelled' })
  })

  it('accepts exactly one MiB of streamed JSON', async () => {
    const payload = `"${'a'.repeat(1_048_574)}"`
    const fetcher = vi.fn<typeof fetch>(async () => new Response(readStream([encoder.encode(payload)])))
    const result = await invoke(fetcher)
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.body as string).length).toBe(1_048_574)
  })

  it('rejects a stream larger than one MiB and cancels its reader', async () => {
    let cancelled = false
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1_048_576)) },
      pull(controller) { controller.enqueue(new Uint8Array(1)) },
      cancel() { cancelled = true },
    }), { headers: { 'content-length': '1' } }))
    await expect(invoke(fetcher)).resolves.toEqual({ ok: false, kind: 'oversize' })
    expect(cancelled).toBe(true)
  })

  it('rejects oversized declared lengths without trusting them as the only bound', async () => {
    const cancel = vi.fn()
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { 'content-length': '1048577' } }))
    await expect(invoke(fetcher)).resolves.toEqual({ ok: false, kind: 'oversize' })
  })

  it('rejects invalid JSON and invalid UTF-8 as malformed', async () => {
    const invalidJson = vi.fn<typeof fetch>(async () => ok('{oops'))
    const invalidUtf8 = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([0xc3, 0x28])))
    await expect(invoke(invalidJson)).resolves.toEqual({ ok: false, kind: 'malformed' })
    await expect(invoke(invalidUtf8)).resolves.toEqual({ ok: false, kind: 'malformed' })
  })

  it('rejects a successful HTTP response containing a provider error envelope without exposing its text', async () => {
    const providerText = `authentication failed for ${KEY} at https://serpapi.com/search.json?api_key=${KEY}`
    const fetcher = vi.fn<typeof fetch>(async () => ok(JSON.stringify({ error: providerText })))
    const result = await invoke(fetcher)
    expect(result).toEqual({ ok: false, kind: 'malformed' })
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(JSON.stringify(result)).not.toContain('serpapi.com')
  })

  it.each([401, 429, 500])('returns a sanitized HTTP failure for status %s', async status => {
    const body = `{"error":"${KEY} marker https://evil.example/${KEY}"}`
    const fetcher = vi.fn<typeof fetch>(async () => response(body, { status }))
    const result = await invoke(fetcher)
    expect(result).toEqual({ ok: false, kind: 'http', status })
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(JSON.stringify(result)).not.toContain('marker')
    expect(JSON.stringify(result)).not.toContain('evil.example')
  })

  it('sanitizes thrown fetch errors containing endpoint and key details', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error(`failed https://serpapi.com/${KEY}`) })
    const result = await invoke(fetcher)
    expect(result).toEqual({ ok: false, kind: 'network' })
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(JSON.stringify(result)).not.toContain('serpapi.com')
  })
})
