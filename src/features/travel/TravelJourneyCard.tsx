import type { TravelJourney } from '@domain/travel-contracts'
import { containsTravelGoogleMaps } from './savedSelectionSchema'
import { isTransferDetail, ItinerarySummary } from './TransferDetails'
import { ItineraryTimeline, RouteNotes, RouteTimeLegend } from './ItineraryPresentation'
import { GoogleRouteAttribution, mapsRouteLink } from './OnwardOffers'
import { Button } from '@/components/ui/button'
import { quotedTravelAmount, TravelCosts, TravelEvidence } from './FlightOffers'

export function TravelJourneyCard({ journey, selected = false, busy = false, onSelect }: {
  journey: TravelJourney; selected?: boolean; busy?: boolean; onSelect: (journey: TravelJourney) => void; onExpired?: () => void
}) {
  const eligible = journey.selectable && journey.feasibility === 'requires_confirmation' && journey.violations.length === 0
  const finalLeg = journey.legs.at(-1)
  const legs = journey.legs.map(leg => ({ ...leg, mode: leg.kind }))
  const onwardLegs = journey.legs.filter(leg => containsTravelGoogleMaps(leg.evidence))
  return <article aria-label="Complete journey" className={`min-w-0 space-y-5 rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ${selected ? 'border-[var(--companion-teal)] ring-1 ring-[var(--companion-teal)]' : 'border-[var(--companion-border)]'}`}>
    <div className="space-y-2"><p className="text-xs font-medium text-[var(--companion-teal)]">Complete journey</p><h2 className="companion-heading text-xl font-semibold">{journey.title}</h2><p className="text-sm text-muted-foreground">{journey.boardings} {journey.boardings === 1 ? 'boarding' : 'boardings'} · {journey.transfers} {journey.transfers === 1 ? 'change' : 'changes'}</p></div>
    <ItinerarySummary arrivalAt={journey.finalArrivalAt} arrivalZone={finalLeg?.to.timeZone} destination={finalLeg?.to.name} durationMinutes={journey.durationMinutes} amountCents={quotedTravelAmount(journey.costs) === null ? null : journey.knownCostCents} costLabel="Known costs" costQualifier={journey.priceComplete ? 'Quoted journey costs · confirm final provider prices' : 'total incomplete; unknown costs remain'} />
    <RouteTimeLegend legs={legs} />
    <ItineraryTimeline legs={legs.filter(leg => !isTransferDetail(leg.mode))} />
    <details className="rounded-xl border border-[var(--companion-border)] text-sm"><summary className="cursor-pointer px-3 py-3 font-medium">Transfer details</summary><div className="space-y-3 px-3 pb-3"><ItineraryTimeline legs={legs} renderDetails={leg => {
      const original = journey.legs.find(item => item.id === leg.id)!
      return <details data-source-leg={original.id} className="text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">Costs and source for this leg</summary><div className="mt-2 space-y-2"><TravelCosts costs={original.costs} /><TravelEvidence evidence={original.evidence} /></div></details>
    }} /></div></details>
    <RouteNotes legs={legs} notes={[...journey.warnings, ...journey.confirmations]} />
    <details className="rounded-xl border border-[var(--companion-border)] text-sm"><summary className="cursor-pointer px-3 py-3 font-medium">Cost breakdown</summary><div className="px-3 pb-3"><TravelCosts costs={journey.costs} /></div></details>
    {journey.violations.length > 0 && <div role="alert" className="rounded-xl border border-destructive/20 p-3 text-sm text-destructive"><p className="font-medium">This journey needs changes.</p><ul>{journey.violations.map(note => <li key={note}>{note}</li>)}</ul></div>}
    {onwardLegs.length > 0 && <GoogleRouteAttribution href={mapsRouteLink(onwardLegs[0].from, onwardLegs.at(-1)?.to, onwardLegs.some(leg => leg.kind === 'drive') ? 'drive' : 'transit')} />}
    <Button className="w-full whitespace-normal" disabled={busy || !eligible} onClick={() => { if (eligible) onSelect(journey) }}>{selected ? 'Chosen journey' : 'Choose this journey'}</Button>
    <details className="text-sm"><summary className="cursor-pointer py-1 text-muted-foreground">Source and freshness</summary><div className="mt-2"><TravelEvidence evidence={journey.evidence} /></div></details>
  </article>
}
