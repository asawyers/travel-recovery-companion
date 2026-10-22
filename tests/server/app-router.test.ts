import { describe, expect, it, vi } from 'vitest'
import { createRecoveryRouter } from '../../supabase/functions/_shared/server/app-router.ts'

describe('recovery URL dispatcher', () => {
  it.each([
    ['/recovery', 'legacy'],
    ['/functions/v1/recovery', 'legacy'],
    ['/recovery/', 'legacy'],
    ['/functions/v1/recovery/?source=web', 'legacy'],
    ['/recovery/city', 'city'],
    ['/functions/v1/recovery/city', 'city'],
    ['/recovery/city/?source=web', 'city'],
  ] as const)('routes %s to %s and preserves the original request', async (path, target) => {
    const request = new Request(`https://edge.test${path}`, { method: 'POST', body: '{"trip":true}' })
    const observed: Request[] = []
    const legacy = vi.fn(async (input: Request) => { observed.push(input); return new Response('legacy') })
    const city = vi.fn(async (input: Request) => { observed.push(input); return new Response('city') })

    const response = await createRecoveryRouter({ legacy, city })(request)

    expect(await response.text()).toBe(target)
    expect(target === 'legacy' ? legacy : city).toHaveBeenCalledTimes(1)
    expect(target === 'legacy' ? city : legacy).not.toHaveBeenCalled()
    expect(observed[0]).toBe(request)
  })

  it.each([
    ['/recovery', 'legacy'],
    ['/functions/v1/recovery/city', 'city'],
  ] as const)('delegates %s before touching its body and forwards method unchanged', async (path, target) => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode('{}')); controller.close() } }, { highWaterMark: 0 })
    const request = new Request(`https://edge.test${path}`, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    let bodyUsedAtEntry: boolean | undefined
    let pullsAtEntry: number | undefined
    const handler = vi.fn(async (input: Request) => {
      bodyUsedAtEntry = input.bodyUsed
      pullsAtEntry = pulls
      return new Response(input.method)
    })
    const router = createRecoveryRouter({ legacy: handler, city: handler })

    const response = await router(request)

    expect(await response.text()).toBe('POST')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(bodyUsedAtEntry).toBe(false)
    expect(pullsAtEntry).toBe(0)
    expect(pulls).toBe(0)
  })

  it.each([
    ['/recovery', 'GET'],
    ['/recovery', 'OPTIONS'],
    ['/recovery/city', 'GET'],
    ['/recovery/city', 'OPTIONS'],
  ])('forwards %s method %s without applying method policy', async (path, method) => {
    const request = new Request(`https://edge.test${path}`, { method })
    const handler = vi.fn(async (input: Request) => new Response(input.method))

    const response = await createRecoveryRouter({ legacy: handler, city: handler })(request)

    expect(await response.text()).toBe(method)
    expect(handler).toHaveBeenCalledWith(request)
  })

  it.each([
    '/not/recovery',
    '/prefix/recovery',
    '/prefix/recovery/city',
    '/functions/v1/other/recovery/city',
    '/recovery/city/extra',
    '/Recovery',
  ])('returns a safe CORS 404 for unknown path %s', async path => {
    const legacy = vi.fn(async () => new Response('legacy'))
    const city = vi.fn(async () => new Response('city'))

    const response = await createRecoveryRouter({ legacy, city })(new Request(`https://edge.test${path}`))

    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.has('access-control-allow-credentials')).toBe(false)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'Not found.' })
    expect(legacy).not.toHaveBeenCalled()
    expect(city).not.toHaveBeenCalled()
  })
})
