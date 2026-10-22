import { describe, expect, it } from "vitest";
import { travelFixture, overnightTravelFixture } from "@domain/travel-fixtures";
import { assessTravelSelection } from "@domain/travel-planner";
import {
  buildTravelRequest,
  TravelSession,
} from "../../src/features/travel/useTravelRecovery";
import {
  type TravelRecoveryResponse,
  hotelOfferFingerprint,
  travelRequestBinding,
} from "@domain/travel-contracts";
const f = travelFixture();
const response = (input = f.input): TravelRecoveryResponse => ({
  version: 3,
  request: travelRequestBinding(input),
  origin: f.origin,
  destination: f.destination,
  generatedAt: f.now,
  expiresAt: "2026-11-18T14:05:00Z",
  flightOffers: [],
  hotelOffers: [],
  sourceStatuses: [],
  journey: null,
  selectionIssue: null,
  warnings: [],
});
describe("travel integration lifecycle", () => {
  it("uses the selected airport calendar day even across city midnight and origin-local overnight", () => {
    const trip = { ...f.input.trip, readyAt: "2026-11-19T07:30:00Z" };
    const r = buildTravelRequest(trip, f.origin, "JFK", "PWM", false)!;
    expect(r.departureDate).toBe("2026-11-19");
    const overnight = buildTravelRequest(trip, f.origin, "SAN", "PWM", true)!;
    expect(overnight.overnight).toEqual({
      checkin: "2026-11-18",
      checkout: "2026-11-19",
    });
    expect(overnight.departureDate).toBe("2026-11-19");
    expect(buildTravelRequest(trip, f.origin, "SAN", "SAN", false)).toBeNull();
  });
  it("aborts superseded requests, ignores stale responses, retains dirty historical cards", async () => {
    let release!: (v: TravelRecoveryResponse) => void;
    let signal: AbortSignal | undefined;
    const session = new TravelSession({
      now: () => f.now,
      transport: (_input, options) => {
        signal = options?.signal;
        return new Promise((r) => (release = r));
      },
    });
    const pending = session.search(f.input);
    session.edit(true);
    expect(signal?.aborted).toBe(true);
    release(response());
    await pending;
    expect(session.getSnapshot().result).toBeNull();
    session.options.transport = async (input) => response(input);
    await session.search(f.input);
    session.edit(true);
    expect(session.getSnapshot().result).not.toBeNull();
    expect(session.getSnapshot().dirty).toBe(true);
    session.edit(false);
    expect(session.getSnapshot().result).toBeNull();
  });
  it("reranks locally without transport and clears facts on rejected revalidation", async () => {
    let posts = 0;
    const session = new TravelSession({
      now: () => f.now,
      transport: async (input) => {
        posts++;
        return response(input);
      },
    });
    await session.search({ ...f.input, selection: null });
    session.rerank("cheapest");
    expect(posts).toBe(1);
    expect(session.getSnapshot().result?.request.trip.priority).toBe(
      "cheapest",
    );
    session.options.transport = async (input) => ({
      ...response(input),
      selectionIssue: "flight_changed",
    });
    await session.search(f.input);
    expect(session.getSnapshot().flight).toBeNull();
    expect(session.getSnapshot().selected).toBe(false);
    expect(session.getSnapshot().notice).toMatch(/changed|reselect/i);
  });
});
it("rejects wrong conversation echoes even if an injected transport returns them", async () => {
  const session = new TravelSession({
    now: () => f.now,
    transport: async (input) => ({
      ...response(input),
      conversation: { turnId: "stale", baseRevision: 0 },
    }),
  });
  await session.search({
    ...f.input,
    conversation: { turnId: "current", baseRevision: 0, history: [] },
  });
  expect(session.getSnapshot().result).toBeNull();
  expect(session.getSnapshot().error).toMatch(/current trip|message/);
});
it("a new flight selection invalidates completed journey facts, while retaining old cards as history", async () => {
  const { assessTravelSelection } = await import("@domain/travel-planner");
  const full = {
    ...response(),
    flightOffers: f.flightOffers,
    ...assessTravelSelection(f.input, { ...f, now: f.now }),
  };
  const session = new TravelSession({
    now: () => f.now,
    transport: async () => full,
  });
  await session.search(f.input);
  session.select();
  expect(session.getSnapshot().selected).toBe(true);
  session.planFlight(f.flight);
  expect(session.getSnapshot().result?.journey).toBeNull();
  expect(session.getSnapshot().result?.request.selection).toBeNull();
  expect(session.getSnapshot().history.at(-1)?.journey).toBeTruthy();
});
it("rejects noncurrent quote fingerprints and ranks unknown fares after known quoted USD costs", async () => {
  const unknown = structuredClone(f.flight);
  unknown.id = "unknown";
  unknown.fingerprint = "unknown";
  unknown.costs[0].cents = null;
  const full = {
    ...response({ ...f.input, selection: null }),
    flightOffers: [unknown, f.flight],
  };
  const session = new TravelSession({
    now: () => f.now,
    transport: async () => full,
  });
  await session.search({ ...f.input, selection: null });
  session.planFlight({ ...f.flight, fingerprint: "stale" });
  expect(session.getSnapshot().flight).toBeNull();
  session.rerank("cheapest");
  expect(session.getSnapshot().result?.flightOffers[0].id).toBe(f.flight.id);
});
it("canceling a superseded source check keeps earlier cards read-only and ignores its response", async () => {
  const session = new TravelSession({
    now: () => f.now,
    transport: async (input) => response(input),
  });
  await session.search({ ...f.input, selection: null });
  let release!: (v: TravelRecoveryResponse) => void;
  session.options.transport = () =>
    new Promise((resolve) => (release = resolve));
  const pending = session.search({ ...f.input, selection: null });
  session.cancel();
  release(response());
  await pending;
  expect(session.getSnapshot().busy).toBe(false);
  expect(session.getSnapshot().result).not.toBeNull();
  expect(session.usable()).toBe(false);
});
it("soft preference synchronization invalidates a pending travel request and retains hard facts", async () => {
  const session = new TravelSession({
    now: () => f.now,
    transport: async (input) => response(input),
  });
  await session.search({ ...f.input, selection: null });
  const hard = session.getSnapshot().result!.request.trip.readyAt;
  session.applyPreferences({ priority: "cheapest", drivingAllowed: false });
  expect(session.getSnapshot().result?.request.trip).toMatchObject({
    priority: "cheapest",
    drivingAllowed: false,
    readyAt: hard,
  });
  let release!: (v: TravelRecoveryResponse) => void;
  session.options.transport = () =>
    new Promise((resolve) => (release = resolve));
  const pending = session.search({ ...f.input, selection: null });
  session.applyPreferences({ priority: "fewest_transfers" });
  release(response());
  await pending;
  expect(session.usable()).toBe(false);
  expect(session.getSnapshot().dirty).toBe(true);
});

