export type SerpApiHttpResult =
  | { ok: true; body: unknown }
  | { ok: false; kind: 'timeout' | 'cancelled' | 'network' | 'http' | 'oversize' | 'malformed' | 'unavailable'; status?: number }

type SerpApiEngine = 'google_flights' | 'google_hotels'

type SerpApiJsonOptions = {
  apiKey: string
  engine: SerpApiEngine
  parameters: Record<string, string>
  signal: AbortSignal
  fetch?: typeof fetch
}

const ENDPOINT = 'https://serpapi.com/search.json'
const DEADLINE_MS = 18_000
const MAX_RESPONSE_BYTES = 1_048_576

/** Makes one bounded SerpApi request. Failures deliberately contain no provider text or credentials. */
export async function serpApiJson(options: SerpApiJsonOptions): Promise<SerpApiHttpResult> {
  const { apiKey, engine, parameters, signal } = options
  if (typeof apiKey !== 'string' || !apiKey.trim() ||
    (engine !== 'google_flights' && engine !== 'google_hotels') ||
    !parameters || typeof parameters !== 'object' || Array.isArray(parameters) ||
    Object.keys(parameters).some(key => key.toLowerCase() === 'api_key' || key.toLowerCase() === 'engine')) {
    return { ok: false, kind: 'unavailable' }
  }
  if (signal.aborted) return { ok: false, kind: 'cancelled' }

  const url = new URL(ENDPOINT)
  for (const [key, value] of Object.entries(parameters)) url.searchParams.append(key, value)
  url.searchParams.append('api_key', apiKey.trim())
  url.searchParams.append('engine', engine)

  const controller = new AbortController()
  const fetcher = options.fetch ?? fetch
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let interrupted: 'timeout' | 'cancelled' | undefined
  let interrupt!: (result: SerpApiHttpResult) => void
  const interruption = new Promise<SerpApiHttpResult>(resolve => { interrupt = resolve })
  const onCallerAbort = () => {
    interrupted = 'cancelled'
    controller.abort()
    interrupt({ ok: false, kind: 'cancelled' })
  }
  signal.addEventListener('abort', onCallerAbort, { once: true })
  timer = setTimeout(() => {
    interrupted = 'timeout'
    controller.abort()
    interrupt({ ok: false, kind: 'timeout' })
  }, DEADLINE_MS)

  const operation = async (): Promise<SerpApiHttpResult> => {
    try {
      const response = await fetcher(url.toString(), { method: 'GET', redirect: 'error', signal: controller.signal })
      if (interrupted) {
        void response.body?.cancel().catch(() => {})
        return { ok: false, kind: interrupted }
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        return { ok: false, kind: 'http', status: response.status }
      }

      const declaredLength = response.headers.get('content-length')
      if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
        void response.body?.cancel().catch(() => {})
        return { ok: false, kind: 'oversize' }
      }
      if (!response.body) return { ok: false, kind: 'malformed' }

      reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        if (interrupted) return { ok: false, kind: interrupted }
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {})
          return { ok: false, kind: 'oversize' }
        }
        chunks.push(value)
      }
      if (interrupted) return { ok: false, kind: interrupted }
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      try {
        const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        if (body !== null && typeof body === 'object' && !Array.isArray(body) &&
          typeof (body as Record<string, unknown>).error === 'string') {
          return { ok: false, kind: 'malformed' }
        }
        return { ok: true, body }
      } catch {
        return { ok: false, kind: 'malformed' }
      }
    } catch {
      return interrupted ? { ok: false, kind: interrupted } : { ok: false, kind: 'network' }
    }
  }

  try {
    return await Promise.race([operation(), interruption])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener('abort', onCallerAbort)
    controller.abort()
    if (reader) {
      void reader.cancel().catch(() => {})
      try { reader.releaseLock() } catch { /* The read may still be settling after interruption. */ }
    }
  }
}
