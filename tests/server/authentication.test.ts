import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthenticatedRecoveryHandler } from '../../supabase/functions/_shared/server/authentication.ts'
import { createRecoveryRouter } from '../../supabase/functions/_shared/server/app-router.ts'

const config = { supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'project-anon-key' }
const request = (token?: string, path = '/functions/v1/recovery', method = 'POST') => new Request(`https://edge.test${path}`, {
  method,
  ...(token ? { headers: { Authorization: token } } : {}),
})
const authorized = () => Response.json({ id: 'user-id', aud: 'authenticated', role: 'authenticated' })

afterEach(() => vi.useRealTimers())

describe('server-verified recovery authentication', () => {
  it.each(['/recovery', '/functions/v1/recovery/city', '/functions/v1/recovery/travel'])('blocks unauthenticated %s before provider/model handlers', async path => {
    const handler = vi.fn(async () => new Response('provider/model work'))
    const fetcher = vi.fn(async () => authorized())
    const protectedHandler = createAuthenticatedRecoveryHandler(createRecoveryRouter({ legacy: handler, city: handler, travel: handler }), { ...config, fetcher })

    const response = await protectedHandler(request(undefined, path))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Sign in to continue.' })
    expect(handler).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['Basic secret', 'Bearer', 'Bearer token with spaces', 'Bearer project-anon-key'])('rejects malformed or API-key authorization %s', async authorization => {
    const handler = vi.fn(async () => new Response())
    const fetcher = vi.fn(async () => authorized())
    const response = await createAuthenticatedRecoveryHandler(handler, { ...config, fetcher })(request(authorization))
    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('verifies the user bearer with the configured project Auth and passes the untouched request only after success', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => authorized())
    const handler = vi.fn(async (input: Request) => {
      expect(input.bodyUsed).toBe(false)
      return new Response('recovery result')
    })
    const input = request('Bearer valid-user-token')
    const response = await createAuthenticatedRecoveryHandler(handler, { ...config, fetcher })(input)
    expect(await response.text()).toBe('recovery result')
    expect(handler).toHaveBeenCalledWith(input)
    expect(fetcher).toHaveBeenCalledWith('https://project.supabase.co/auth/v1/user', expect.objectContaining({
      method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Authorization: 'Bearer valid-user-token', apikey: 'project-anon-key' },
    }))
  })

  it.each([401, 403])('rejects Auth-rejected forged/expired/foreign user tokens (%s) without exposing upstream details', async status => {
    const handler = vi.fn(async () => new Response())
    const fetcher = vi.fn(async () => new Response('SECRET invalid signature or expired token', { status }))
    const response = await createAuthenticatedRecoveryHandler(handler, { ...config, fetcher })(request('Bearer forged-user-token'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Sign in to continue.' })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([429, 500, 503])('fails closed when Auth returns %s', async status => {
    const handler = vi.fn(async () => new Response())
    const response = await createAuthenticatedRecoveryHandler(handler, { ...config, fetcher: async () => new Response('SECRET', { status }) })(request('Bearer user-token'))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Authentication is temporarily unavailable. Please try again.' })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([{ id: '' }, { role: 'anon' }, { id: 'user-id', is_anonymous: true }, null])('fails closed for unusable Auth user data %j', async body => {
    const handler = vi.fn(async () => new Response())
    const response = await createAuthenticatedRecoveryHandler(handler, { ...config, fetcher: async () => Response.json(body) })(request('Bearer user-token'))
    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([{ ...config, supabaseUrl: undefined }, { ...config, supabaseAnonKey: undefined }])('fails closed for missing server Auth configuration', async options => {
    const handler = vi.fn(async () => new Response())
    const fetcher = vi.fn(async () => authorized())
    const response = await createAuthenticatedRecoveryHandler(handler, { ...options, fetcher })(request('Bearer user-token'))
    expect(response.status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('allows public preflight including the Authorization header without Auth configuration', async () => {
    const handler = vi.fn(async () => new Response())
    const response = await createAuthenticatedRecoveryHandler(handler, {})(request(undefined, '/functions/v1/recovery/travel', 'OPTIONS'))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(handler).not.toHaveBeenCalled()
  })

  it('preserves unsupported method handling without Auth requests', async () => {
    const handler = vi.fn(async () => new Response('Method not allowed.', { status: 405 }))
    const fetcher = vi.fn(async () => authorized())
    const response = await createAuthenticatedRecoveryHandler(handler, { ...config, fetcher })(request(undefined, '/recovery', 'GET'))
    expect(response.status).toBe(405)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('bounds both stalled Auth fetches and stalled bodies and aborts the request', async () => {
    vi.useFakeTimers()
    for (const response of [undefined, new Response(new ReadableStream({ start() {} }))]) {
      let signal: AbortSignal | undefined
      const fetcher: typeof fetch = async (_url, init) => {
        signal = init?.signal ?? undefined
        return response ?? new Promise<Response>(() => {})
      }
      const handler = vi.fn(async () => new Response())
      const pending = createAuthenticatedRecoveryHandler(handler, { ...config, fetcher })(request('Bearer user-token'))
      await vi.advanceTimersByTimeAsync(5_001)
      expect((await pending).status).toBe(503)
      expect(signal?.aborted).toBe(true)
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('sanitizes network and malformed response errors without invoking the handler', async () => {
    for (const fetcher of [async () => { throw new Error('SECRET token') }, async () => new Response('SECRET malformed body')]) {
      const handler = vi.fn(async () => new Response())
      const response = await createAuthenticatedRecoveryHandler(handler, { ...config, fetcher })(request('Bearer user-token'))
      expect(response.status).toBe(503)
      expect(await response.text()).not.toContain('SECRET')
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('does not disguise an authenticated recovery handler failure as an authentication error', async () => {
    const error = new Error('Recovery failed')
    const handler = async () => { throw error }
    await expect(createAuthenticatedRecoveryHandler(handler, { ...config, fetcher: async () => authorized() })(request('Bearer user-token'))).rejects.toBe(error)
  })
})
