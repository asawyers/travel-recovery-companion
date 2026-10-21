import { describe, expect, it } from 'vitest'
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

  it('keeps privacy red herrings out of generated destinations', () => {
    const privateContext = { email: 'traveler@example.com', nationality: 'Example', narrative: 'medical details' }
    const hrefs = [
      handoffs.resolveHandoff('amtrak')?.href,
      handoffs.resolveHandoff('concord')?.href,
      handoffs.resolveHandoff('kayak-bos')?.href,
      handoffs.resolveHandoff('hotel-search')?.href,
      handoffs.directions('BOS', 'Portland, Maine', 'driving').toString(),
    ].join('\n')
    expect(hrefs).not.toContain(privateContext.email)
    expect(hrefs).not.toContain(privateContext.nationality)
    expect(hrefs).not.toContain(privateContext.narrative)
  })
})
