import { Button } from "@/components/ui/button";
import { AgentActivityList, CompanionStatus } from "@/components/ui/companion";
import type { City } from "@domain/city-contracts";
import { nearestAirports } from "@domain/airport-metadata";
import { FlightOffers } from "./FlightOffers";
import { HotelOffers } from "./HotelOffers";
import { JourneyFactsForm } from "./JourneyFactsForm";
import { TravelJourneyCard } from "./TravelJourneyCard";
import type { TravelController } from "./useTravelRecovery";
export function AirportChoices({
  origin,
  destination,
  from,
  to,
  onChange,
  open = false,
}: {
  origin: City | null;
  destination: City | null;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  open?: boolean;
}) {
  if (!origin || !destination) return null;
  const origins = nearestAirports(origin),
    destinations = nearestAirports(destination);
  const name = (items: typeof origins, code: string) => {
    const item = items.find((i) => i.airport.iata === code);
    return item
      ? `${item.airport.name} (${code}) · ${Math.round(
          item.distanceKm,
        )} km from city center`
      : "No supported airport within 200 km";
  };
  return (
    <section
      aria-label="Airports for flight search"
      className="my-3 min-w-0 space-y-2 rounded-xl border border-[var(--companion-border)] bg-[var(--companion-paper)] p-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Flight search airports</p><p className="companion-heading font-semibold">{from || '—'} <span aria-hidden="true">→</span> {to || '—'}</p></div>
      <div className="space-y-1 text-xs text-muted-foreground"><p>{name(origins, from)}</p><p>{name(destinations, to)}</p></div>
      {from && from === to && (
        <p role="alert">
          These cities share the selected airport. Choose different nearby
          airports to search flights.
        </p>
      )}
      <details open={open || undefined}>
        <summary className="cursor-pointer">Change nearby airports</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">Searches one airport pair for one adult. City transfers need your confirmation. Overnight stays are checked only when requested.</p>
          {[
            ["Departure airport", origins, from],
            ["Arrival airport", destinations, to],
          ].map(([label, items, value], index) => (
            <label key={String(label)} className="block">
              {String(label)}
              <select
                aria-label={String(label)}
                className="block w-full min-w-0 rounded-lg border border-[var(--companion-border)] bg-white p-2"
                value={String(value)}
                onChange={(e) =>
                  onChange(
                    index === 0 ? e.target.value : from,
                    index === 1 ? e.target.value : to,
                  )
                }
              >
                {(items as typeof origins).map(({ airport, distanceKm }) => (
                  <option value={airport.iata} key={airport.iata}>
                    {airport.name} ({airport.iata}) · {Math.round(distanceKm)}{" "}
                    km
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
export function TravelRecoveryPanel({
  controller,
  onChoose,
}: {
  controller: TravelController;
  origin?: City | null;
  destination?: City | null;
  onChoose: () => void;
}) {
  const { state, session } = controller,
    r = state.result,
    busy = !session.usable();
  return (
    <section
      aria-label="Flight and overnight planning"
      className="my-5 min-w-0 space-y-4"
    >
      {state.busy && (
        <div className="space-y-3 rounded-2xl border border-[var(--companion-border)] bg-white p-4">
          <CompanionStatus label="Checking flight and overnight sources…" detail="I’m checking the available quotes and journey information." />
          <Button variant="outline" onClick={() => session.cancel()}>
            Cancel travel search
          </Button>
        </div>
      )}
      {state.error && (
        <p role="alert">Flight and hotel search: {state.error}</p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
      {r && (
        <>
          <p className="text-sm">
            Flight search: {r.request.originAirportIata} to{" "}
            {r.request.destinationAirportIata} · {r.request.departureDate}
            {r.request.overnight
              ? ` · Origin overnight ${r.request.overnight.checkin} to ${r.request.overnight.checkout}`
              : ""}
          </p>
          {r.assistance?.activity.length ? <details className="rounded-xl border border-[var(--companion-border)] bg-white p-3 text-sm"><summary className="cursor-pointer font-medium">What I checked</summary><AgentActivityList activity={r.assistance.activity} className="mt-3" /></details> : null}
          {r.sourceStatuses.filter(s => s.status !== "available").map(s => (
            <p key={s.source} role="status" className="rounded-xl border border-[var(--companion-caution)]/30 bg-[var(--companion-caution)]/5 p-3 text-sm text-[var(--companion-caution)] [overflow-wrap:anywhere]">{s.source}: {s.message}</p>
          ))}
          {r.sourceStatuses.some(s => s.status === "available") && <details className="text-sm"><summary className="cursor-pointer py-1 text-muted-foreground">Flight and hotel source updates</summary><div className="mt-2 space-y-2">{r.sourceStatuses.filter(s => s.status === "available").map(s => (
            <p key={s.source} className="text-sm [overflow-wrap:anywhere]">{s.source}: {s.message}</p>
          ))}</div></details>}
          {r.warnings.map((w, i) => (
            <p key={i} className="text-sm text-muted-foreground">
              {w}
            </p>
          ))}
          <FlightOffers
            offers={r.flightOffers}
            busy={busy}
            expiresAt={r.expiresAt}
            onPlan={(f) => session.planFlight(f)}
            onExpired={() => session.expire()}
          />
          {state.flight && r.request.overnight && (
            <HotelOffers
              offers={r.hotelOffers}
              selectedId={state.hotel?.id}
              busy={busy}
              expiresAt={r.expiresAt}
              onPlan={(h) => session.planHotel(h)}
              onExpired={() => session.expire()}
            />
          )}
          {state.flight && r.request.overnight && !r.hotelOffers.length && (
            <p>
              No origin hotel quote is available. A complete overnight journey
              cannot be built yet.
            </p>
          )}
          {state.editingFacts &&
            state.flight &&
            (!r.request.overnight || state.hotel) && (
              <JourneyFactsForm
                key={`${state.flight.fingerprint}:${
                  state.hotel?.fingerprint ?? ""
                }`}
                flight={state.flight}
                hotel={state.hotel}
                initialFacts={r.request.selection?.facts}
                busy={busy}
                pending={state.busy}
                onConfirm={(facts) => void session.confirm(facts)}
                onCancel={() => session.cancel()}
              />
            )}
          {r.journey && !state.editingFacts && (
            <TravelJourneyCard
              journey={r.journey}
              busy={busy}
              selected={state.selected}
              onSelect={() => {
                session.select();
                if (session.getSnapshot().selected) onChoose();
              }}
              onExpired={() => session.expire()}
            />
          )}
        </>
      )}
      {state.history.length > 0 && (
        <details>
          <summary className="cursor-pointer py-2 text-sm font-medium">Earlier flight comparisons</summary>
          <p className="text-sm">
            Historical quotes and journey facts cannot be selected.
          </p>
          {state.history.map((old, i) => (
            <div key={i} className="mt-2 text-sm">
              {old.request.originAirportIata} to{" "}
              {old.request.destinationAirportIata} · {old.request.departureDate}{" "}
              · {old.flightOffers.length} previous quotes
              {old.journey && (
                <TravelJourneyCard
                  journey={old.journey}
                  busy
                  onSelect={() => {}}
                />
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
