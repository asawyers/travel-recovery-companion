import { createRecoveryHandler } from '../_shared/server/handlers.ts'
import { disabledProviders } from '../_shared/server/providers.ts'

const allowedOrigins = (Deno.env.get('RECOVERY_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(value => {
  try { return new URL(value).origin === value && value !== 'null' } catch { return false }
})
Deno.serve(createRecoveryHandler({ now: () => new Date().toISOString(), allowedOrigins, providers: disabledProviders }))
