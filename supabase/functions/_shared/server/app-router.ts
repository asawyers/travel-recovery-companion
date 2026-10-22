import { corsHeaders, jsonResponse } from './http.ts'

type RecoveryHandler = (request: Request) => Promise<Response>

export function createRecoveryRouter({ legacy, city, travel }: { legacy: RecoveryHandler; city: RecoveryHandler; travel?: RecoveryHandler }) {
  return (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname.replace(/\/$/, '')
    if (path === '/recovery' || path === '/functions/v1/recovery') return legacy(request)
    if (path === '/recovery/city' || path === '/functions/v1/recovery/city') return city(request)
    if (travel && (path === '/recovery/travel' || path === '/functions/v1/recovery/travel')) return travel(request)
    return Promise.resolve(jsonResponse({ error: 'Not found.' }, 404, corsHeaders()))
  }
}
