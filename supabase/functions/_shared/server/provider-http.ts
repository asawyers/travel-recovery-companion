type ProviderHttpResult = { ok: true; body: unknown } | { ok: false; kind: 'rate_limited' | 'timeout' | 'aborted' | 'network' | 'http' | 'invalid'; status?: number }

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
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' })
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        return { ok: false, kind: response.status === 429 ? 'rate_limited' : 'http', status: response.status }
      }
      const declared = Number(response.headers.get('content-length'))
      if (declared > 131072 || !response.body) {
        void response.body?.cancel().catch(() => {})
        return { ok: false, kind: 'invalid' }
      }
      reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        total += chunk.value.byteLength
        if (total > 131072) return { ok: false, kind: 'invalid' }
        chunks.push(chunk.value)
      }
      const body = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
      try { return { ok: true, body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) } }
      catch { return { ok: false, kind: 'invalid' } }
    } catch { return { ok: false, kind: signal.aborted ? 'aborted' : 'network' } }
  }
  try { return await Promise.race([interrupted, operation()]) }
  finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    controller.abort()
    void reader?.cancel().catch(() => {})
  }
}
