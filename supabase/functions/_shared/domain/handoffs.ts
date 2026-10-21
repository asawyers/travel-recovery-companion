export type TravelMode = 'walking' | 'driving' | 'transit'

export type HandoffId = 'amtrak' | 'concord' | 'kayak-bos' | 'hotel-search' | 'maps-directions'

export type ProviderHandoff = {
  id: HandoffId
  href: string
  label: string
  instructions: string
}

const registry: Record<Exclude<HandoffId, 'maps-directions'>, ProviderHandoff> = {
  amtrak: {
    id: 'amtrak', href: 'https://www.amtrak.com/home.html', label: 'Check train tickets',
    instructions: 'Enter your travel date, Boston origin, Portland, Maine destination, and preferred departure time on Amtrak.',
  },
  concord: {
    id: 'concord', href: 'https://concordcoachlines.com/book-your-trip/', label: 'Check bus tickets',
    instructions: 'Enter your travel date, Boston or Logan origin, Portland, Maine destination, and preferred departure time on Concord Coach Lines.',
  },
  'kayak-bos': {
    id: 'kayak-bos', href: 'https://www.kayak.com/Boston-Logan-Intl-Airport-Car-Rentals.BOS.cap.ksp', label: 'Search rental cars',
    instructions: 'Enter a one-way rental from Boston Logan (BOS) to Portland, Maine, with your pickup date and time and return date and time. Confirm the final location and total.',
  },
  'hotel-search': {
    id: 'hotel-search', href: 'https://www.google.com/travel/hotels', label: 'Search hotels',
    instructions: 'Search using the displayed property or area for the stay dates and occupancy. Confirm the property, room, cancellation terms, and total.',
  },
}

const mapOrigins = new Set(['https://www.google.com'])
const fixedPaths: Partial<Record<HandoffId, { origin: string; pathname: string }>> = {
  amtrak: { origin: 'https://www.amtrak.com', pathname: '/home.html' },
  concord: { origin: 'https://concordcoachlines.com', pathname: '/book-your-trip/' },
  'kayak-bos': { origin: 'https://www.kayak.com', pathname: '/Boston-Logan-Intl-Airport-Car-Rentals.BOS.cap.ksp' },
  'hotel-search': { origin: 'https://www.google.com', pathname: '/travel/hotels' },
}

function endpoint(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 500 || /[\u0000-\u001f\u007f]/.test(trimmed) || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    throw new TypeError('Directions endpoints must be bounded public place names, not URLs or control text.')
  }
  return trimmed
}

/** Build a Google Maps Directions URL using only its documented URL parameters. */
export function directions(origin: string, destination: string, travelmode: TravelMode): URL {
  if (!['walking', 'driving', 'transit'].includes(travelmode)) throw new TypeError('Unsupported travel mode.')
  const url = new URL('https://www.google.com/maps/dir/')
  url.search = new URLSearchParams({ api: '1', origin: endpoint(origin), destination: endpoint(destination), travelmode }).toString()
  if (url.toString().length > 2048) throw new TypeError('Directions URL exceeds the documented 2,048-character limit.')
  return url
}

/** Only fixed registry IDs resolve; arbitrary URL-shaped values are never interpreted as destinations. */
export function resolveHandoff(id: string | null | undefined): ProviderHandoff | null {
  if (!id || id === 'maps-directions' || !Object.hasOwn(registry, id)) return null
  return registry[id as keyof typeof registry]
}

/** Guard anchors at the rendering boundary, including Maps' narrow parameter allowlist. */
export function isAllowedHandoffUrl(id: string, href: string): boolean {
  if (href.length > 2048) return false
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
    if (id === 'maps-directions') {
      if (!mapOrigins.has(url.origin) || url.pathname !== '/maps/dir/') return false
      const entries = [...url.searchParams.entries()]
      return entries.length === 4 && new Set(entries.map(([key]) => key)).size === 4 &&
        url.searchParams.get('api') === '1' &&
        Boolean(url.searchParams.get('origin')) && Boolean(url.searchParams.get('destination')) &&
        ['walking', 'driving', 'transit'].includes(url.searchParams.get('travelmode') ?? '') &&
        [...url.searchParams.values()].every(value => value.length <= 500)
    }
    const expected = fixedPaths[id as keyof typeof fixedPaths]
    if (!expected || url.origin !== expected.origin || url.pathname !== expected.pathname || url.search) return false
    return resolveHandoff(id)?.href === url.toString()
  } catch {
    return false
  }
}
