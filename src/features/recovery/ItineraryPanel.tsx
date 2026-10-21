import type {
  RecoveryPlan,
  RecoveryResult,
  JourneyLeg,
  TripRequest,
} from "@domain/schemas";
import {
  directions,
  isAllowedHandoffUrl,
  resolveHandoff,
} from "@domain/handoffs";
import { money, time } from "./OptionList";
export function ItineraryPanel({
  plan,
  result,
  request = result?.request,
  presentation = "current",
  saved = false,
}: {
  plan: RecoveryPlan | undefined;
  result?: RecoveryResult | null;
  request?: TripRequest;
  presentation?: "current" | "historical";
  saved?: boolean;
}) {
  const historical = presentation === "historical";
  const headingId = historical
    ? "saved-itinerary-heading"
    : "itinerary-heading";
  const hotel = plan?.hotel;
  const handoffForLeg = (leg: JourneyLeg) => {
    if (leg.kind === "train") return resolveHandoff("amtrak");
    if (leg.kind === "bus") return resolveHandoff("concord");
    if (leg.kind === "car") return resolveHandoff("kayak-bos");
    return null;
  };
  return (
    <section
      data-testid={historical ? "saved-itinerary" : "itinerary"}
      aria-labelledby={headingId}
      className="rounded-lg border bg-white p-5"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {historical ? "Saved itinerary details" : "Selected itinerary"}
      </h2>
      {!plan ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No itinerary selected. Choose an option to inspect the full journey.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm font-semibold text-green-800">
            {historical
              ? "Historical snapshot · Not a current availability check · Not booked"
              : saved
                ? "Selected for review · Saved on this device · Not booked"
                : "Selected for review · Not booked or saved"}
          </p>
          <h3 className="mt-3 font-semibold">{plan.title}</h3>
          <p className="mt-2 text-sm tabular-nums">
            {plan.durationMinutes} minutes from gate arrival ·{" "}
            {money(plan.knownCostCents)}{" "}
            {plan.priceComplete ? "total" : "known charges + unknown costs"}
          </p>
          <p className="mt-2 text-sm">
            Final arrival {time(plan.finalArrivalAt)}. Deadline{" "}
            {request && time(request.deadlineAt)}.
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
              {hotel.costs.map((cost, i) => (
                <p key={i}>
                  {cost.label}:{" "}
                  {cost.cents === null ? "unknown" : `${money(cost.cents)} USD`}
                  {cost.includedInOtherCharge ? " (included elsewhere)" : ""}
                </p>
              ))}
              {hotel.cancellation?.deadlineAt && (
                <p>
                  Cancellation deadline {time(hotel.cancellation.deadlineAt)}.
                </p>
              )}
              {hotel.cancellation?.penalty && (
                <p>Cancellation penalty: {hotel.cancellation.penalty}</p>
              )}
              {hotel.evidence.map((e, i) => (
                <p
                  key={i}
                  className="mt-2 break-words text-xs text-muted-foreground"
                >
                  {e.type === "synthetic" ? "Synthetic / fictional" : e.type} ·{" "}
                  {e.provider} · checked{" "}
                  {historical ? e.checkedAt : time(e.checkedAt)} · service{" "}
                  {e.serviceDate}
                  {e.expiresAt
                    ? ` · expires ${historical ? e.expiresAt : time(e.expiresAt)}`
                    : " · expiry not supplied"}
                </p>
              ))}
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
                    · {e.provider} · checked{" "}
                    {historical ? e.checkedAt : time(e.checkedAt)} · service{" "}
                    {e.serviceDate}
                    {e.expiresAt
                      ? ` · expires ${historical ? e.expiresAt : time(e.expiresAt)}`
                      : " · expiry not supplied"}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          <section
            aria-label="External handoffs"
            className="mt-5 rounded-md border p-4"
          >
            <h4 className="font-semibold">Check options with operators</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              These links open provider entry pages. Enter the route and dates
              shown below; the itinerary is not a live inventory check.
            </p>
            {request?.mode === "synthetic" && (
              <p className="mt-2 text-sm font-medium text-amber-900">
                This fictional itinerary is an example only. The links do not
                verify its schedule, prices, or availability.
              </p>
            )}
            <ul className="mt-3 space-y-4">
              {plan.legs.map((leg) => {
                const handoff = handoffForLeg(leg);
                if (!handoff || !isAllowedHandoffUrl(handoff.id, handoff.href))
                  return null;
                const pickup =
                  leg.kind === "car"
                    ? plan.legs.find((item) => item.kind === "pickup")
                    : undefined;
                const rentalReturn =
                  leg.kind === "car"
                    ? plan.legs.find((item) => item.kind === "return")
                    : undefined;
                return (
                  <li key={`handoff-${leg.id}`} className="text-sm">
                    <p className="font-medium">
                      {leg.kind === "car" ? (
                        "One-way rental: Boston Logan (BOS) pickup → Portland, Maine return"
                      ) : (
                        <>
                          {leg.kind === "train" ? "Train" : "Bus"}: {leg.from} →{" "}
                          {leg.to}
                        </>
                      )}
                    </p>
                    {leg.kind === "car" && pickup && rentalReturn ? (
                      <p className="mt-1 text-muted-foreground">
                        America/New_York · pickup {time(pickup.startAt)} ·
                        return window {time(rentalReturn.startAt)} to{" "}
                        {time(rentalReturn.endAt)}
                      </p>
                    ) : (
                      <p className="mt-1 text-muted-foreground">
                        America/New_York · {time(leg.startAt)} to{" "}
                        {time(leg.endAt)}
                      </p>
                    )}
                    <p className="mt-1 text-muted-foreground">
                      {handoff.instructions}
                    </p>
                    <a
                      className="mt-2 inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium underline"
                      href={handoff.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${handoff.label}. ${handoff.instructions}`}
                    >
                      {handoff.label}
                    </a>
                  </li>
                );
              })}
              {hotel &&
                (() => {
                  const providerHandoff = resolveHandoff(hotel.handoffId);
                  const hotelHandoff =
                    providerHandoff ?? resolveHandoff("hotel-search");
                  if (
                    !hotelHandoff ||
                    !isAllowedHandoffUrl(hotelHandoff.id, hotelHandoff.href)
                  )
                    return null;
                  return (
                    <li key="handoff-hotel" className="text-sm">
                      <p className="font-medium">Hotel: {hotel.name}</p>
                      <p className="mt-1 text-muted-foreground">
                        {hotel.address}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {hotel.checkin} to {hotel.checkout} · {hotel.adults}{" "}
                        adult · {hotel.rooms} room · America/New_York
                      </p>
                      {!providerHandoff && (
                        <p className="mt-1 text-amber-900">
                          Provider hotel booking link unavailable. Use a general
                          hotel search and confirm the property and total.
                        </p>
                      )}
                      <p className="mt-1 text-muted-foreground">
                        {hotelHandoff.instructions}
                      </p>
                      <a
                        className="mt-2 inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm font-medium underline"
                        href={hotelHandoff.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${hotelHandoff.label}. ${hotelHandoff.instructions}`}
                      >
                        {hotelHandoff.label}
                      </a>
                    </li>
                  );
                })()}
            </ul>
            {request?.mode === "real" &&
              (() => {
                const corridor = directions(
                  "Boston Logan International Airport (BOS)",
                  "Portland, Maine",
                  "driving",
                );
                const href = corridor.toString();
                return isAllowedHandoffUrl("maps-directions", href) ? (
                  <p className="mt-4 text-sm">
                    <a
                      className="underline"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open Boston Logan to Portland, Maine corridor directions in Google Maps"
                    >
                      Open Boston Logan to Portland, Maine corridor directions
                      in Google Maps
                    </a>
                  </p>
                ) : null;
              })()}
            <p className="mt-4 text-xs text-muted-foreground">
              Confirm final availability and total on the provider site. Opening
              a link does not book, reserve, or save this itinerary.
            </p>
          </section>
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
