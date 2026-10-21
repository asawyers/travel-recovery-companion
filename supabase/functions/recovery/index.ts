import { createRecoveryHandler } from '../_shared/server/handlers.ts'
import { createProviderRegistry } from '../_shared/server/providers.ts'
import { createFlightAwareAdapter } from '../_shared/server/flightaware.ts'
import { createGoogleRoutesAdapter } from '../_shared/server/google-routes.ts'

const now = () => new Date().toISOString()
// This deployment switch authorizes usage; it is not an enforced spending cap.
const approved = Deno.env.get('RECOVERY_PROVIDER_USAGE_APPROVED') === 'true'
const flightKey = approved ? Deno.env.get('FLIGHTAWARE_API_KEY') : undefined
const routesKey = approved ? Deno.env.get('GOOGLE_ROUTES_API_KEY') : undefined
const providers = createProviderRegistry({
  flight: createFlightAwareAdapter({ enabled: approved && Boolean(flightKey), apiKey: flightKey, now }),
  routes: createGoogleRoutesAdapter({ enabled: approved && Boolean(routesKey), apiKey: routesKey, now }),
})

Deno.serve(createRecoveryHandler({ now, providers }))
