import { Button } from '@/components/ui/button'
import type { TravelRequestBinding } from '@domain/travel-contracts'
import type { TravelHistory } from './savedSelection'
import { refreshTravelRequest } from './savedSelection'

export function TravelHistoryPanel({ history, onRefresh, onDelete }: {
  history: TravelHistory
  onRefresh: (request: TravelRequestBinding) => void
  onDelete: () => void
}) {
  if (history.schemaVersion !== 3) return <section data-testid="saved-plan" className="space-y-3 rounded-2xl border border-[var(--companion-border)] bg-white p-4">
    <h2 className="companion-heading text-lg font-semibold">Saved on this device</h2>
    <p>Historical snapshot from {history.schemaVersion === 1 ? 'the original recovery planner' : 'the city planner'}. Original comparison: {history.generatedAt}. Selected and saved: {history.selectedAt}.</p>
    <a className="underline" href={history.schemaVersion === 1 ? '/legacy' : '/city'}>Open the saved plan in its original planner</a>
    <Button variant="outline" onClick={onDelete}>Delete saved plan</Button>
  </section>
  const expired = Date.parse(history.expiresAt) <= Date.now()
  return <section data-testid="saved-plan" aria-labelledby="saved-travel-heading" className="min-w-0 space-y-4 rounded-2xl border border-[var(--companion-border)] bg-[var(--companion-paper)] p-4 sm:p-5">
    <h2 id="saved-travel-heading" className="companion-heading text-lg font-semibold">Saved on this device</h2>
    <p>Historical snapshot{expired ? ' · Evidence expired' : ''}. Refresh and recheck all facts before choosing or booking. These original dates and source checks have been preserved.</p>
    <p>{history.origin.name}, {history.origin.stateCode} to {history.destination.name}, {history.destination.stateCode}</p>
    <dl className="space-y-1 break-words text-sm">
      <div><dt className="inline font-medium">Originally compared: </dt><dd className="inline">{history.generatedAt}</dd></div>
      <div><dt className="inline font-medium">Selected and saved: </dt><dd className="inline">{history.selectedAt}</dd></div>
      <div><dt className="inline font-medium">Ready from: </dt><dd className="inline">{history.request.trip.readyAt}</dd></div>
      <div><dt className="inline font-medium">Flight departure date: </dt><dd className="inline">{history.request.departureDate}</dd></div>
      <div><dt className="inline font-medium">Original evidence expiry: </dt><dd className="inline">{history.expiresAt}</dd></div>
    </dl>
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => onRefresh(refreshTravelRequest(history))}>Refresh this plan</Button><Button variant="outline" onClick={onDelete}>Delete saved plan</Button></div>
    <p className="text-sm">Refresh compares the original request with current sources. The saved snapshot stays unchanged.</p>
    <h3 className="font-semibold">{history.journey.title}</h3>
    <p>{history.journey.boardings} flight boardings · {history.journey.transfers} connections · {history.journey.durationMinutes} minutes. Known cost: ${(history.journey.knownCostCents / 100).toFixed(2)}{history.journey.priceComplete ? '' : ' · Total trip cost unknown'}.</p>
    {history.selectedHotel && <p>Original overnight: {history.selectedHotel.name}, {history.selectedHotel.checkin} to {history.selectedHotel.checkout}. Room and arrangements require confirmation.</p>}
    <ol className="space-y-3">{history.journey.legs.map(leg => <li key={leg.id} className="rounded-xl border border-[var(--companion-border)] bg-white p-3 text-sm [overflow-wrap:anywhere]">
      <p className="font-medium">{leg.kind}: {leg.from.name} to {leg.to.name}{leg.service ? ` · ${leg.operator ?? ''} ${leg.service}` : ''}</p>
      <p>{leg.startAt} ({leg.from.timeZone}) → {leg.endAt} ({leg.to.timeZone})</p>
      {leg.costs.map((cost, i) => <p key={i}>{cost.label}: {cost.cents === null ? 'Unknown' : `$${(cost.cents / 100).toFixed(2)}`}{cost.includedInOtherCharge ? ' (included in another charge)' : ''}</p>)}
      {leg.assumptions.map((note, i) => <p key={i}>{note}</p>)}
      {leg.evidence.map((e, i) => <p key={i}>Original source: {e.provider} · {e.type} · checked {e.checkedAt}{e.expiresAt ? ` · expires ${e.expiresAt}` : ''}</p>)}
    </li>)}</ol>
    {history.journey.confirmations.map((note, i) => <p key={i}>{note}</p>)}
    {history.journey.warnings.map((note, i) => <p key={i}>{note}</p>)}
  </section>
}
