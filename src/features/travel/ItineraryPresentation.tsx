import type { ReactNode } from 'react'
import { ArrowRight, Bus, Car, Clock3, Footprints, Hotel, MapPin, Plane, Ship, TrainFront, TramFront } from 'lucide-react'

export type PresentationLeg = {
  id: string; mode: string; startAt: string; endAt: string
  from: { name: string; timeZone?: string }; to: { name: string; timeZone?: string }
  departureTimeZone?: string; arrivalTimeZone?: string
  operator?: string | null; service?: string | null; assumptions?: string[]
}
export function itineraryLegZone(leg: PresentationLeg, endpoint: 'departure' | 'arrival'): string {
  return endpoint === 'departure' ? leg.departureTimeZone ?? leg.from.timeZone ?? 'UTC' : leg.arrivalTimeZone ?? leg.to.timeZone ?? 'UTC'
}
function localFormat(at: string, zone: string, options: Intl.DateTimeFormatOptions): string {
  try { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone }).format(new Date(at)) }
  catch { return at }
}
export const formatItineraryClock = (at: string, zone: string) => localFormat(at, zone, { hour: 'numeric', minute: '2-digit', hour12: true })
export const formatItineraryDate = (at: string, zone: string) => localFormat(at, zone, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
function zoneName(at: string, zone: string, style: 'short' | 'longOffset'): string {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style }).formatToParts(new Date(at)).find(part => part.type === 'timeZoneName')?.value.replace('GMT', 'UTC') ?? zone }
  catch { return zone }
}
export function formatItineraryDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return 'Duration unavailable'
  if (minutes === 0) return '0 min'
  const rounded = Math.ceil(minutes)
  return rounded < 60 ? `${rounded} min` : `${Math.floor(rounded / 60)} hr${rounded % 60 ? ` ${rounded % 60} min` : ''}`
}
export function itineraryMinutes(leg: Pick<PresentationLeg, 'startAt' | 'endAt'>): number {
  return (Date.parse(leg.endAt) - Date.parse(leg.startAt)) / 60_000
}
export function ItineraryTime({ at, zone, showDate = false, showZone = false, className = '' }: { at: string; zone: string; showDate?: boolean; showZone?: boolean; className?: string }) {
  const full = `${formatItineraryDate(at, zone)}, ${formatItineraryClock(at, zone)} ${zoneName(at, zone, 'short')} (${zoneName(at, zone, 'longOffset')}; ${zone})`
  return <time dateTime={at} title={full} aria-label={full} className={className}>{formatItineraryClock(at, zone)}{showZone && <span className="ml-1 text-xs font-normal">{zoneName(at, zone, 'short')}</span>}{showDate && <span className="mt-1 block text-xs font-normal text-muted-foreground">{formatItineraryDate(at, zone)}</span>}</time>
}
export function ModeIcon({ mode, className = 'size-4' }: { mode: string; className?: string }) {
  const Icon = ({ bus: Bus, rail: TrainFront, subway: TrainFront, tram: TramFront, ferry: Ship, drive: Car, transfer: MapPin, walk: Footprints, wait: Clock3, flight: Plane, hotel: Hotel, checkin: Hotel, processing: Clock3 } as Record<string, typeof Bus>)[mode] ?? MapPin
  return <Icon aria-hidden="true" className={className} strokeWidth={1.7} />
}
function endpoints(legs: PresentationLeg[]) {
  return legs.flatMap(leg => [{ at: leg.startAt, zone: itineraryLegZone(leg, 'departure') }, { at: leg.endAt, zone: itineraryLegZone(leg, 'arrival') }])
}
export function RouteTimeLegend({ legs }: { legs: PresentationLeg[] }) {
  const points = endpoints(legs)
  if (!points.length) return null
  const labels = [...new Set(points.map(point => `${zoneName(point.at, point.zone, 'short')} (${zoneName(point.at, point.zone, 'longOffset')})`))]
  const first = points[0], last = points.at(-1)!
  const firstDate = formatItineraryDate(first.at, first.zone), lastDate = formatItineraryDate(last.at, last.zone)
  return <p className="text-xs leading-relaxed text-muted-foreground" aria-label="Route dates and time zones">{firstDate}{lastDate !== firstDate && <> → {lastDate}</>}<span className="mx-1.5" aria-hidden="true">·</span>Local times · {labels.join(' / ')}</p>
}
const transfer = (leg: PresentationLeg) => leg.mode === 'walk' || leg.mode === 'wait'
export function groupItineraryLegs(legs: PresentationLeg[]): PresentationLeg[][] {
  const groups: PresentationLeg[][] = []
  for (const leg of legs) {
    const prior = groups.at(-1), previous = prior?.at(-1)
    if (prior && previous && transfer(previous) && transfer(leg) && Date.parse(previous.endAt) === Date.parse(leg.startAt)) prior.push(leg)
    else groups.push([leg])
  }
  return groups
}
const knownPlace = (name: string) => name.trim().length > 0 && !/^Provider walking step (start|end)$/i.test(name.trim())
function groupPlaces(legs: PresentationLeg[], group: PresentationLeg[]) {
  const first = group[0], last = group.at(-1)!, firstIndex = legs.indexOf(first), lastIndex = legs.indexOf(last)
  const from = [first.from.name, legs[firstIndex - 1]?.to.name, ...group.map(leg => leg.from.name)].find(name => name && knownPlace(name)) ?? 'Route access point'
  const to = [last.to.name, legs[lastIndex + 1]?.from.name, ...[...group].reverse().map(leg => leg.to.name)].find(name => name && knownPlace(name)) ?? 'Route access point'
  return { from, to }
}
function groupLabel(group: PresentationLeg[]) {
  const modes = new Set(group.map(leg => leg.mode))
  if (modes.has('walk') && modes.has('wait')) return 'Walk & wait'
  return ({ walk: 'Walk', wait: 'Wait', flight: 'Flight', hotel: 'Hotel stay', checkin: 'Check-in', processing: 'Airport processing', transfer: 'Transfer', bus: 'Bus', rail: 'Train', subway: 'Subway', tram: 'Tram', ferry: 'Ferry', drive: 'Drive' } as Record<string, string>)[group[0].mode] ?? group[0].mode
}
export function ItineraryTimeline({ legs, renderDetails }: { legs: PresentationLeg[]; renderDetails?: (leg: PresentationLeg) => ReactNode }) {
  const groups = groupItineraryLegs(legs)
  const multiZone = new Set(endpoints(legs).map(point => zoneName(point.at, point.zone, 'longOffset'))).size > 1
  return <ol className="space-y-4">{groups.map((group, index) => {
    const first = group[0], last = group.at(-1)!, depZone = itineraryLegZone(first, 'departure'), arrZone = itineraryLegZone(last, 'arrival')
    const duration = group.reduce((sum, leg) => sum + itineraryMinutes(leg), 0), places = groupPlaces(legs, group)
    const prior = groups[index - 1]?.at(-1)
    const depDate = formatItineraryDate(first.startAt, depZone), arrDate = formatItineraryDate(last.endAt, arrZone)
    const showStartDate = !prior || depDate !== formatItineraryDate(prior.endAt, itineraryLegZone(prior, 'arrival'))
    const walking = group.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + itineraryMinutes(leg), 0)
    const waiting = group.filter(leg => leg.mode === 'wait').reduce((sum, leg) => sum + itineraryMinutes(leg), 0)
    return <li key={first.id} aria-label={`Route step ${index + 1}`} className="flex min-w-0 gap-3 text-sm">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--companion-paper)] text-[var(--companion-teal)]"><ModeIcon mode={group.some(leg => leg.mode === 'walk') ? 'walk' : first.mode} /></span>
      <div className="min-w-0 flex-1 space-y-2 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="font-semibold text-[var(--companion-navy)]">{groupLabel(group)}{!transfer(first) && first.operator && <> · {first.operator}</>}{group.length === 1 && first.service && <> <span className="font-normal">{first.service}</span></>}</p><span className="shrink-0 text-xs font-medium text-muted-foreground">{formatItineraryDuration(duration)}</span></div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2"><div><ItineraryTime at={first.startAt} zone={depZone} showDate={showStartDate} showZone={multiZone} className="font-semibold" /><p className="mt-1 text-xs text-muted-foreground">{places.from}</p></div><ArrowRight className="mt-1 size-3.5 text-muted-foreground" aria-hidden="true" /><div className="text-right"><ItineraryTime at={last.endAt} zone={arrZone} showDate={depDate !== arrDate} showZone={multiZone} className="font-semibold text-[var(--companion-arrival)]" /><p className="mt-1 text-xs text-muted-foreground">{places.to}</p></div></div>
        {group.length > 1 && <p className="text-xs text-muted-foreground">{group.some(leg => leg.mode === 'walk') && `${formatItineraryDuration(walking)} walking`}{group.some(leg => leg.mode === 'walk') && group.some(leg => leg.mode === 'wait') && ' · '}{group.some(leg => leg.mode === 'wait') && `${formatItineraryDuration(waiting)} waiting`}</p>}
        {group.length > 1 ? <details className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">Walking and waiting details ({group.length})</summary><ol className="mt-2 space-y-3 border-l border-[var(--companion-border)] pl-3">{group.map((leg, step) => <li key={leg.id}><p className="font-medium">{groupLabel([leg])}{leg.service && <> · {leg.service}</>} · {formatItineraryDuration(itineraryMinutes(leg))}</p><p><ItineraryTime at={leg.startAt} zone={itineraryLegZone(leg, 'departure')} showZone={multiZone} /> → <ItineraryTime at={leg.endAt} zone={itineraryLegZone(leg, 'arrival')} showDate={formatItineraryDate(leg.startAt, itineraryLegZone(leg, 'departure')) !== formatItineraryDate(leg.endAt, itineraryLegZone(leg, 'arrival'))} showZone={multiZone} /></p><p className="text-muted-foreground">{knownPlace(leg.from.name) ? leg.from.name : `Access point ${step + 1}`} → {knownPlace(leg.to.name) ? leg.to.name : `Access point ${step + 2}`}</p>{renderDetails?.(leg)}</li>)}</ol></details> : renderDetails?.(first)}
      </div>
    </li>
  })}</ol>
}
const WALK_ESTIMATE = 'Walking duration and its start/end times are estimated from provider step duration; confirm pedestrian access and transfer time.'
const ZONE_ESTIMATE = 'Stop time zone is estimated from the nearest selected endpoint when the provider omits its stop time zone; timestamp instants are preserved.'
export function itineraryRouteNotes(legs: PresentationLeg[], notes: string[] = []): string[] {
  const all = [...new Set([...notes, ...legs.flatMap(leg => leg.assumptions ?? [])].map(note => note.trim()).filter(Boolean))]
  const walking = legs.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + itineraryMinutes(leg), 0)
  const suppliedWalkingSummary = all.find(note => /^Includes .+ min walking; consider luggage and station access\.$/.test(note))
  const walkingSummary = walking > 0 && Number.isFinite(walking) ? `Includes ${Number.isInteger(walking) ? walking : `about ${Math.ceil(walking)}`} min walking; consider luggage and station access.` : suppliedWalkingSummary
  const result = all.filter(note => !/^Includes .+ min walking; consider luggage and station access\.$/.test(note) && note !== 'Times are shown in local time zones.' && note !== WALK_ESTIMATE && note !== ZONE_ESTIMATE)
  if (walkingSummary) result.unshift(walkingSummary)
  if (all.includes(WALK_ESTIMATE)) result.push('Walking times are estimated; confirm pedestrian access and transfer time.')
  if (all.includes(ZONE_ESTIMATE)) result.push('Stop time zones are estimated from the nearest route endpoint when the provider omits them; original timestamp instants are preserved.')
  return [...new Set(result)]
}
export function RouteNotes({ legs, notes = [] }: { legs: PresentationLeg[]; notes?: string[] }) {
  const unique = itineraryRouteNotes(legs, notes)
  if (!unique.length) return null
  const walkingSummary = unique.find(note => /^Includes .+ min walking; consider luggage and station access\.$/.test(note))
  const details = unique.filter(note => note !== walkingSummary)
  return <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">{walkingSummary && <p>{walkingSummary}</p>}{details.length > 0 && <details><summary className="cursor-pointer py-1 font-medium">Route notes</summary><ul aria-label="Route notes" className="mt-2 space-y-2">{details.map(note => <li key={note}>{note}</li>)}</ul></details>}</div>
}
