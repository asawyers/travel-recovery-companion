import type { NationalHotelOffer } from '@domain/travel-contracts'
import { Button } from '@/components/ui/button'
import { PriceHighlight } from '@/components/ui/companion'
import { CustomerHandoff, TravelCosts, TravelEvidence, travelEvidenceFresh, quotedTravelAmount } from './FlightOffers'
export function HotelOffers({ offers, selectedId, busy = false, expiresAt, onPlan, onExpired }: {
  offers: NationalHotelOffer[]; selectedId?: string | null; busy?: boolean; expiresAt?: string | null;
  onPlan: (offer: NationalHotelOffer) => void; onExpired?: () => void
}) {
  if (!offers.length) return null
  return <section aria-label="Origin overnight quotes" className="min-w-0 space-y-4">
    <div className="space-y-1"><h2 className="companion-heading text-xl font-semibold">One night at your origin</h2>
    <p className="text-sm text-muted-foreground">Origin hotel quotes need confirmed arrival arrangements and transfers before the complete journey can be checked.</p></div>
    <ul className="space-y-4">{offers.map(hotel => {
      const fresh = () => travelEvidenceFresh(hotel.evidence, expiresAt)
      const selected = selectedId === hotel.id
      return <li key={hotel.id} className={`min-w-0 space-y-4 rounded-2xl border bg-white p-4 text-sm shadow-sm sm:p-5 ${selected ? 'border-[var(--companion-teal)] ring-1 ring-[var(--companion-teal)]' : 'border-[var(--companion-border)]'}`}>
        {selected && <p className="w-fit rounded-full bg-[var(--companion-paper)] px-3 py-1 text-xs font-medium text-[var(--companion-teal)]">Selected overnight</p>}
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 space-y-1"><h3 className="companion-heading text-lg font-semibold">{hotel.name}</h3><p className="text-xs text-muted-foreground">{hotel.checkin} to {hotel.checkout} · 1 adult · 1 room</p></div><PriceHighlight amountCents={quotedTravelAmount(hotel.costs)} label="Observed overnight quote" qualifier="1 night · additional fees and transfers need confirmation" className="max-w-60" /></div>
        <p>{hotel.room ?? 'Room details unknown'}</p>
        <p className="text-xs text-muted-foreground">Unknown additional fees and transfers are not assumed to be free.</p>
        <details className="rounded-xl border border-[var(--companion-border)]"><summary className="cursor-pointer px-3 py-3 font-medium">Property details</summary><div className="space-y-3 px-3 pb-3 [overflow-wrap:anywhere]">
          <p>{hotel.address ?? 'Property address unknown'}</p>
          <p className="text-xs text-muted-foreground">Property time zone estimated from the origin city: {hotel.timeZone}. Confirm the property location and local time.</p>
          <TravelCosts costs={hotel.costs} />
          <p>{hotel.checkinPolicy ?? 'Check-in policy unknown; check with the property.'}</p>
          <p>{hotel.checkoutPolicy ?? 'Checkout policy unknown; check with the property.'}</p>
          <p>{hotel.cancellation ?? 'Cancellation policy unknown; check with the property.'}</p>
        </div></details>
        <Button className="w-full whitespace-normal" variant={selected ? 'secondary' : 'outline'} disabled={busy} onClick={() => { if (fresh()) onPlan(hotel); else onExpired?.() }}>{selected ? 'Review this overnight' : 'Plan this overnight'}</Button>
        <details><summary className="cursor-pointer py-1 text-muted-foreground">Source and freshness</summary><div className="mt-2"><TravelEvidence evidence={hotel.evidence} /></div></details>
        <CustomerHandoff href={hotel.handoffUrl} kind="hotels" fresh={fresh} onExpired={onExpired} />
      </li>
    })}</ul>
  </section>
}
