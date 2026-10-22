import type { TravelJourney } from '@domain/travel-contracts'
import { Button } from '@/components/ui/button'
import { formatTravelTime, travelEvidenceFresh, travelMoney, TravelCosts, TravelEvidence } from './FlightOffers'
export function TravelJourneyCard({ journey, selected = false, busy = false, onSelect, onExpired }: {
  journey: TravelJourney; selected?: boolean; busy?: boolean; onSelect: (journey: TravelJourney) => void; onExpired?: () => void
}) {
  const fresh = () => travelEvidenceFresh(journey.evidence.filter(source => source.type !== 'traveler_confirmed'), journey.evidenceExpiresAt)
  const eligible = journey.selectable && journey.feasibility === 'requires_confirmation' && journey.violations.length === 0
  return <article aria-label="Complete journey" className="rounded-lg border bg-white p-5 space-y-4">
    <div><h2 className="text-lg font-semibold">{journey.title}</h2><p className="text-sm">Known costs {travelMoney(journey.knownCostCents)} USD{journey.priceComplete ? '' : ' · total incomplete; unknown costs remain'}</p><p className="text-sm text-muted-foreground">{journey.boardings} flights · {journey.transfers} connections · {journey.durationMinutes} minutes overall</p></div>
    <ol className="space-y-4 border-l pl-4">{journey.legs.map((leg, index) => <li key={leg.id} aria-label={`Journey leg ${index + 1}`} className="space-y-1 text-sm">
      <h3 className="font-medium">{leg.kind} {leg.operator} {leg.service}</h3>
      <p>{leg.from.name} · {formatTravelTime(leg.startAt, leg.from.timeZone)}</p>
      <p>{leg.to.name} · {formatTravelTime(leg.endAt, leg.to.timeZone)}</p>
      <TravelCosts costs={leg.costs} />
      <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Source for this leg</summary><div className="mt-2"><TravelEvidence evidence={leg.evidence} /></div></details>
      {leg.assumptions.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
    </li>)}</ol>
    {journey.violations.length > 0 && <div role="alert" className="text-sm text-destructive"><p>This journey needs changes.</p><ul>{journey.violations.map(note => <li key={note}>{note}</li>)}</ul></div>}
    {[...journey.warnings, ...journey.confirmations].map(note => <p key={note} className="text-sm text-muted-foreground">{note}</p>)}
    <details className="text-sm"><summary className="cursor-pointer">Source and freshness</summary><div className="mt-2"><TravelEvidence evidence={journey.evidence} /><p className="text-xs">Journey evidence expires {journey.evidenceExpiresAt ?? 'at the next source refresh'}.</p></div></details>
    <Button disabled={busy || !eligible} onClick={() => { if (!eligible) return; if (!fresh()) { onExpired?.(); return } onSelect(journey) }}>{selected ? 'Chosen journey' : 'Choose this journey'}</Button>
  </article>
}
