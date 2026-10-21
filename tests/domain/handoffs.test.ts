import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { overnightFixture } from '@domain/fixtures'
import { planRecovery } from '@domain/planner'
import { TripRequestSchema } from '@domain/schemas'
import { ItineraryPanel } from '../../src/features/recovery/ItineraryPanel'
import * as handoffs from '@domain/handoffs'

describe('verified handoff destinations', () => {
  it.each([
    ['amtrak', 'https://www.amtrak.com/home.html', 'Check train tickets'],
    ['concord', 'https://concordcoachlines.com/book-your-trip/', 'Check bus tickets'],
    ['kayak-bos', 'https://www.kayak.com/Boston-Logan-Intl-Airport-Car-Rentals.BOS.cap.ksp', 'Search rental cars'],
  ])('resolves the fixed %s operator entry point', (id, href, label) => {
    expect(handoffs.resolveHandoff(id)).toMatchObject({ id, href, label })
  })

  it('encodes Maps endpoints and includes only documented parameters', () => {
    const url = handoffs.directions('BOS & Logan', 'Portland, Maine 🚉', 'transit')
    expect(url.origin).toBe('https://www.google.com')
    expect(url.pathname).toBe('/maps/dir/')
    expect([...url.searchParams.entries()]).toEqual([
      ['api', '1'], ['origin', 'BOS & Logan'], ['destination', 'Portland, Maine 🚉'], ['travelmode', 'transit'],
    ])
  })

  it('bounds Maps input and rejects arbitrary URLs, empty endpoints and unsupported modes', () => {
    expect(() => handoffs.directions('a'.repeat(501), 'Portland, ME', 'driving')).toThrow()
    expect(() => handoffs.directions('é'.repeat(350), 'Portland, ME', 'driving')).toThrow()
    expect(() => handoffs.directions('https://evil.example', 'Portland, ME', 'driving')).toThrow()
    expect(() => handoffs.directions('BOS', '', 'driving')).toThrow()
    expect(() => handoffs.directions('BOS', 'Portland', 'bicycling' as never)).toThrow()
  })

  it('never resolves model supplied URLs or an unavailable hotel provider', () => {
    expect(handoffs.resolveHandoff('https://amtrak.com/')).toBeNull()
    expect(handoffs.resolveHandoff('unknown')).toBeNull()
    expect(handoffs.resolveHandoff('constructor')).toBeNull()
    expect(handoffs.resolveHandoff('toString')).toBeNull()
    expect(handoffs.resolveHandoff('nuitee-hotel')).toBeNull()
    expect(handoffs.resolveHandoff('hotel-search')?.href).toBe('https://www.google.com/travel/hotels')
    expect(handoffs.resolveHandoff('hotel-search')?.instructions).toContain('displayed property or area')
  })

  it('validates exact HTTPS host, credentials, port, path and Maps query allowlists', () => {
    expect(handoffs.isAllowedHandoffUrl('amtrak', 'https://www.amtrak.com/home.html')).toBe(true)
    for (const href of [
      'http://www.amtrak.com/home.html',
      'https://user:pass@www.amtrak.com/home.html',
      'https://www.amtrak.com.evil.example/home.html',
      'https://www.amtrak.com:444/home.html',
      'https://www.amtrak.com:443/home.html',
      'https://www.amtrak.com/redirect?to=https://evil.example',
    ]) expect(handoffs.isAllowedHandoffUrl('amtrak', href)).toBe(false)

    const map = handoffs.directions('BOS', 'Portland, ME', 'driving').toString()
    expect(handoffs.isAllowedHandoffUrl('maps-directions', map)).toBe(true)
    expect(handoffs.isAllowedHandoffUrl('maps-directions', map.replace('www.google.com', 'www.google.com:443'))).toBe(false)
    expect(handoffs.isAllowedHandoffUrl('maps-directions', `${map}&departure_time=tomorrow`)).toBe(false)
    expect(handoffs.isAllowedHandoffUrl('maps-directions', map.replace('www.google.com', 'google.com.evil.example'))).toBe(false)
    expect(handoffs.isAllowedHandoffUrl('maps-directions', `${map}&origin=${'x'.repeat(2100)}`)).toBe(false)
  })

  it('omits accepted nationality and rejects private extras in rendered handoff links', () => {
    const fixture = overnightFixture()
    expect(fixture.request.stay?.guestNationality).toBe('US')
    expect(TripRequestSchema.safeParse({
      ...fixture.request,
      email: 'traveler@example.com',
      narrative: 'medical details',
    }).success).toBe(false)

    const result = planRecovery(fixture.request, fixture.candidates, { now: fixture.now })
    const plan = result.plans.find((item) => item.id === 'hotel-bus')
    expect(plan).toBeDefined()
    const html = renderToStaticMarkup(createElement(ItineraryPanel, { plan, result }))
    const hrefs = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1])

    expect(hrefs.length).toBeGreaterThan(0)
    expect(hrefs.join('\n')).not.toContain(fixture.request.stay?.guestNationality)
    expect(hrefs).toContain('https://www.google.com/travel/hotels')
    expect(hrefs).toContain('https://concordcoachlines.com/book-your-trip/')
  })
})
