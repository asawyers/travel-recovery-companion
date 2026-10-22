import {
  TravelRecoveryInputSchema,
  TravelRecoveryResponseSchema,
  travelRequestBinding,
  type TravelRecoveryInput,
  type TravelRecoveryResponse,
} from '@domain/travel-contracts'
import { PublicPlannerError, recoveryEndpoint } from './api'
import { explicitlyRequestedCityPatch } from '../../supabase/functions/_shared/server/city-agent-contracts'

const MAX_RESPONSE_BYTES = 1_048_576
export function travelEndpoint(base: string | undefined): string | null {
  const endpoint = recoveryEndpoint(base)
  if (!endpoint) return null
  const url = new URL(endpoint)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/travel`
  return url.toString()
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
const invalid = () => new PublicPlannerError('The planner returned invalid or mismatched trip facts. Retry. Your inputs are retained.')
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {})
    throw invalid()
  }
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, text = ''
  try {
    if (signal.aborted) { cancel(); throw signal.reason }
    while (true) {
      const chunk = await reader.read()
      if (signal.aborted) throw signal.reason
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) { cancel(); throw invalid() }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}
/** A single 35-second deadline covers headers and the bounded response body, even if fetch ignores abort. */
export async function requestTravel(input: TravelRecoveryInput, options: {
  endpoint?: string | null
  signal?: AbortSignal
  fetch?: typeof fetch
} = {}): Promise<TravelRecoveryResponse> {
  const parsed = TravelRecoveryInputSchema.safeParse(input)
  if (!parsed.success) throw new PublicPlannerError('Check your trip facts and retry. Your inputs are retained.')
  const endpoint = options.endpoint === undefined ? travelEndpoint(import.meta.env.VITE_RECOVERY_API_URL) : options.endpoint
  if (!endpoint) throw new PublicPlannerError('Live travel discovery is not configured. Your inputs are retained.')
  recoveryEndpoint(endpoint)
  const controller = new AbortController()
  const forward = () => controller.abort(options.signal?.reason)
  let timedOut = false, interrupt!: () => void
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () => reject(timedOut
      ? new PublicPlannerError('The planner timed out. Retry. Your inputs are retained.')
      : controller.signal.reason)
    controller.signal.addEventListener('abort', interrupt, { once: true })
  })
  options.signal?.addEventListener('abort', forward, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 35_000)
  try {
    if (options.signal?.aborted) { forward(); return await interrupted }
    const run = async () => {
      let response: Response
      try {
        response = await (options.fetch ?? fetch)(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
          body: JSON.stringify(parsed.data), signal: controller.signal,
        })
      } catch {
        if (controller.signal.aborted) throw controller.signal.reason
        throw new PublicPlannerError('Cannot reach the planner. Check your connection and retry. Your inputs are retained.')
      }
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw controller.signal.reason }
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new PublicPlannerError('The planner is unavailable or rejected these trip facts. Retry. Your inputs are retained.') }
      try {
        const result = TravelRecoveryResponseSchema.parse(await boundedJson(response, controller.signal))
        const patch = result.assistance?.appliedPreferences ?? {}
        if (Object.keys(patch).length > 0 && (
          result.assistance?.status !== 'completed' || !parsed.data.refinement ||
          !explicitlyRequestedCityPatch(parsed.data.refinement, patch)
        )) throw invalid()
        const binding = travelRequestBinding(parsed.data)
        const expectedBinding = { ...binding, trip: { ...binding.trip, ...patch } }
        if (canonical(result.request) !== canonical(expectedBinding)) throw invalid()
        const expected = parsed.data.conversation
        if (expected
          ? !result.conversation || result.conversation.turnId !== expected.turnId || result.conversation.baseRevision !== expected.baseRevision
          : result.conversation !== undefined) throw invalid()
        return result
      } catch {
        if (controller.signal.aborted) throw controller.signal.reason
        throw invalid()
      }
    }
    return await Promise.race([run(), interrupted])
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forward)
    controller.signal.removeEventListener('abort', interrupt)
  }
}
