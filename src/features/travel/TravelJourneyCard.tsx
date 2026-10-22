import type { TravelJourney } from '@domain/travel-contracts'
import { Button } from '@/components/ui/button'
import { PriceHighlight } from '@/components/ui/companion'
import { formatTravelTime, travelEvidenceFresh, quotedTravelAmount, TravelCosts, TravelEvidence } from './FlightOffers'
export function TravelJourneyCard({ journey, selected = false, busy = false, onSelect, onExpired }: {
  journey: TravelJourney; selected?: boolean; busy?: boolean; onSelect: (journey: TravelJourney) => void; onExpired?: () => void
}) {
  const fresh = () => travelEvidenceFresh(journey.evidence.filter(source => source.type !== 'traveler_confirmed'), journey.evidenceExpiresAt)
  const eligible = journey.selectable && journey.feasibility === 'requires_confirmation' && journey.violations.length === 0
  const finalLeg = journey.legs.at(-1)
  return <article aria-label="Complete journey" className={`min-w-0 space-y-5 rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ${selected ? 'border-[var(--companion-teal)] ring-1 ring-[var(--companion-teal)]' : 'border-[var(--companion-border)]'}`}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1 space-y-2"><p className="text-xs font-medium text-[var(--companion-teal)]">Complete journey</p><h2 className="companion-heading text-xl font-semibold">{journey.title}</h2><p className="text-sm text-muted-foreground">{journey.boardings} flights · {journey.transfers} connections · {journey.durationMinutes} minutes overall</p></div><PriceHighlight amountCents={quotedTravelAmount(journey.costs) === null ? null : journey.knownCostCents} label="Known costs" qualifier={journey.priceComplete ? 'Quoted journey costs · confirm final provider prices' : 'total incomplete; unknown costs remain'} className="max-w-60" /></div>
    {finalLeg && <div className="rounded-xl bg-[var(--companion-paper)] p-4"><p className="text-xs font-medium text-[var(--companion-arrival)]">Final city arrival</p><p className="companion-heading mt-1 text-lg font-semibold text-[var(--companion-arrival)]">{finalLeg.to.name}</p><p className="mt-1 text-sm [overflow-wrap:anywhere]">{formatTravelTime(journey.finalArrivalAt, finalLeg.to.timeZone)}</p></div>}
    <ol className="space-y-4 border-l-2 border-[var(--companion-border)] pl-4">{journey.legs.map((leg, index) => <li key={leg.id} aria-label={`Journey leg ${index + 1}`} className="relative space-y-2 text-sm [overflow-wrap:anywhere] before:absolute before:-left-[22px] before:top-1 before:size-2.5 before:rounded-full before:bg-[var(--companion-teal)]">
      <h3 className="font-medium">{leg.kind} {leg.operator} {leg.service}</h3>
      <p>{leg.from.name} · {formatTravelTime(leg.startAt, leg.from.timeZone)}</p>
      <p>{leg.to.name} · {formatTravelTime(leg.endAt, leg.to.timeZone)}</p>
      <details className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">Costs, assumptions and source for this leg</summary><div className="mt-2 space-y-2 rounded-lg bg-[var(--companion-paper)] p-3">
        <TravelCosts costs={leg.costs} />
        {leg.assumptions.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
        <TravelEvidence evidence={leg.evidence} />
      </div></details>
    </li>)}</ol>
    {journey.violations.length > 0 && <div role="alert" className="rounded-xl border border-destructive/20 p-3 text-sm text-destructive"><p className="font-medium">This journey needs changes.</p><ul>{journey.violations.map(note => <li key={note}>{note}</li>)}</ul></div>}
    <div className="space-y-2 text-sm text-muted-foreground">{[...journey.warnings, ...journey.confirmations].map(note => <p key={note}>{note}</p>)}</div>
    <Button className="w-full whitespace-normal" disabled={busy || !eligible} onClick={() => { if (!eligible) return; if (!fresh()) { onExpired?.(); return } onSelect(journey) }}>{selected ? 'Chosen journey' : 'Choose this journey'}</Button>
    <details className="text-sm"><summary className="cursor-pointer py-1 text-muted-foreground">Source and freshness</summary><div className="mt-2"><TravelEvidence evidence={journey.evidence} /><p className="text-xs">Journey evidence expires {journey.evidenceExpiresAt ?? 'at the next source refresh'}.</p></div></details>
  </article>
}
