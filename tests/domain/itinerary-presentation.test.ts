import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatItineraryDuration, groupItineraryLegs, itineraryMinutes, itineraryRouteNotes, ItineraryTimeline, ItineraryTime, RouteNotes, RouteTimeLegend, type PresentationLeg } from '../../src/features/travel/ItineraryPresentation'

function leg(id: string, mode: string, startAt: string, endAt: string, from = 'Provider walking step start', to = 'Provider walking step end'): PresentationLeg {
  return { id, mode, startAt, endAt, from: { name: from, timeZone: 'America/New_York' }, to: { name: to, timeZone: 'America/New_York' }, assumptions: [] }
}
const route = [
  leg('access', 'walk', '2026-11-19T23:40:00-05:00', '2026-11-19T23:42:30-05:00', 'Airport terminal'),
  leg('access-2', 'walk', '2026-11-19T23:42:30-05:00', '2026-11-19T23:45:00-05:00'),
  leg('zero-walk', 'walk', '2026-11-19T23:45:00-05:00', '2026-11-19T23:45:00-05:00'),
  leg('waiting', 'wait', '2026-11-19T23:45:00-05:00', '2026-11-19T23:53:00-05:00'),
  { ...leg('coach', 'bus', '2026-11-19T23:53:00-05:00', '2026-11-20T01:53:00-05:00', 'Airport bus station', 'Portland terminal'), operator: 'Concord Coach', service: 'Portland Express 42' },
  leg('final', 'walk', '2026-11-20T01:53:00-05:00', '2026-11-20T01:59:00-05:00', 'Portland terminal', 'Portland city center'),
]

describe('itinerary presentation facts', () => {
  it('keeps complete timestamps accessible while presenting local clocks and readable dates', () => {
    const html = renderToStaticMarkup(createElement(ItineraryTime, { at: route[0].startAt, zone: 'America/New_York', showDate: true }))
    expect(html).toContain('dateTime="2026-11-19T23:40:00-05:00"')
    expect(html).toContain('11:40 PM')
    expect(html).toContain('Thu, Nov 19, 2026')
    expect(html).toContain('America/New_York')
    expect(html).toContain('UTC-05:00')
  })
  it('combines adjacent transfer steps without losing vehicles, fractional minutes or zero-duration steps', () => {
    const groups = groupItineraryLegs(route)
    expect(groups.map(group => group.map(step => step.id))).toEqual([['access', 'access-2', 'zero-walk', 'waiting'], ['coach'], ['final']])
    expect(groups[0].reduce((sum, step) => sum + itineraryMinutes(step), 0)).toBe(13)
    expect(formatItineraryDuration(2.5)).toBe('3 min')
    expect(formatItineraryDuration(0)).toBe('0 min')
    expect(formatItineraryDuration(125)).toBe('2 hr 5 min')
    const html = renderToStaticMarkup(createElement(ItineraryTimeline, { legs: route }))
    expect(html).toContain('Walk &amp; wait')
    expect(html).toContain('5 min walking')
    expect(html).toContain('8 min waiting')
    expect(html).toContain('Walking and waiting details (4)')
    expect(html).toContain('0 min')
    expect(html).toContain('Portland Express 42')
    expect(html).toContain('Airport bus station')
    expect(html).toContain('Fri, Nov 20, 2026')
    expect(html).not.toContain('Provider walking step')
    for (const step of route) expect(html).toContain(`dateTime="${step.startAt}"`)
  })
  it('anchors the first visible ride to its departure date after omitted overnight transfers', () => {
    const bus = leg('overnight-bus', 'bus', '2026-11-19T00:15:00-05:00', '2026-11-19T01:15:00-05:00', 'Airport bus station', 'Portland terminal')
    const html = renderToStaticMarkup(createElement(ItineraryTimeline, { legs: [bus] }))
    const visible = html.replace(/<[^>]+>/g, '')
    expect(visible).toContain('12:15 AM')
    expect(visible).toContain('Thu, Nov 19, 2026')
    expect(visible).toContain('1:15 AM')
  })
  it('does not combine transfers across an unexplained timing gap', () => {
    const second = { ...route[1], startAt: '2026-11-19T23:43:00-05:00' }
    expect(groupItineraryLegs([route[0], second])).toHaveLength(2)
  })
  it('shows actual endpoint UTC offsets across daylight saving changes and different zones', () => {
    const fallback = leg('fallback', 'rail', '2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00', 'Boston', 'Portland')
    expect(itineraryMinutes(fallback)).toBe(60)
    const html = renderToStaticMarkup(createElement(RouteTimeLegend, { legs: [fallback] }))
    expect(html).toContain('EDT (UTC-04:00)')
    expect(html).toContain('EST (UTC-05:00)')
    const crossZone = { ...fallback, from: { name: 'Chicago', timeZone: 'America/Chicago' } }
    expect(renderToStaticMarkup(createElement(RouteTimeLegend, { legs: [crossZone] }))).toContain('CDT (UTC-05:00)')
    expect(renderToStaticMarkup(createElement(ItineraryTimeline, { legs: [fallback] }))).toContain('1 hr')
  })
  it('keeps the walking total visible and preserves other unique notes in a closed disclosure', () => {
    const warning = 'Airport endpoint within 2 km; confirm actual boarding access.'
    const diagnostic = 'Provider route starts at 42.36, -71.01.'
    const html = renderToStaticMarkup(createElement(RouteNotes, { legs: route, notes: [warning, warning, diagnostic, 'Nothing is reserved.'] }))
    const visible = html.slice(0, html.indexOf('<details'))
    expect(visible).toContain('Includes 11 min walking; consider luggage and station access.')
    expect(visible).not.toContain(warning)
    expect(visible).not.toContain(diagnostic)
    expect(html).toContain('>Route notes</summary>')
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|>)/)
    expect(html.split(warning)).toHaveLength(2)
    expect(html).toContain(diagnostic)
    expect(html).toContain('Nothing is reserved.')
  })
  it('deduplicates qualifications once while retaining unrecognized warnings and confirmations', () => {
    const walkWarning = 'Walking duration and its start/end times are estimated from provider step duration; confirm pedestrian access and transfer time.'
    const zoneWarning = 'Stop time zone is estimated from the nearest selected endpoint when the provider omits its stop time zone; timestamp instants are preserved.'
    const legs = route.map(step => ({ ...step, assumptions: [walkWarning, zoneWarning, 'Special platform lift unavailable'] }))
    const notes = itineraryRouteNotes(legs, ['Special platform lift unavailable', 'Confirm tickets; nothing is reserved.', 'Times are shown in local time zones.'])
    expect(notes.filter(note => note.includes('11 min walking'))).toHaveLength(1)
    expect(notes.filter(note => note.includes('Stop time zones'))).toHaveLength(1)
    expect(notes.filter(note => note === 'Special platform lift unavailable')).toHaveLength(1)
    expect(notes).toContain('Confirm tickets; nothing is reserved.')
    expect(notes).not.toContain('Times are shown in local time zones.')
  })
})
