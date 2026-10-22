import { afterEach, expect, it, vi } from 'vitest'
const token = vi.hoisted(() => vi.fn<() => Promise<string | null>>())
vi.mock('../../src/lib/supabase', () => ({ getAccessToken: token }))
import { plannerRequestHeaders, notifyAuthenticationRequired } from '../../src/lib/authenticated-request'
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('attaches only the current user access token and never treats an API key as a session', async () => {
 token.mockResolvedValueOnce('verified-by-server-user-token')
 expect(await plannerRequestHeaders()).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer verified-by-server-user-token' })
 token.mockResolvedValueOnce(null)
 expect(await plannerRequestHeaders()).toEqual({ 'Content-Type': 'application/json' })
})
it('does not continue a canceled request after waiting for a refreshed token', async () => {
 const controller = new AbortController(); controller.abort()
 token.mockResolvedValueOnce('late-token')
 await expect(plannerRequestHeaders(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
it('announces rejected sessions without exposing tokens or backend errors', () => {
 const dispatchEvent = vi.fn(); vi.stubGlobal('window', { dispatchEvent })
 notifyAuthenticationRequired()
 expect(dispatchEvent).toHaveBeenCalledOnce(); expect(dispatchEvent.mock.calls[0][0].type).toBe('recovery:auth-required')
})
