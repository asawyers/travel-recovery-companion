import { createRecoveryHandler } from '../_shared/server/handlers.ts'
import { createProviderRegistry } from '../_shared/server/providers.ts'
import { createGoogleRoutesAdapter } from '../_shared/server/google-routes.ts'
import { createLiteApiAdapter } from '../_shared/server/liteapi.ts'
import { createRecoveryAgent } from '../_shared/server/recovery-agent.ts'
import { MODEL_REGISTRY } from '../_shared/server/model-registry.ts'

const now = () => new Date().toISOString()
// Independent switches authorize usage; none is an enforced spending cap.
const routesApproved = Deno.env.get('RECOVERY_PROVIDER_USAGE_APPROVED') === 'true'
const routesKey = routesApproved ? Deno.env.get('GOOGLE_ROUTES_API_KEY') : undefined
const hotelApproved = Deno.env.get('RECOVERY_HOTEL_USAGE_APPROVED') === 'true'
const hotelPublicRatesApproved = hotelApproved && Deno.env.get('RECOVERY_HOTEL_PUBLIC_RATES_APPROVED') === 'true'
const hotelEnvironment = hotelApproved && Deno.env.get('LITEAPI_ENVIRONMENT') === 'production' ? 'production' : 'sandbox'
const hotelKey = hotelApproved && hotelPublicRatesApproved && hotelEnvironment === 'production' ? Deno.env.get('LITEAPI_KEY') : undefined
const hotelBookingOrigin = hotelApproved ? Deno.env.get('LITEAPI_BOOKING_ORIGIN') : undefined
// Free test data is available only through explicit synthetic hotel-demo requests.
const sandboxHotelKey = Deno.env.get('LITEAPI_SANDBOX_KEY')
const modelApproved = Deno.env.get('RECOVERY_MODEL_USAGE_APPROVED') === 'true'
const modelKey = modelApproved ? Deno.env.get('OPENAI_API_KEY') : undefined
const modelName = MODEL_REGISTRY.recovery.id
const providers = createProviderRegistry({
  routes: createGoogleRoutesAdapter({ enabled: routesApproved && Boolean(routesKey), apiKey: routesKey, now }),
  hotels: createLiteApiAdapter({ enabled: hotelApproved && hotelPublicRatesApproved && hotelEnvironment === 'production' && Boolean(hotelKey), publicRatesApproved: hotelPublicRatesApproved, environment: hotelEnvironment, apiKey: hotelKey, bookingOrigin: hotelBookingOrigin, now }),
  sandboxHotels: createLiteApiAdapter({ enabled: Boolean(sandboxHotelKey?.trim()), environment: 'sandbox', apiKey: sandboxHotelKey, now }),
})
const agent = createRecoveryAgent({ enabled: modelApproved && Boolean(modelKey), apiKey: modelKey, modelName, now })
Deno.serve(createRecoveryHandler({ now, providers, agent, hotelBookingOrigin }))
