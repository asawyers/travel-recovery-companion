import { describe, expect, it } from 'vitest'
import * as handoffs from '@domain/handoffs'
import type { HotelOption } from '@domain/schemas'

type HotelHandoff = Pick<HotelOption, 'id' | 'checkin' | 'checkout' | 'adults' | 'rooms' | 'handoffId'>
const origin = 'https://recovery.nuitee.link'
const hotel = (changes: Partial<HotelHandoff> = {}): HotelHandoff => ({
  id: 'lp4aa75', checkin: '2026-11-18', checkout: '2026-11-19', adults: 1, rooms: 1,
  handoffId: 'nuitee-hotel', ...changes,
})
const fallback = () => handoffs.resolveHandoff('hotel-search')

describe('configured hosted hotel handoffs', () => {
  it('accepts one exact HTTPS origin, including an operator-configured custom domain', () => {
    expect(handoffs.configuredHotelOrigin).toBeTypeOf('function')
    expect(handoffs.configuredHotelOrigin(origin)).toBe(origin)
    expect(handoffs.configuredHotelOrigin('https://stays.example.com')).toBe('https://stays.example.com')
  })

  it.each([
    undefined, '', 'http://recovery.nuitee.link', 'https://*.nuitee.link',
    'https://user:pass@recovery.nuitee.link', 'https://recovery.nuitee.link:443',
    'https://recovery.nuitee.link:8443', 'https://recovery.nuitee.link/',
    'https://recovery.nuitee.link/hotels', 'https://recovery.nuitee.link?',
    'https://recovery.nuitee.link#', ' https://recovery.nuitee.link',
    'https://recovery.nuitee.link\n', 'https://recovery.nuitee.link\\evil',
    'https://recovery.nuitee.link.', `https://${'a'.repeat(254)}.nuitee.link`,
  ])('rejects an unsafe origin configuration: %s', (value) => {
    expect(handoffs.configuredHotelOrigin(value)).toBeNull()
  })

  it('builds the property page with dates and base64 array occupancy only', () => {
    const result = handoffs.resolveHotelHandoff(hotel(), origin)
    expect(result.id).toBe('nuitee-hotel')
    const url = new URL(result.href)
    expect(url.origin).toBe(origin)
    expect(url.pathname).toBe('/hotels/lp4aa75')
    expect([...url.searchParams.keys()]).toEqual(['checkin', 'checkout', 'occupancies'])
    expect(url.searchParams.get('checkin')).toBe('2026-11-18')
    expect(url.searchParams.get('checkout')).toBe('2026-11-19')
    expect(JSON.parse(atob(url.searchParams.get('occupancies')!))).toEqual([{ adults: 1, children: [] }])
    expect(result.instructions).toMatch(/confirm.*property/i)
    expect(result.instructions).toMatch(/price|total/i)
    expect(result.instructions).toMatch(/does not book/i)
    expect(handoffs.isAllowedHandoffUrl(result.id, result.href, origin)).toBe(true)
    expect(handoffs.resolveHandoff('nuitee-hotel')).toBeNull()
  })

  it('falls back when the provider, domain, dates, occupancy or hotel identity is unavailable', () => {
    expect(handoffs.resolveHotelHandoff(hotel())).toEqual(fallback())
    expect(handoffs.resolveHotelHandoff(hotel(), 'https://*.nuitee.link')).toEqual(fallback())
    expect(handoffs.resolveHotelHandoff(hotel({ handoffId: 'hotel-search' }), origin)).toEqual(fallback())
    for (const id of ['', '..', '../booking', 'lp/id', 'lp%2Fid', 'lp?id', 'a'.repeat(101), ' lp123', 'lp123\n']) {
      expect(handoffs.resolveHotelHandoff(hotel({ id }), origin)).toEqual(fallback())
    }
    for (const changes of [
      { checkin: '2026-02-30' }, { checkout: '2026-11-18' }, { checkout: '2026-11-17' },
      { checkout: '2026-11-20' }, { checkout: '2026-11-19T00:00:00Z' },
      { adults: 2 }, { rooms: 2 },
    ]) expect(handoffs.resolveHotelHandoff(hotel(changes as Partial<HotelHandoff>), origin)).toEqual(fallback())
  })

  it('accepts calendar month and leap-year boundaries', () => {
    expect(handoffs.resolveHotelHandoff(hotel({ checkin: '2028-02-29', checkout: '2028-03-01' }), origin).id).toBe('nuitee-hotel')
    expect(handoffs.resolveHotelHandoff(hotel({ checkin: '2026-12-31', checkout: '2027-01-01' }), origin).id).toBe('nuitee-hotel')
  })

  it('rejects other domains, redirects, checkout, unsafe paths and hidden URL normalization', () => {
    const valid = handoffs.resolveHotelHandoff(hotel(), origin).href
    expect(handoffs.isAllowedHandoffUrl('nuitee-hotel', valid)).toBe(false)
    for (const href of [
      valid.replace('recovery.nuitee.link', 'other.nuitee.link'),
      valid.replace('recovery.nuitee.link', 'recovery.nuitee.link.evil.example'),
      valid.replace('https:', 'http:'), valid.replace('https://', 'https://user:pass@'),
      valid.replace('recovery.nuitee.link', 'recovery.nuitee.link:443'), `${valid}#`,
      valid.replace('/hotels/lp4aa75', '/booking'), valid.replace('/hotels/lp4aa75', '/hotels/../hotels/lp4aa75'),
      valid.replace('/hotels/lp4aa75', '/hotels/%2e%2e/hotels/lp4aa75'),
      valid.replace('/hotels/lp4aa75', '/hotels/lp%2Fid'), valid.replace('/hotels/', '//hotels/'),
      ` ${valid}`, `${valid}\n`, valid.replace('/hotels/', '\\hotels/'),
    ]) expect(handoffs.isAllowedHandoffUrl('nuitee-hotel', href, origin)).toBe(false)
  })

  it('rejects duplicate, private, offer and prebook parameters and invalid occupancy payloads', () => {
    const valid = handoffs.resolveHotelHandoff(hotel(), origin).href
    for (const extra of ['checkin=2026-11-18', 'email=traveler%40example.com', 'guestNationality=US', 'offerId=offer', 'prebookId=prebook', 'redirect=https%3A%2F%2Fevil.example']) {
      expect(handoffs.isAllowedHandoffUrl('nuitee-hotel', `${valid}&${extra}`, origin)).toBe(false)
    }
    for (const occupancy of ['invalid', btoa('{"adults":1,"children":[]}'), btoa('[{"adults":2,"children":[]}]'), btoa('[{"adults":1,"children":[],"email":"private"}]')]) {
      const url = new URL(valid); url.searchParams.set('occupancies', occupancy)
      expect(handoffs.isAllowedHandoffUrl('nuitee-hotel', url.toString(), origin)).toBe(false)
    }
    const badDate = new URL(valid); badDate.searchParams.set('checkout', '2026-02-30')
    expect(handoffs.isAllowedHandoffUrl('nuitee-hotel', badDate.toString(), origin)).toBe(false)
    const missing = new URL(valid); missing.searchParams.delete('occupancies')
    expect(handoffs.isAllowedHandoffUrl('nuitee-hotel', missing.toString(), origin)).toBe(false)
    expect(handoffs.isAllowedHandoffUrl('nuitee-hotel', `${valid}&x=${'a'.repeat(2048)}`, origin)).toBe(false)
  })
})
