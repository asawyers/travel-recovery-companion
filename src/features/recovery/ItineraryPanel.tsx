import type { RecoveryPlan, RecoveryResult } from "@domain/schemas";
import { money, time } from "./OptionList";
export function ItineraryPanel({
  plan,
  result,
}: {
  plan: RecoveryPlan | undefined;
  result: RecoveryResult | null;
}) {
  const hotel = plan?.hotel;
  return (
    <section
      data-testid="itinerary"
      aria-labelledby="itinerary-heading"
      className="rounded-lg border bg-white p-5"
    >
      <h2 id="itinerary-heading" className="text-lg font-semibold">
        Selected itinerary
      </h2>
      {!plan ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No itinerary selected. Choose an option to inspect the full journey.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm font-semibold text-green-800">
            Selected for review · Not booked or saved
          </p>
          <h3 className="mt-3 font-semibold">{plan.title}</h3>
          <p className="mt-2 text-sm tabular-nums">
            {plan.durationMinutes} minutes from gate arrival ·{" "}
            {money(plan.knownCostCents)}{" "}
            {plan.priceComplete ? "total" : "known charges + unknown costs"}
          </p>
          <p className="mt-2 text-sm">
            Final arrival {time(plan.finalArrivalAt)}. Deadline{" "}
            {result && time(result.request.deadlineAt)}.
          </p>
          {hotel && (
            <div className="mt-4 rounded-md bg-slate-100 p-4 text-sm">
              <h4 className="font-semibold">{hotel.name}</h4>
              <p>{hotel.address}</p>
              <p>
                {hotel.room ?? "Room unconfirmed"} ·{" "}
                {hotel.board ?? "Board unconfirmed"}
              </p>
              <p>
                {hotel.checkin} to {hotel.checkout} · {hotel.adults} adult ·{" "}
                {hotel.rooms} room
              </p>
              <p>
                Late check-in{" "}
                {hotel.lateCheckinConfirmed
                  ? "confirmed"
                  : "needs confirmation"}
                .
              </p>
              <p>
                {hotel.cancellation?.text ?? "Cancellation terms unconfirmed."}
              </p>
              {hotel.quoteExpiresAt && (
                <p>Quote expires {time(hotel.quoteExpiresAt)}.</p>
              )}
            </div>
          )}
          <ol className="mt-5 divide-y border-y">
            {plan.legs.map((leg) => (
              <li key={leg.id} className="py-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold capitalize">{leg.kind}</p>
                  <p className="tabular-nums">
                    {time(leg.startAt)} – {time(leg.endAt)}
                  </p>
                </div>
                <p className="mt-2 break-words">
                  {leg.from} → {leg.to}
                </p>
                {leg.costs.map((c, i) => (
                  <p key={i} className="mt-1 text-muted-foreground">
                    {c.label}:{" "}
                    {c.cents === null ? "unknown" : `${money(c.cents)} USD`}
                    {c.includedInOtherCharge ? " (included elsewhere)" : ""}
                  </p>
                ))}
                {leg.assumptions.map((a) => (
                  <p key={a} className="mt-1 text-xs text-muted-foreground">
                    {a}
                  </p>
                ))}
                {leg.evidence.map((e, i) => (
                  <p
                    key={i}
                    className="mt-2 break-words text-xs text-muted-foreground"
                  >
                    {e.type === "synthetic"
                      ? "Synthetic / fictional"
                      : e.type === "traveler_confirmed"
                        ? "Traveler confirmed"
                        : e.type}{" "}
                    · {e.provider} · checked {time(e.checkedAt)} · service{" "}
                    {e.serviceDate}
                    {e.expiresAt
                      ? ` · expires ${time(e.expiresAt)}`
                      : " · expiry not supplied"}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          <ul className="mt-4 space-y-2 text-sm text-amber-900">
            {[...plan.violations, ...plan.warnings].map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Selecting an itinerary does not reserve transport, book a hotel or
            save a trip. Confirm all facts and payable charges with each
            operator.
          </p>
        </>
      )}
    </section>
  );
}
