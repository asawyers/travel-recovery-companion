const rpcDiagnostics = ['CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DATA_LOSS'] as const
type ProviderHttpDiagnostic = typeof rpcDiagnostics[number] | 'departure_time_with_traffic_unaware' | 'invalid_departure_time' | 'invalid_field_mask' | 'invalid_origin' | 'invalid_destination' | 'invalid_transit_preferences'
type ProviderHttpFailure = { ok: false; kind: 'rate_limited' | 'timeout' | 'aborted' | 'network' | 'http' | 'invalid'; status?: number; diagnostic?: ProviderHttpDiagnostic }
type ProviderHttpResult = { ok: true; body: unknown } | ProviderHttpFailure
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Return internal literals only, never provider messages, descriptions, field values or arbitrary status strings. */
function errorDiagnostic(body: unknown, status: number): ProviderHttpDiagnostic | undefined {
  const error = record(record(body)?.error)
  if (!error) return undefined
  if (status === 400 || error.status === 'INVALID_ARGUMENT') {
    const message = typeof error.message === 'string' ? error.message.slice(0, 4096) : ''
    const invalid = /invalid|incompatib|not\s+(?:be\s+)?(?:set|supported|allowed)|must\s+not|cannot|can't|only|should\s+not/i.test(message)
    if (invalid && /departure_?time/i.test(message) && /traffic_?unaware/i.test(message)) return 'departure_time_with_traffic_unaware'
    if (invalid && /field[_ -]?mask|x-goog-fieldmask/i.test(message)) return 'invalid_field_mask'
    if (Array.isArray(error.details)) for (const detail of error.details.slice(0, 32)) {
      const item = record(detail)
      if (item?.['@type'] !== 'type.googleapis.com/google.rpc.BadRequest' || !Array.isArray(item.fieldViolations)) continue
      for (const violation of item.fieldViolations.slice(0, 32)) {
        const field = record(violation)?.field
        if (typeof field !== 'string') continue
        switch (field.slice(0, 100).split('.')[0].replace(/_/g, '').toLowerCase()) {
          case 'departuretime': return 'invalid_departure_time'
          case 'fieldmask': return 'invalid_field_mask'
          case 'origin': return 'invalid_origin'
          case 'destination': return 'invalid_destination'
          case 'transitpreferences': return 'invalid_transit_preferences'
        }
      }
    }
  }
  return rpcDiagnostics.find(value => value === error.status)
}

/** One bounded attempt. Credentials and upstream response bodies never enter errors. */
export async function providerJson(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<ProviderHttpResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let abort: () => void = () => {}
  const interrupted = new Promise<ProviderHttpResult>(resolve => {
    abort = () => { controller.abort(); resolve({ ok: false, kind: 'aborted' }) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    timer = setTimeout(() => { controller.abort(); resolve({ ok: false, kind: 'timeout' }) }, 3000)
  })
  const operation = async (): Promise<ProviderHttpResult> => {
    if (signal.aborted) return { ok: false, kind: 'aborted' }
    let httpFailure: ProviderHttpFailure | undefined
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' })
      if (!response.ok) httpFailure = { ok: false, kind: response.status === 429 ? 'rate_limited' : 'http', status: response.status }
      const declared = Number(response.headers.get('content-length'))
      if (declared > 131072 || !response.body) {
        void response.body?.cancel().catch(() => {})
        return httpFailure ?? { ok: false, kind: 'invalid' }
      }
      reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        total += chunk.value.byteLength
        if (total > 131072) return httpFailure ?? { ok: false, kind: 'invalid' }
        chunks.push(chunk.value)
      }
      const body = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
      try {
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
        if (httpFailure) {
          const diagnostic = errorDiagnostic(parsed, response.status)
          return diagnostic ? { ...httpFailure, diagnostic } : httpFailure
        }
        return { ok: true, body: parsed }
      }
      catch { return httpFailure ?? { ok: false, kind: 'invalid' } }
    } catch { return signal.aborted ? { ok: false, kind: 'aborted' } : httpFailure ?? { ok: false, kind: 'network' } }
  }
  try { return await Promise.race([interrupted, operation()]) }
  finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    controller.abort()
    void reader?.cancel().catch(() => {})
  }
}
