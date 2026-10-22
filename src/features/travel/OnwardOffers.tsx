import { useState, type FormEvent } from 'react'
import type { TravelOnwardOffer } from '@domain/travel-contracts'
import { containsTravelGoogleMaps } from './savedSelectionSchema'
import { isTransferDetail, ItinerarySummary } from './TransferDetails'
import { ItineraryTime, ItineraryTimeline, RouteNotes, RouteTimeLegend } from './ItineraryPresentation'
import { sumCosts } from '@domain/time'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { quotedTravelAmount, TravelCosts, TravelEvidence } from './FlightOffers'

type Coordinates = { latitude: number | null; longitude: number | null }
export function mapsRouteLink(origin: Coordinates | undefined, destination: Coordinates | undefined, kind: 'drive' | 'transit'): string | null {
  const valid = (point: Coordinates | undefined): point is { latitude: number; longitude: number } => !!point && point.latitude !== null && point.longitude !== null && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
  if (!valid(origin) || !valid(destination)) return null
  const url = new URL('https://www.google.com/maps/dir/')
  url.search = new URLSearchParams({ api: '1', origin: `${origin.latitude},${origin.longitude}`, destination: `${destination.latitude},${destination.longitude}`, travelmode: kind === 'drive' ? 'driving' : 'transit' }).toString()
  return url.toString()
}
export function GoogleRouteAttribution({ href }: { href: string | null; fresh?: () => boolean; onExpired?: () => void }) {
  return <div className="space-y-2 text-xs text-muted-foreground"><p>Route content from Google Maps. Current tab only; confirm current availability. <a className="underline" href="https://www.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Maps terms</a> · <a className="underline" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Privacy</a></p>{href && <a className="inline-block underline" href={href} target="_blank" rel="noopener noreferrer">Open onward route in Google Maps</a>}</div>
}

export function ArrivalAllowanceForm({ busy = false, onSearch, onCancel }: { busy?: boolean; onSearch: (minutes: number) => void; onCancel: () => void }) {
  const [value, setValue] = useState(''), [error, setError] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 10080) { setError('Enter whole minutes from 0 to 10,080.'); return }
    setError(''); onSearch(Number(value))
  }
  return <form aria-label="Arrival allowance for onward search" onSubmit={submit} className="space-y-3 rounded-2xl border bg-white p-4">
    <h3 className="companion-heading text-lg font-semibold">How much time will you need after landing?</h3>
    <p className="text-sm text-muted-foreground">Allow for baggage and airport exit. I will check actual onward schedules after this allowance, through to your final city.</p>
    <label className="block space-y-2 text-sm"><span>Arrival processing allowance minutes</span><Input type="number" min={0} max={10080} step={1} value={value} onChange={event => setValue(event.target.value)} disabled={busy} /></label>
    {error && <p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy}>Check onward options</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
  </form>
}
export function OnwardOffers({ offers, busy = false, onChoose }: { offers: TravelOnwardOffer[]; busy?: boolean; expiresAt?: string | null; onChoose: (offer: TravelOnwardOffer, vehicleConfirmed: boolean) => void; onExpired?: () => void }) {
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  return <section aria-label="Onward travel options" className="space-y-4">
    <h3 className="companion-heading text-lg font-semibold">Continue to your final city</h3>
    <p className="text-sm text-muted-foreground">Choose an actual onward option before checking the complete journey. Flight fares exclude these onward costs.</p>
    {!offers.length && <p role="status">No onward option is available from the checked sources for this flight and arrival allowance. Try another flight or recheck sources.</p>}
    {offers.map(offer => {
      const last = offer.legs.at(-1)
      const hasTransfers = offer.legs.some(leg => isTransferDetail(leg.mode))
      const durationMinutes = last ? Math.max(0, (Date.parse(last.endAt) - Date.parse(offer.airportReadyAt)) / 60000) : 0
      const totals = sumCosts(offer.costs)
      return <article key={offer.id} className="min-w-0 space-y-4 rounded-2xl border border-[var(--companion-border)] bg-white p-4 shadow-sm sm:p-5">
        <div className="space-y-1"><h4 className="companion-heading text-lg font-semibold">{offer.kind === 'drive' ? 'Driving estimate' : 'Bus / rail onward itinerary'}</h4>
        <p className="text-sm text-muted-foreground">From {offer.arrivalAirportIata} · airport ready <ItineraryTime at={offer.airportReadyAt} zone={offer.legs[0]?.departureTimeZone ?? 'UTC'} showDate /></p></div>
        <ItinerarySummary arrivalAt={last?.endAt} arrivalZone={last?.arrivalTimeZone} destination={last?.to.name} durationMinutes={durationMinutes} amountCents={quotedTravelAmount(offer.costs)} costLabel="Onward fare" costQualifier={totals.priceComplete ? 'Quoted onward costs · confirm final provider prices' : 'total incomplete; unknown costs remain'} />
        <RouteTimeLegend legs={offer.legs} />
        <ItineraryTimeline legs={offer.legs.filter(leg => !isTransferDetail(leg.mode))} />
        {hasTransfers && <details className="rounded-xl border border-[var(--companion-border)] text-sm"><summary className="cursor-pointer px-3 py-3 font-medium">Transfer details</summary><div className="space-y-3 px-3 pb-3"><ItineraryTimeline legs={offer.legs} /></div></details>}
        <RouteNotes legs={offer.legs} notes={offer.confirmations} />
        <details className="rounded-xl border border-[var(--companion-border)] text-sm"><summary className="cursor-pointer px-3 py-3 font-medium">Cost breakdown</summary><div className="px-3 pb-3"><TravelCosts costs={offer.costs} /></div></details>
        {offer.kind === 'drive' && <><p className="text-sm text-muted-foreground">Road travel time is an estimate. It does not include rental inventory, vehicle availability or a reserved ride.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed[offer.id] ?? false} onChange={event => setConfirmed(current => ({ ...current, [offer.id]: event.target.checked }))} disabled={busy} /><span>I have confirmed a vehicle and driver for this onward trip.</span></label></>}
        <Button disabled={busy || (offer.kind === 'drive' && !confirmed[offer.id])} onClick={() => onChoose(offer, confirmed[offer.id] ?? false)}>Use this onward option</Button>
        {containsTravelGoogleMaps(offer) && <GoogleRouteAttribution href={mapsRouteLink(offer.legs[0]?.from, last?.to, offer.kind)} />}
        <details className="text-sm"><summary className="cursor-pointer">Onward source and freshness</summary><TravelEvidence evidence={offer.evidence} /></details>
      </article>
    })}
  </section>
}