for (const issue of ["hotel_changed", "flight_missing"] as const) {
  it(`does not preserve an eligible journey when clarification accompanies ${issue}`, async () => {
    const overnight = overnightTravelFixture();
    const full = {
      ...response(overnight.input),
      flightOffers: overnight.flightOffers,
      hotelOffers: overnight.hotelOffers,
      ...assessTravelSelection(overnight.input, overnight),
    };
    expect(full.journey?.selectable).toBe(true);
    const session = new TravelSession({
      now: () => overnight.now,
      transport: async () => full,
    });
    await session.search(overnight.input);
    session.select();
    expect(session.getSnapshot().selected).toBe(true);
    const changedHotel = structuredClone(overnight.hotel);
    changedHotel.costs[0].cents = 45000;
    changedHotel.fingerprint = hotelOfferFingerprint(changedHotel);
    const offers = {
      flightOffers: issue === "flight_missing" ? [] : overnight.flightOffers,
      hotelOffers:
        issue === "hotel_changed" ? [changedHotel] : overnight.hotelOffers,
    };
    session.options.transport = async (input) => ({
      ...response(input),
      ...offers,
      ...assessTravelSelection(input, { ...overnight, ...offers }),
      assistance: {
        status: "limited",
        summary: "Reselect the changed quote.",
        appliedPreferences: {},
        selectedPlanId: null,
        activity: [],
        clarification: {
          field: issue === "hotel_changed" ? "hotel" : "flight",
          reason: "required",
        },
      },
    });
    await session.search({
      ...overnight.input,
      refinement: "Recommend this flight journey",
    });
    const state = session.getSnapshot();
    expect(state.result?.selectionIssue).toBe(issue);
    expect(state.result?.hotelOffers).toEqual(offers.hotelOffers);
    expect(state.result?.flightOffers).toEqual(offers.flightOffers);
    expect(state.result?.journey).toBeNull();
    expect(state.flight).toBeNull();
    expect(state.hotel).toBeNull();
    session.select();
    expect(session.getSnapshot().selected).toBe(false);
  });
}
it("a clarification for a canceled null selection cannot restore earlier confirmed facts", async () => {
  const full = {
    ...response(),
    flightOffers: f.flightOffers,
    ...assessTravelSelection(f.input, f),
  };
  expect(full.journey?.selectable).toBe(true);
  const session = new TravelSession({
    now: () => f.now,
    transport: async () => full,
  });
  await session.search(f.input);
  session.reviewFacts();
  session.cancel();
  expect(session.usable()).toBe(true);
  expect(session.getSnapshot().flight).toBeNull();
  session.options.transport = async (input) => ({
    ...response(input),
    flightOffers: f.flightOffers,
    assistance: {
      status: "limited",
      summary: "Choose a flight and confirm facts.",
      appliedPreferences: {},
      selectedPlanId: null,
      activity: [],
      clarification: { field: "flight", reason: "required" },
    },
  });
  await session.search({
    ...f.input,
    selection: null,
    refinement: "Recommend a flight",
  });
  expect(session.getSnapshot().result?.request.selection).toBeNull();
  expect(session.getSnapshot().result?.journey).toBeNull();
  expect(session.getSnapshot().flight).toBeNull();
  session.select();
  expect(session.getSnapshot().selected).toBe(false);
});
it("accepts a newly infeasible assessment even when the exact binding returns a clarification", async () => {
  const overnight = overnightTravelFixture();
  overnight.input.trip.readyAt = overnight.now;
  overnight.input.selection!.facts.stay!.hotelArrivalAt =
    "2026-11-18T06:31:00-08:00";
  let current = overnight.now;
  const full = {
    ...response(overnight.input),
    flightOffers: overnight.flightOffers,
    hotelOffers: overnight.hotelOffers,
    ...assessTravelSelection(overnight.input, overnight),
  };
  expect(full.journey?.selectable).toBe(true);
  const session = new TravelSession({
    now: () => current,
    transport: async () => full,
  });
  await session.search(overnight.input);
  session.select();
  current = "2026-11-18T06:02:00-08:00";
  const latest = assessTravelSelection(overnight.input, {
    ...overnight,
    now: current,
  });
  expect(latest.selectionIssue).toBeNull();
  expect(latest.journey?.selectable).toBe(false);
  session.options.transport = async () => ({
    ...full,
    ...latest,
    generatedAt: current,
    assistance: {
      status: "limited",
      summary: "Confirm a new transfer timing.",
      appliedPreferences: {},
      selectedPlanId: null,
      activity: [],
      clarification: { field: "transfer", reason: "required" },
    },
  });
  await session.search({
    ...overnight.input,
    refinement: "Check my flight transfer",
  });
  expect(session.getSnapshot().result?.journey).toEqual(latest.journey);
  session.select();
  expect(session.getSnapshot().selected).toBe(false);
});
