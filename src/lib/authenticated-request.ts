import { getAccessToken } from './supabase'

export async function plannerRequestHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
  const token = await getAccessToken()
  if (signal?.aborted) throw signal.reason ?? new DOMException('Request canceled.', 'AbortError')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

export function notifyAuthenticationRequired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('recovery:auth-required'))
}
