export const MAX_BODY_BYTES = 64 * 1024
export const BODY_TIMEOUT_MS = 5_000
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** Browser bearer-token access without cookies or origin-specific configuration. */
export function corsHeaders(): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
}

export function jsonResponse(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

/** Read incrementally: neither Content-Length nor a well-behaved stream is assumed. */
export async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length')
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) throw new HttpError(413, 'Request body exceeds 64 KiB.')
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(400, 'Expected application/json.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Expected a JSON request body.')
  let timer: ReturnType<typeof setTimeout> | undefined
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    const read = async () => {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_BODY_BYTES) throw new HttpError(413, 'Request body exceeds 64 KiB.')
        chunks.push(value)
      }
      const body = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown }
      catch { throw new HttpError(400, 'Malformed JSON request body.') }
    }
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HttpError(408, 'Request body timed out.')), BODY_TIMEOUT_MS)
    })])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    void reader.cancel().catch(() => {})
  }
}
