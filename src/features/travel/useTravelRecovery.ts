import { useEffect, useState, useSyncExternalStore } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { findAirport } from "@domain/airport-metadata";
import type { City } from "@domain/city-contracts";
import type { PreferencePatch } from "@domain/assistance";
import {
  type FlightOffer,
  type NationalHotelOffer,
  type TravelJourneyFacts,
  type TravelRecoveryInput,
  type TravelRecoveryResponse,
  travelRequestBinding,
  type TravelTrip,
} from "@domain/travel-contracts";
import { sumCosts } from "@domain/time";
import { assessTravelSelection } from "@domain/travel-planner";
import { requestTravel } from "@/lib/travel-api";
export function buildTravelRequest(
  trip: TravelTrip,
  origin: City,
  from: string,
  to: string,
  overnight: boolean,
): TravelRecoveryInput | null {
  const airport = findAirport(from);
  if (!airport || !findAirport(to) || from === to) return null;
  const ready = Temporal.Instant.from(trip.readyAt);
  const checkin = ready.toZonedDateTimeISO(origin.timeZone).toPlainDate();
  const checkout = checkin.add({ days: 1 });
  return {
    version: 3,
    trip,
    originAirportIata: from,
    destinationAirportIata: to,
    departureDate: overnight
      ? checkout.toString()
      : ready.toZonedDateTimeISO(airport.timeZone).toPlainDate().toString(),
    overnight: overnight
      ? { checkin: checkin.toString(), checkout: checkout.toString() }
      : null,
    selection: null,
    investigate: true,
  };
}
type State = {
  result: TravelRecoveryResponse | null;
  history: TravelRecoveryResponse[];
  busy: boolean;
  dirty: boolean;
  error: string | null;
  notice: string | null;
  flight: FlightOffer | null;
  hotel: NationalHotelOffer | null;
  selected: boolean;
  editingFacts: boolean;
  sequence: number;
};
export class TravelSession {
  options: { now: () => string; transport: typeof requestTravel };
  private state: State = {
    result: null,
    history: [],
    busy: false,
    dirty: false,
    error: null,
    notice: null,
    flight: null,
    hotel: null,
    selected: false,
    editingFacts: false,
    sequence: 0,
  };
  private listeners = new Set<() => void>();
  private pending: AbortController | null = null;
  private revision = 0;
  constructor(options: Partial<TravelSession["options"]> = {}) {
    this.options = {
      now: () => new Date().toISOString(),
      transport: requestTravel,
      ...options,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }
  dispose() {
    this.revision++;
    this.pending?.abort();
    this.pending = null;
  }
  edit(preserve = true) {
    this.dispose();
    this.update(
      preserve
        ? {
            dirty: true,
            busy: false,
            selected: false,
            flight: null,
            hotel: null,
            editingFacts: false,
            error: null,
          }
        : {
            result: null,
            history: [],
            busy: false,
            dirty: false,
            error: null,
            notice: null,
            flight: null,
            hotel: null,
            selected: false,
            editingFacts: false,
          },
    );
  }
  unavailable() {
    this.edit(false);
    this.update({
      error:
        "Flight search is unavailable for these cities: choose distinct supported nearby airports.",
    });
  }
  fresh() {
    const r = this.state.result;
    return (
      !!r &&
      Date.parse(r.expiresAt) > Date.parse(this.options.now()) &&
      Date.parse(r.generatedAt) <= Date.parse(this.options.now())
    );
  }
  usable() {
    return (
      this.fresh() && !this.state.busy && !this.state.dirty && !this.state.error
    );
  }
  expire() {
    if (!this.fresh()) {
      this.update({
        flight: null,
        hotel: null,
        selected: false,
        editingFacts: false,
        notice:
          "Flight and hotel quotes expired. Recheck available sources and reselect your quotes.",
      });
    }
  }
  clearSelection() {
    this.update({ selected: false });
  }
  select() {
    if (this.usable() && this.state.result?.journey?.selectable) {
      this.update({ selected: true });
    }
  }
  private invalidateFacts() {
    const result = this.state.result;
    if (!result?.request.selection) return;
    this.update({
      history: [...this.state.history, result].slice(-3),
      result: {
        ...result,
        request: { ...result.request, selection: null },
        journey: null,
        selectionIssue: null,
      },
    });
  }
  planFlight(quote: FlightOffer) {
    if (!this.usable()) return;
    const flight = this.state.result!.flightOffers.find(
      (f) => f.id === quote.id && f.fingerprint === quote.fingerprint,
    );
    if (!flight) return;
    this.invalidateFacts();
    this.update({
      flight,
      hotel: null,
      selected: false,
      editingFacts: true,
      notice: null,
    });
  }
  planHotel(quote: NationalHotelOffer) {
    if (!this.usable() || !this.state.flight) return;
    const hotel = this.state.result!.hotelOffers.find(
      (h) => h.id === quote.id && h.fingerprint === quote.fingerprint,
    );
    if (!hotel) return;
    this.invalidateFacts();
    this.update({ hotel, selected: false, editingFacts: true, notice: null });
  }
  reviewFacts() {
    if (this.usable() && this.state.flight)
      this.update({ editingFacts: true, selected: false });
  }
  cancel() {
    const dirty = this.state.busy || this.state.dirty;
    this.dispose();
    this.update({
      dirty,
      busy: false,
      flight: null,
      hotel: null,
      editingFacts: false,
      selected: false,
      notice: "Journey planning canceled. Quotes remain available for review.",
    });
  }
  async confirm(facts: TravelJourneyFacts) {
    const { result, flight, hotel } = this.state;
    if (
      !result ||
      !flight ||
      !this.usable() ||
      (result.request.overnight && !hotel)
    )
      return;
    await this.search({
      ...result.request,
      selection: {
        flightOfferId: flight.id,
        flightFingerprint: flight.fingerprint,
        hotelOfferId: hotel?.id ?? null,
        hotelFingerprint: hotel?.fingerprint ?? null,
        facts,
      },
    });
  }
  rerank(priority: TravelTrip["priority"]) {
    if (!this.usable()) {
      this.expire();
      return;
    }
    this.applyPreferences({ priority });
  }
  /** Only fresh accepted quotes may be recomposed for shared soft preferences. */
  applyPreferences(patch: PreferencePatch) {
    if (!Object.keys(patch).length) return;
    if (!this.usable()) {
      this.edit(true);
      this.update({
        notice:
          "Preferences changed. Recheck flight sources before choosing or saving these earlier quotes.",
      });
      return;
    }
    this.revision++;
    const previous = this.state.result!,
      request = {
        ...previous.request,
        trip: { ...previous.request.trip, ...patch },
      };
    const priority = request.trip.priority;
    const result = { ...previous, request, assistance: undefined };
    if (request.selection) {
      Object.assign(
        result,
        assessTravelSelection(request, {
          origin: result.origin,
          destination: result.destination,
          now: this.options.now(),
          flightOffers: result.flightOffers,
          hotelOffers: result.hotelOffers,
        }),
      );
    }
    const arrival = (f: FlightOffer) =>
      Date.parse(f.segments.at(-1)!.arrivalAt);
    const costOrder = (a: FlightOffer, b: FlightOffer) => {
      const left = sumCosts(a.costs),
        right = sumCosts(b.costs);
      return (
        Number(!left.priceComplete) - Number(!right.priceComplete) ||
        left.knownCostCents - right.knownCostCents
      );
    };
    result.flightOffers = [...result.flightOffers].sort(
      (a, b) =>
        (priority === "fewest_transfers"
          ? a.segments.length - b.segments.length
          : priority === "earliest"
            ? arrival(a) - arrival(b)
            : costOrder(a, b)) ||
        arrival(a) - arrival(b) ||
        a.id.localeCompare(b.id),
    );
    this.update({ result, selected: false });
  }
  async search(input: TravelRecoveryInput) {
    this.dispose();
    const revision = this.revision,
      controller = new AbortController();
    this.pending = controller;
    this.update({
      busy: true,
      error: null,
      notice: null,
      selected: false,
      sequence: this.state.sequence + 1,
    });
    try {
      const result = await this.options.transport(input, {
        signal: controller.signal,
      });
      if (revision !== this.revision || controller.signal.aborted) return;
      const patch = result.assistance?.appliedPreferences ?? {};
      const expected = {
        ...travelRequestBinding(input),
        trip: { ...input.trip, ...patch },
      };
      const canonical = (v: unknown): string =>
        JSON.stringify(v, (_key, value) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
              )
            : value,
        );
      if (
        canonical(result.request) !== canonical(expected) ||
        (input.conversation
          ? result.conversation?.turnId !== input.conversation.turnId ||
            result.conversation?.baseRevision !==
              input.conversation.baseRevision
          : result.conversation !== undefined)
      ) {
        throw Error(
          "The reply did not match the current trip or message. Confirm your inputs and retry.",
        );
      }
      if (
        result.assistance?.clarification &&
        !result.selectionIssue &&
        !result.journey &&
        this.state.result &&
        canonical(result.request) === canonical(this.state.result.request)
      ) {
        this.update({
          result: { ...this.state.result, assistance: result.assistance },
          busy: false,
        });
        return;
      }
      const issue = result.selectionIssue;
      const flight = issue
        ? null
        : (result.flightOffers.find(
            (f) => f.id === result.request.selection?.flightOfferId,
          ) ?? null);
      const hotel = issue
        ? null
        : (result.hotelOffers.find(
            (h) => h.id === result.request.selection?.hotelOfferId,
          ) ?? null);
      this.update({
        result,
        history: this.state.result
          ? [...this.state.history, this.state.result].slice(-3)
          : this.state.history,
        busy: false,
        dirty: false,
        flight,
        hotel,
        editingFacts: false,
        notice: issue
          ? "A selected quote changed, disappeared or expired. Reselect a current flight and hotel and confirm the journey facts again."
          : null,
      });
      if (!this.fresh()) this.expire();
    } catch (error) {
      if (revision === this.revision && !controller.signal.aborted) {
        this.update({
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : "Travel search failed. Your inputs are retained.",
          flight: null,
          hotel: null,
          editingFacts: false,
        });
      }
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }
}
export function useTravelRecovery() {
  const [session] = useState(() => new TravelSession());
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (!state.result) return;
    const delay = Date.parse(state.result.expiresAt) - Date.now();
    if (delay <= 0) {
      session.expire();
      return;
    }
    const timer = window.setTimeout(
      () => session.expire(),
      Math.min(delay, 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [session, state.result]);
  return { session, state };
}
export type TravelController = ReturnType<typeof useTravelRecovery>;
