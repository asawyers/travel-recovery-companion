import { createRecoveryHandler } from '../_shared/server/handlers.ts'
import { disabledProviders } from '../_shared/server/providers.ts'

Deno.serve(createRecoveryHandler({ now: () => new Date().toISOString(), providers: disabledProviders }))
