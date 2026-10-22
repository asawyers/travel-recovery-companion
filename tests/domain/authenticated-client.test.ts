import { afterEach, expect, it, vi } from 'vitest'
import { daytimeFixture } from '@domain/fixtures'
import { cityFixture } from '@domain/city-fixtures'
vi.mock('../../src/lib/supabase', () => ({ getAccessToken: async () => null }))
import { comparePublic } from '../../src/lib/api'
import { compareCityPublic } from '../../src/lib/city-api'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
for (const kind of ['legacy', 'city'] as const) it(`${kind} ignores a late 401 after its request was canceled`, async () => {
 vi.useFakeTimers()
 const dispatchEvent = vi.fn(); vi.stubGlobal('window', { dispatchEvent })
 let finish!: (value: Response) => void, started!: () => void
 const fetched = new Promise<void>(resolve => { started = resolve })
 vi.stubGlobal('fetch', async () => { started(); return new Promise<Response>(resolve => { finish = resolve }) })
 const controller = new AbortController()
 const pending = (kind === 'legacy' ? comparePublic('https://example.com/recovery', daytimeFixture().request, false, controller.signal) : compareCityPublic('https://example.com/recovery/city', cityFixture().request, false, controller.signal)).catch(error => error)
 await fetched
 controller.abort(); expect(await pending).toMatchObject({ name: 'AbortError' })
 finish(new Response('{}', { status: 401 }))
 await vi.advanceTimersByTimeAsync(0)
 expect(dispatchEvent).not.toHaveBeenCalled()
 expect(vi.getTimerCount()).toBe(0)
})
