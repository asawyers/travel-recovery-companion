import { Banknote, Clock3, MapPin } from 'lucide-react'
import { PriceHighlight } from '@/components/ui/companion'
import { formatItineraryDuration, ItineraryTime } from './ItineraryPresentation'

type TimedLeg = { mode: string; startAt: string; endAt: string }

export function travelModeLabel(mode: string): string {
  return ({ bus: 'Bus', rail: 'Train', subway: 'Subway', tram: 'Tram', ferry: 'Ferry', drive: 'Drive', walk: 'Walk', wait: 'Wait', flight: 'Flight', hotel: 'Overnight stay', processing: 'Airport processing', checkin: 'Check-in', transfer: 'Transfer' } as Record<string, string>)[mode] ?? mode
}

export function isTransferDetail(mode: string): boolean {
  return mode === 'walk' || mode === 'wait'
}

/** One visual anchor for the three facts a traveler compares first. */
export function ItinerarySummary({ arrivalAt, arrivalZone, destination, durationMinutes, amountCents, costLabel, costQualifier }: {
  arrivalAt?: string; arrivalZone?: string; destination?: string; durationMinutes: number;
  amountCents: number | null; costLabel: string; costQualifier: string
}) {
  return <div className="grid min-w-0 gap-4 rounded-xl border border-[var(--companion-border)] bg-[var(--companion-paper)] p-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,.8fr)_minmax(0,1fr)]">
    <div className="min-w-0 space-y-1">
      <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--companion-arrival)]"><MapPin className="size-4 shrink-0" aria-hidden="true" />Final city arrival</p>
      {arrivalAt && <ItineraryTime at={arrivalAt} zone={arrivalZone ?? 'UTC'} showDate className="companion-heading text-2xl font-semibold text-[var(--companion-arrival)]" />}
      {destination && <p className="text-sm font-medium [overflow-wrap:anywhere]">{destination}</p>}
    </div>
    <div className="min-w-0 space-y-1">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock3 className="size-4 shrink-0" aria-hidden="true" />Total travel time</p>
      <p className="companion-heading text-2xl font-semibold text-[var(--companion-navy)]">{formatItineraryDuration(durationMinutes)}</p>
    </div>
    <div className="flex min-w-0 items-start gap-1.5"><Banknote className="mt-0.5 size-4 shrink-0 text-[var(--companion-teal)]" aria-hidden="true" /><PriceHighlight amountCents={amountCents} label={costLabel} qualifier={costQualifier} /></div>
  </div>
}

export function WalkingAccessSummary({ legs }: { legs: TimedLeg[] }) {
  const walkingMinutes = legs.filter(leg => leg.mode === 'walk').reduce((total, leg) => total + Math.max(0, (Date.parse(leg.endAt) - Date.parse(leg.startAt)) / 60000), 0)
  if (!Number.isFinite(walkingMinutes) || walkingMinutes <= 0) return null
  const duration = Number.isInteger(walkingMinutes) ? String(walkingMinutes) : `about ${Math.ceil(walkingMinutes)}`
  return <p className="text-sm text-muted-foreground">Includes {duration} min walking; consider luggage and station access.</p>
}
