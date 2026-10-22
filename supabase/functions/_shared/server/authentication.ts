import { corsHeaders, jsonResponse } from './http.ts'

type RecoveryHandler = (request: Request) => Promise<Response>
type AuthenticationOptions = { supabaseUrl?: string; supabaseAnonKey?: string; fetcher?: typeof fetch }
type AuthenticationResult = 'authenticated' | 'unauthorized' | 'unavailable'
const AUTH_TIMEOUT_MS = 5_000

/** Verify with this project's Auth service; decoded JWT claims alone never authorize work. */
export function createAuthenticatedRecoveryHandler(handler: RecoveryHandler, options: AuthenticationOptions): RecoveryHandler {
  const fetcher = options.fetcher ?? fetch
  const projectUrl = options.supabaseUrl?.trim().replace(/\/+$/, '')
  const anonKey = options.supabaseAnonKey?.trim()

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
    if (request.method !== 'POST') return handler(request)

    const token = /^Bearer ([^\s,]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
    if (!token || token === anonKey) return authenticationError('unauthorized')
    if (!projectUrl || !anonKey) return authenticationError('unavailable')

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let response: Response | undefined
    let result: AuthenticationResult
    try {
      const verify = async (): Promise<AuthenticationResult> => {
        response = await fetcher(`${projectUrl}/auth/v1/user`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
          redirect: 'error',
          signal: controller.signal,
        })
        if ([400, 401, 403].includes(response.status)) return 'unauthorized'
        if (!response.ok) return 'unavailable'
        const user: unknown = await response.json()
        return user !== null && typeof user === 'object' && 'id' in user
          && typeof user.id === 'string' && user.id.trim().length > 0
          && !('is_anonymous' in user && user.is_anonymous === true)
          && !('role' in user && user.role === 'anon')
          ? 'authenticated' : 'unauthorized'
      }
      result = await Promise.race([
        verify(),
        new Promise<AuthenticationResult>(resolve => { timer = setTimeout(() => { controller.abort(); resolve('unavailable') }, AUTH_TIMEOUT_MS) }),
      ])
    } catch {
      // Auth failures never disclose upstream bodies, credentials or token details.
      result = 'unavailable'
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      controller.abort()
      void response?.body?.cancel().catch(() => {})
    }
    if (result !== 'authenticated') return authenticationError(result)
    // Keep recovery failures outside the authentication catch boundary.
    return handler(request)
  }
}

function authenticationError(result: 'unauthorized' | 'unavailable'): Response {
  return jsonResponse({ error: result === 'unauthorized' ? 'Sign in to continue.' : 'Authentication is temporarily unavailable. Please try again.' }, result === 'unauthorized' ? 401 : 503, corsHeaders())
}
