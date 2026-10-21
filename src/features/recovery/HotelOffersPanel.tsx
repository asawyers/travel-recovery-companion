import { originalExpiries } from "@domain/api";
import { toInstantMillis } from "@domain/time";
import type { HotelOption } from "@domain/schemas";
import { isAllowedHandoffUrl, resolveHotelHandoff } from "@domain/handoffs";
import { Button } from "@/components/ui/button";
import { money, time } from "./OptionList";

export function HotelOffersPanel({ offers, selectedId, onSelect, busy, bookingOrigin, expiresAt, onExpired }: {
  offers: HotelOption[]; selectedId: string; onSelect: (hotelId: string) => void; busy: boolean; bookingOrigin?: string; expiresAt: string | null; onExpired: () => void;
}) {
  if (!offers.length) return null;
  return <section data-testid="hotel-offers" aria-labelledby="hotel-offers-heading" className="rounded-lg border bg-white p-5">
    <h2 id="hotel-offers-heading" className="text-lg font-semibold">Hotel rates only</h2>
    <p className="mt-2 text-sm text-muted-foreground">These offers are not complete recovery journeys. Choose a property, enter two property-specific transfers and an actual checkout-date train or bus, then investigate the full journey. A room rate alone does not make an overnight plan feasible.</p>
    <ul className="mt-4 divide-y border-y">{offers.map(hotel => {
      const fresh = () => {
        try { return !!expiresAt && Math.min(...originalExpiries(hotel).map(toInstantMillis), toInstantMillis(expiresAt)) > Date.now(); }
        catch { return false; }
      };
      const handoff = resolveHotelHandoff(hotel, bookingOrigin);
      const allowed = isAllowedHandoffUrl(handoff.id, handoff.href, bookingOrigin);
      return <li key={hotel.id} className="space-y-2 py-4 text-sm">
        <h3 className="font-semibold">{hotel.name}</h3><p>{hotel.address}</p>
        <p>{hotel.room ?? "Room unconfirmed"} · {hotel.board ?? "Board unconfirmed"}</p>
        <p>{hotel.checkin} to {hotel.checkout} · {hotel.adults} adult · {hotel.rooms} room</p>
        {hotel.costs.map((cost, index) => <p key={index}>{cost.label}: {cost.cents === null ? "unknown" : `${money(cost.cents)} USD`}{cost.includedInOtherCharge ? " (included elsewhere)" : ""}</p>)}
        <p>{hotel.cancellation?.text ?? "Cancellation terms unconfirmed."}</p>
        {hotel.cancellation?.deadlineAt && <p>Cancellation deadline {time(hotel.cancellation.deadlineAt)}.</p>}
        {hotel.cancellation?.penalty && <p>Cancellation penalty: {hotel.cancellation.penalty}</p>}
        <p>Late check-in {hotel.lateCheckinConfirmed ? "confirmed" : "needs confirmation"}.</p>
        {hotel.evidence.map((source, index) => <p key={index} className="break-words text-xs text-muted-foreground">{source.provider} · {source.type} · checked {source.checkedAt}{source.expiresAt ? ` · expires ${source.expiresAt}` : " · expiry not supplied"}</p>)}
        <p>Quote expiry: {hotel.quoteExpiresAt ? time(hotel.quoteExpiresAt) : "not supplied"}.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={selectedId === hotel.id ? "secondary" : "outline"} disabled={busy} onClick={() => { if (fresh()) onSelect(hotel.id); else onExpired(); }}>{selectedId === hotel.id ? `Selected ${hotel.name}` : `Use ${hotel.name}`}</Button>
          {allowed && <a href={handoff.href} onClick={event => { if (!fresh()) { event.preventDefault(); onExpired(); } }} target="_blank" rel="noopener noreferrer" className="underline">{handoff.label}</a>}
        </div>
        <p className="text-xs text-muted-foreground">{handoff.instructions} Opening a link does not book or reserve a room.</p>
      </li>;
    })}</ul>
  </section>;
}
