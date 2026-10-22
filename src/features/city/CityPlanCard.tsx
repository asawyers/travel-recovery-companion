import type { City, CityPlan } from "@domain/city-contracts";
import { Button } from "@/components/ui/button";
import { containsCityGoogle } from "./savedSelection";
import { cityDrivingMinutes } from "./conversationModel";
export const cityMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export function cityTime(instant: string, zone: string) {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(instant))} (${zone})`;
}
export function cityMapsLink(origin: City, destination: City): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.search = new URLSearchParams({
    api: "1",
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
  }).toString();
  return url.toString();
}
const operatorLinks: Record<string, string> = {
  amtrak: "https://www.amtrak.com/",
  greyhound: "https://www.greyhound.com/",
  flixbus: "https://www.flixbus.com/",
  "concord coach lines": "https://concordcoachlines.com/",
  "concord coach": "https://concordcoachlines.com/",
  "c&j": "https://www.ridecj.com/",
  megabus: "https://us.megabus.com/",
  "peter pan bus lines": "https://peterpanbus.com/",
  mbta: "https://www.mbta.com/",
};
export function CityPlanCard({
  plan,
  origin,
  destination,
  selected = false,
  saved = false,
  historical = false,
  busy = false,
  onSelect,
}: {
  plan: CityPlan;
  origin: City;
  destination: City;
  selected?: boolean;
  saved?: boolean;
  historical?: boolean;
  busy?: boolean;
  onSelect?: () => void;
}) {
  const drivingMinutes = cityDrivingMinutes(plan),
    longDrive = drivingMinutes > 480,
    google = containsCityGoogle(plan),
    operators = [
      ...new Set(
        plan.legs.flatMap((leg) => (leg.operator ? [leg.operator] : [])),
      ),
    ];
  return (
    <article
      data-testid={historical ? "historical-city-option" : "city-option-card"}
      className={`space-y-4 rounded-lg border bg-white p-5 ${selected ? "border-blue-700 ring-1 ring-blue-700" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{plan.title}</h3>
          <p className="mt-1 text-sm">
            {longDrive
              ? "Arrival time has not been planned. Breaks, overnight stops and vehicle arrangements are still required."
              : `Arrive ${cityTime(plan.finalArrivalAt, destination.timeZone)}`}
          </p>
        </div>
        <p className="text-sm font-semibold">
          {plan.priceComplete
            ? cityMoney(plan.knownCostCents)
            : longDrive && plan.knownCostCents === 0
              ? "Total trip cost unknown"
              : `At least ${cityMoney(plan.knownCostCents)} + unknown costs`}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {longDrive
          ? `${Math.round(drivingMinutes / 6) / 10} hours of driving time before breaks and overnight stops · Informational estimate · Not a selectable journey · `
          : `${Math.round(plan.durationMinutes)} minutes · ${plan.transfers} ${plan.transfers === 1 ? "change" : "changes"} · `}
        {plan.feasibility === "requires_confirmation"
          ? "Requires confirmation"
          : plan.feasibility === "infeasible"
            ? "Does not meet your trip facts"
            : "Schedule feasible"}
      </p>
      {plan.violations.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
          {plan.violations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Journey details and sources
        </summary>
        <ol className="mt-4 space-y-4">
          {plan.legs.map((leg) => (
            <li key={leg.id} className="border-l-2 pl-4 text-sm">
              <p className="font-medium">
                {leg.mode === "rail"
                  ? "Train"
                  : leg.mode === "drive"
                    ? "Driving estimate"
                    : leg.mode[0].toUpperCase() + leg.mode.slice(1)}
                {leg.operator ? ` · ${leg.operator}` : ""}
                {leg.service ? ` · ${leg.service}` : ""}
              </p>
              <p>
                {leg.from.name} → {leg.to.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {longDrive ? (
                  "Driving durations exclude breaks and overnight stops; departure and arrival times for a complete journey have not been planned."
                ) : (
                  <>
                    Depart {cityTime(leg.startAt, leg.departureTimeZone)}
                    <br />
                    Arrive {cityTime(leg.endAt, leg.arrivalTimeZone)}
                  </>
                )}
              </p>
              {leg.assumptions.map((a) => (
                <p key={a} className="mt-1 text-xs">
                  {a}
                </p>
              ))}
            </li>
          ))}
        </ol>
        <dl className="mt-4 space-y-1 text-sm">
          {plan.costs.map((cost, index) => (
            <div key={index}>
              <dt className="inline">{cost.label}: </dt>
              <dd className="inline">
                {cost.cents === null
                  ? "Unknown"
                  : cost.currency === "USD"
                    ? cityMoney(cost.cents)
                    : `${cost.cents / 100} ${cost.currency}`}
                {cost.includedInOtherCharge
                  ? " (included in another charge)"
                  : ""}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 space-y-2 text-xs">
          {plan.evidence.map((e, index) => (
            <p key={index}>
              {e.provider} · {e.type.replaceAll("_", " ")}
              <br />
              Checked {e.checkedAt}
              {e.expiresAt ? ` · Expires ${e.expiresAt}` : ""}
            </p>
          ))}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </details>
      {google && (
        <p className="text-xs">
          Route content from{" "}
          <a
            className="underline"
            href={cityMapsLink(origin, destination)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Maps
          </a>
          . Current tab only; confirm current availability.{" "}
          <a
            className="underline"
            href="https://www.google.com/help/terms_maps/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Maps terms
          </a>{" "}
          ·{" "}
          <a
            className="underline"
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy
          </a>
        </p>
      )}
      {!historical && (
        <div className="flex flex-wrap items-center gap-3">
          {onSelect && plan.selectable && (
            <Button
              variant={selected ? "secondary" : "outline"}
              disabled={busy}
              onClick={onSelect}
            >
              {selected
                ? saved
                  ? "Selected · Saved on this device"
                  : "Selected itinerary"
                : "Choose this itinerary"}
            </Button>
          )}
          <a
            className="text-sm underline"
            href={cityMapsLink(origin, destination)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open route in Google Maps
          </a>
          {operators.map((operator) =>
            operatorLinks[operator.toLowerCase()] ? (
              <a
                key={operator}
                className="text-sm underline"
                href={operatorLinks[operator.toLowerCase()]}
                target="_blank"
                rel="noopener noreferrer"
              >
                Check {operator}
              </a>
            ) : null,
          )}
        </div>
      )}
    </article>
  );
}
