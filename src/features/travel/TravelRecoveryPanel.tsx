import { Button } from "@/components/ui/button";
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
      className="my-4 space-y-2 rounded border p-3 text-sm"
    >
      <p className="font-medium">Flight search airports</p>
      <p>{name(origins, from)}</p>
      <p>{name(destinations, to)}</p>
      <p className="text-xs text-muted-foreground">
        Searches one airport pair for one adult. City transfers need your
        confirmation. Overnight stays are checked only when requested.
      </p>
      {from && from === to && (
        <p role="alert">
          These cities share the selected airport. Choose different nearby
          airports to search flights.
        </p>
      )}
      <details open={open || undefined}>
        <summary className="cursor-pointer">Change nearby airports</summary>
        <div className="mt-3 space-y-3">
          {[
            ["Departure airport", origins, from],
            ["Arrival airport", destinations, to],
          ].map(([label, items, value], index) => (
            <label key={String(label)} className="block">
              {String(label)}
              <select
                aria-label={String(label)}
                className="block w-full rounded border p-2"
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
      className="my-5 space-y-4"
    >
      {state.busy && (
        <div>
          <p role="status">Checking flight and overnight sources…</p>
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
          {r.sourceStatuses.map((s, i) => (
            <p key={i} className="text-sm">
              {s.source}: {s.message}
            </p>
          ))}
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
          <summary>Earlier flight comparisons</summary>
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
