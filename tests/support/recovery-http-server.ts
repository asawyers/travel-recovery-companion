/** Loopback-only test harness. Production never imports this verifier or its synthetic identity. */
import { createRecoveryHandler } from '../../supabase/functions/_shared/server/handlers.ts'
import { createProviderRegistry } from '../../supabase/functions/_shared/server/providers.ts'
import { createCityRecoveryHandler } from '../../supabase/functions/_shared/server/city-handlers.ts'
import { createTravelRecoveryHandler } from '../../supabase/functions/_shared/server/travel-handlers.ts'
import { createRecoveryRouter } from '../../supabase/functions/_shared/server/app-router.ts'
import { createAuthenticatedRecoveryHandler } from '../../supabase/functions/_shared/server/authentication.ts'
import { AUTH_ACCESS_TOKEN, fakeSession } from './auth-fixture-data.ts'

const now = () => new Date().toISOString()
const router = createRecoveryRouter({
  legacy: createRecoveryHandler({ now, providers: createProviderRegistry({}) }),
  city: createCityRecoveryHandler({ now }),
  travel: createTravelRecoveryHandler({ now }),
})
const verifyFixture: typeof fetch = async (_input, init) => new Response(
  JSON.stringify(new Headers(init?.headers).get('authorization') === `Bearer ${AUTH_ACCESS_TOKEN}` ? fakeSession().user : { error: 'Invalid test credential' }),
  { status: new Headers(init?.headers).get('authorization') === `Bearer ${AUTH_ACCESS_TOKEN}` ? 200 : 401, headers: { 'Content-Type': 'application/json' } },
)
const authenticated = createAuthenticatedRecoveryHandler(router, {
  supabaseUrl: 'https://fixture.invalid', supabaseAnonKey: 'synthetic-test-project-key', fetcher: verifyFixture,
})
Deno.serve({ hostname: '127.0.0.1', port: 37425 }, request =>
  request.method === 'GET' && new URL(request.url).pathname === '/health'
    ? new Response('Test harness ready') : authenticated(request))
