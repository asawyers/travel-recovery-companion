import { useEffect, useState, useSyncExternalStore } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { findAirport, nearestAirports } from "@domain/airport-metadata";
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
  type TravelOnwardOffer,
} from "@domain/travel-contracts";
import { sumCosts } from "@domain/time";
import { assessTravelSelection } from "@domain/travel-planner";
import { requestTravel } from "@/lib/travel-api";
/** Filter all nearby metadata before choosing one alternative; smaller airports can precede a hub. */
export function nearbyArrivalAirport(destination: City | null, from: string, to: string) {
  return destination ? nearestAirports(destination, { limit: Number.MAX_SAFE_INTEGER, radiusKm: 200 })
    .find(({ airport }) => airport.kind === "large_airport" && airport.iata !== to && airport.iata !== from) ?? null : null;
}
/** A distant airport needs a sourced onward route even when selected as the primary airport. */
export function requiresOnwardTravel(arrivalAirportIata: string, destination: City): boolean {
  const airport = findAirport(arrivalAirportIata);
  if (!airport) return true;
  const radians = Math.PI / 180;
  const h = Math.sin((airport.latitude - destination.latitude) * radians / 2) ** 2 +
    Math.cos(destination.latitude * radians) * Math.cos(airport.latitude * radians) * Math.sin((airport.longitude - destination.longitude) * radians / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h))) > 50;
}
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
  needsOnward: boolean;
  onward: TravelOnwardOffer | null;
  onwardVehicleConfirmed: boolean;
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
    needsOnward: false,
    onward: null,
    onwardVehicleConfirmed: false,
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
            needsOnward: false,
            onward: null,
            onwardVehicleConfirmed: false,
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
            needsOnward: false,
            onward: null,
            onwardVehicleConfirmed: false,
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
      !!this.state.result &&
      Number.isFinite(Date.parse(this.state.result.generatedAt)) &&
      Date.parse(this.state.result.generatedAt) <= Date.parse(this.options.now()) &&
      !this.state.busy && !this.state.dirty && !this.state.error
    );
  }
  expire() {
    if (!this.fresh()) {
      this.update({
        notice:
          "Last-checked estimates are still available. Prices and availability may have changed; refresh whenever you want.",
      });
    }
  }
  clearSelection() {
    this.update({ selected: false });
  }
  select() {
    const result = this.state.result;
    if (this.usable() && result?.journey?.selectable && result.request.selection) {
      const assessment = assessTravelSelection(result.request, {
        origin: result.origin, destination: result.destination, now: this.options.now(),
        flightOffers: result.flightOffers, hotelOffers: result.hotelOffers, onwardOffers: result.onwardOffers,
      });
      this.update({
        result: JSON.stringify(assessment.journey) === JSON.stringify(result.journey) && assessment.selectionIssue === result.selectionIssue
          ? result : { ...result, ...assessment },
        selected: Boolean(assessment.journey?.selectable),
      });
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
  planFlight(quote: FlightOffer, needsOnward = false) {
    if (!this.usable()) return;
    const flight = this.state.result!.flightOffers.find(
      (f) => f.id === quote.id && f.fingerprint === quote.fingerprint,
    );
    if (!flight) return;
    this.invalidateFacts();
    const { onwardFlight: _oldLookup, ...request } = this.state.result!.request;
    this.update({
      result: { ...this.state.result!, request, onwardOffers: undefined },
      flight,
      hotel: null,
      selected: false,
      editingFacts: !needsOnward,
      needsOnward,
      onward: null,
      onwardVehicleConfirmed: false,
      notice: null,
    });
  }
  async searchOnward(arrivalProcessingMinutes: number) {
    const { result, flight } = this.state;
    if (!result || !flight || !this.usable() || !this.state.needsOnward ||
      !Number.isInteger(arrivalProcessingMinutes) || arrivalProcessingMinutes < 0 || arrivalProcessingMinutes > 10080) return;
    await this.search({ ...result.request, selection: null, onwardFlight: {
      flightOfferId: flight.id, flightFingerprint: flight.fingerprint, arrivalProcessingMinutes,
    } });
  }
  planOnward(quote: TravelOnwardOffer, vehicleConfirmed = false) {
    const { result, flight } = this.state;
    if (!result || !flight || !this.usable() || !result.request.onwardFlight) return;
    const onward = result.onwardOffers?.find(value => value.id === quote.id &&
      value.flightOfferId === flight.id && value.flightFingerprint === flight.fingerprint);
    if (!onward || (onward.kind === "drive" && !vehicleConfirmed)) return;
    this.invalidateFacts();
    this.update({ onward, onwardVehicleConfirmed: onward.kind === "drive" && vehicleConfirmed,
      editingFacts: true, selected: false, notice: null });
  }
  planHotel(quote: NationalHotelOffer) {
    if (!this.usable() || !this.state.flight) return;
    const hotel = this.state.result!.hotelOffers.find(
      (h) => h.id === quote.id && h.fingerprint === quote.fingerprint,
    );
    if (!hotel) return;
    this.invalidateFacts();
    this.update({ hotel, selected: false, editingFacts: !this.state.needsOnward || Boolean(this.state.onward), notice: null });
  }
  reviewFacts() {
    if (this.usable() && this.state.flight && (!this.state.needsOnward || this.state.onward))
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
      needsOnward: false,
      onward: null,
      onwardVehicleConfirmed: false,
      selected: false,
      notice: "Journey planning canceled. Quotes remain available for review.",
    });
  }
  async confirm(facts: TravelJourneyFacts) {
    const { result, flight, hotel, onward } = this.state;
    if (
      !result ||
      !flight ||
      !this.usable() ||
      (result.request.overnight && !hotel) ||
      (this.state.needsOnward && (!onward || !result.request.onwardFlight || facts.arrivalProcessingMinutes !== result.request.onwardFlight.arrivalProcessingMinutes))
    )
      return;
    const request = {
      ...result.request,
      selection: {
        flightOfferId: flight.id,
        flightFingerprint: flight.fingerprint,
        hotelOfferId: hotel?.id ?? null,
        hotelFingerprint: hotel?.fingerprint ?? null,
        facts,
        ...(onward ? { onwardOfferId: onward.id, ...(onward.kind === "drive" ? { onwardVehicleConfirmed: this.state.onwardVehicleConfirmed } : {}) } : {}),
      },
    };
    const assessment = assessTravelSelection(request, {
      origin: result.origin, destination: result.destination, now: this.options.now(),
      flightOffers: result.flightOffers, hotelOffers: result.hotelOffers,
      onwardOffers: result.onwardOffers,
    });
    this.update({
      result: { ...result, request, ...assessment, assistance: undefined },
      history: [...this.state.history, result].slice(-3),
      editingFacts: false, selected: false,
      sequence: this.state.sequence + 1,
      notice: assessment.selectionIssue ? "A selected quote no longer matches this journey. Choose an option again." :
        this.fresh() ? null : "Last-checked estimates are still available. Prices and availability may have changed; refresh whenever you want.",
    });
  }
  rerank(priority: TravelTrip["priority"]) {
    if (!this.usable()) {
      this.expire();
      return;
    }
    this.applyPreferences({ priority });
  }
  /** Recompose accepted quotes without changing their original observation times. */
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
          onwardOffers: result.onwardOffers,
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
    const observationKey = (value: TravelRecoveryInput) => {
      const { selection: _selection, onwardFlight: _onward, ...request } = travelRequestBinding(value);
      return JSON.stringify(request, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
    };
    const retained = this.usable() && !input.refinement && !input.conversation && !input.onwardFlight &&
      observationKey(input) === observationKey(this.state.result!.request);
    const selected = this.state.selected;
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
            (f) => f.id === (result.request.selection?.flightOfferId ?? result.request.onwardFlight?.flightOfferId) &&
              f.fingerprint === (result.request.selection?.flightFingerprint ?? result.request.onwardFlight?.flightFingerprint),
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
        needsOnward: !issue && Boolean(result.request.onwardFlight),
        onward: !issue ? result.onwardOffers?.find(o => o.id === result.request.selection?.onwardOfferId) ?? null : null,
        onwardVehicleConfirmed: !issue && result.request.selection?.onwardVehicleConfirmed === true,
        notice: issue
          ? "A selected quote changed, disappeared or expired. Reselect a current flight and hotel and confirm the journey facts again."
          : null,
      });
      if (!this.fresh()) this.expire();
    } catch (error) {
      if (revision === this.revision && !controller.signal.aborted) {
        if (retained) {
          this.update({ busy: false, error: null, selected,
            notice: "Could not refresh sources. Your last-checked estimates are still available; confirm current prices and availability with the operator." });
          return;
        }
        this.update({
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : "Travel search failed. Your inputs are retained.",
          flight: null,
          hotel: null,
          editingFacts: false,
          needsOnward: false,
          onward: null,
          onwardVehicleConfirmed: false,
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
