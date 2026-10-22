import type { NationalHotelOffer } from '@domain/travel-contracts'
import { Button } from '@/components/ui/button'
import { CustomerHandoff, TravelCosts, TravelEvidence, travelEvidenceFresh } from './FlightOffers'
export function HotelOffers({ offers, selectedId, busy = false, expiresAt, onPlan, onExpired }: {
  offers: NationalHotelOffer[]; selectedId?: string | null; busy?: boolean; expiresAt?: string | null;
  onPlan: (offer: NationalHotelOffer) => void; onExpired?: () => void
}) {
  if (!offers.length) return null
  return <section aria-label="Origin overnight quotes" className="rounded-lg border bg-white p-5 space-y-3">
    <h2 className="text-lg font-semibold">One night at your origin</h2>
    <p className="text-sm text-muted-foreground">Origin hotel quotes need confirmed arrival arrangements and transfers before the complete journey can be checked.</p>
    <ul className="divide-y">{offers.map(hotel => {
      const fresh = () => travelEvidenceFresh(hotel.evidence, expiresAt)
      return <li key={hotel.id} className="space-y-3 py-4 text-sm">
        <h3 className="font-medium">{hotel.name}</h3>
        <p>{hotel.address ?? 'Property address unknown'}</p>
        <p>{hotel.checkin} to {hotel.checkout} · 1 adult · 1 room</p>
        <p className="text-xs text-muted-foreground">Property time zone estimated from the origin city: {hotel.timeZone}. Confirm the property location and local time.</p>
        <p>{hotel.room ?? 'Room details unknown'}</p>
        <TravelCosts costs={hotel.costs} />
        <p className="text-xs text-muted-foreground">Unknown additional fees and transfers are not assumed to be free.</p>
        <p>{hotel.checkinPolicy ?? 'Check-in policy unknown; check with the property.'}</p>
        <p>{hotel.checkoutPolicy ?? 'Checkout policy unknown; check with the property.'}</p>
        <p>{hotel.cancellation ?? 'Cancellation policy unknown; check with the property.'}</p>
        <details><summary className="cursor-pointer">Source and freshness</summary><div className="mt-2"><TravelEvidence evidence={hotel.evidence} /></div></details>
        <Button variant={selectedId === hotel.id ? 'secondary' : 'outline'} disabled={busy} onClick={() => { if (fresh()) onPlan(hotel); else onExpired?.() }}>{selectedId === hotel.id ? 'Review this overnight' : 'Plan this overnight'}</Button>
        <CustomerHandoff href={hotel.handoffUrl} kind="hotels" fresh={fresh} onExpired={onExpired} />
      </li>
    })}</ul>
  </section>
}
