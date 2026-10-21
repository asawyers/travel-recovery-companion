import { describe, expect, it } from "vitest";
import {
  buildRequest,
  draftFromRequest,
  emptyDraft,
} from "../../src/features/recovery/formModel";
import { planRecovery } from "@domain/planner";
const now = "2026-10-21T12:00:00Z";
const manual = () => ({
  ...emptyDraft(),
  arrivalAt: "2026-11-18T08:00:30",
  originalDepartureAt: "2026-11-18T09:15",
  deadlineAt: "2026-11-18T14:00",
  transit: {
    ...emptyDraft().transit,
    enabled: true,
    title: "Traveler bus",
    departure: "2026-11-18T10:00",
    arrival: "2026-11-18T12:00",
    departureTerminal: "Boston terminal",
    arrivalTerminal: "Portland terminal",
    accessMinutes: "15",
    finalMinutes: "20",
    fare: "35",
    accessCost: "0",
    finalCost: "12",
    checkedAt: now,
  },
});
describe("traveler-entered trip adapter", () => {
  it("preserves exact gate seconds, explicit free transfers and confirmation timestamps through refinements", () => {
    const d = manual();
    const first = buildRequest(d, "real", [], now).request!;
    expect(first.arrivalAt).toBe("2026-11-18T08:00:30-05:00");
    const later = buildRequest(
      { ...d, priority: "cheapest" },
      "real",
      [],
      "2026-10-22T12:00:00Z",
    ).request!;
    expect(later.confirmedOptions).toEqual(first.confirmedOptions);
    expect(
      planRecovery(later, later.confirmedOptions, { now }).plans[0],
    ).toMatchObject({
      knownCostCents: 4700,
      priceComplete: true,
      durationMinutes: 259.5,
    });
  });
  it("keeps blank prices unknown and excludes them from a hard budget", () => {
    const d = manual();
    d.transit.fare = "";
    d.budget = "100";
    d.budgetMode = "hard";
    const r = buildRequest(d, "real", [], now).request!;
    const result = planRecovery(r, r.confirmedOptions, { now });
    expect(result.plans).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({
      knownCostCents: 1200,
      priceComplete: false,
    });
  });
  it("omits an incomplete optional option with an actionable reason while preserving valid trip fields", () => {
    const d = manual();
    d.transit.arrivalTerminal = "";
    const result = buildRequest(d, "real", [], now);
    expect(result.request?.arrivalAt).toBe("2026-11-18T08:00:30-05:00");
    expect(result.request?.confirmedOptions).toEqual([]);
    expect(result.warnings.join()).toMatch(/omitted.*both terminals/);
    expect(d.transit.title).toBe("Traveler bus");
  });
  it("rejects ambiguous and missing DST wall times without shifting them", () => {
    for (const at of ["2026-11-01T01:30", "2026-03-08T02:30"]) {
      const d = manual();
      d.arrivalAt = at;
      const result = buildRequest(d, "real", [], now);
      expect(result.request).toBeNull();
      expect(result.errors.arrivalAt).toMatch(/ambiguous or nonexistent/);
    }
  });
  it("does not infer nationality when an overnight stay is requested", () => {
    const d = manual();
    d.overnightAllowed = true;
    d.checkin = "2026-11-18";
    d.checkout = "2026-11-19";
    expect(
      buildRequest(d, "real", [], now).errors.guestNationality,
    ).toBeTruthy();
  });
});

const enteredCar = () => ({
  ...emptyDraft().car,
  enabled: true,
  title: "Traveler rental",
  pickup: "Boston rental pickup",
  dropoff: "Portland rental return",
  accessMinutes: "15",
  accessCost: "0",
  pickupMinutes: "30",
  driveMinutes: "110",
  returnMinutes: "15",
  walkMinutes: "10",
  rental: "100",
  fees: "25",
  fuel: "15",
  tolls: "5",
  other: "0",
  checkedAt: now,
});
it("names an invalid car charge and keeps the supported transit alternative and original entries", () => {
  const d = manual();
  d.car = { ...enteredCar(), fuel: "-1" };
  const result = buildRequest(d, "real", [], now);
  expect(result.warnings.join()).toMatch(
    /Car option omitted: Fuel must be a nonnegative USD amount/,
  );
  expect(result.warnings.join()).not.toMatch(/\[|Zod|stack|invalid_format/);
  expect(result.request?.confirmedOptions.map((option) => option.id)).toEqual([
    "manual-transit",
  ]);
  expect(d.car.fuel).toBe("-1");
});
it("explains invalid transit chronology while retaining a supported rental and entered times", () => {
  const d = manual();
  d.car = enteredCar();
  d.transit.arrival = "2026-11-18T09:00";
  const result = buildRequest(d, "real", [], now);
  expect(result.warnings.join()).toMatch(
    /Transit option omitted: Transit arrival must follow departure/,
  );
  expect(result.warnings.join()).not.toMatch(/\[|Zod|stack|custom/);
  expect(result.request?.confirmedOptions.map((option) => option.id)).toEqual([
    "manual-car",
  ]);
  expect(d.transit.arrival).toBe("2026-11-18T09:00");
});

it("restores manual controls and preserves exact untouched request facts and provenance", () => {
  const original = buildRequest(manual(), "real", [], now).request!;
  original.arrivalAt = "2026-11-18T13:00:30Z";
  original.arrivalBasis = "actual_gate";
  original.flight = { ident: "TEST123", departureDate: "2026-11-18" };
  original.confirmedOptions[0].evidence[0].provider =
    "Previously sanitized source";
  const draft = draftFromRequest(original);
  expect(draft.transit.enabled).toBe(true);
  expect(draft.transit.title).toBe("Traveler bus");
  expect(
    buildRequest(
      { ...draft, priority: "cheapest" },
      "real",
      [],
      "2026-10-22T12:00:00Z",
      original,
    ).request,
  ).toEqual({
    ...original,
    priority: "cheapest",
    flight: null,
    arrivalBasis: "traveler_confirmed",
  });
  const repriced = buildRequest(
    {
      ...draft,
      transit: {
        ...draft.transit,
        fare: "42",
        checkedAt: "2026-10-22T12:00:00Z",
      },
    },
    "real",
    [],
    now,
    original,
  ).request!;
  expect(repriced.confirmedOptions).toHaveLength(1);
  expect(repriced.confirmedOptions[0]).toMatchObject({
    fareCents: 4200,
    evidence: [{ checkedAt: "2026-10-22T12:00:00Z" }],
  });
  expect(original.confirmedOptions[0]).toMatchObject({ fareCents: 3500 });
});

it("restores manual rental controls while retaining original options for factual constraint edits", () => {
  const input = manual();
  input.car = enteredCar();
  const original = buildRequest(input, "real", [], now).request!;
  const restored = draftFromRequest(original);
  expect(restored.car).toEqual(input.car);
  const budgetChange = buildRequest(
    { ...restored, budget: "200" },
    "real",
    [],
    now,
    original,
  ).request!;
  expect(budgetChange.budgetCents).toBe(20000);
  expect(budgetChange.confirmedOptions).toEqual(original.confirmedOptions);
  const removedCar = buildRequest(
    { ...restored, car: { ...restored.car, enabled: false } },
    "real",
    [],
    now,
    original,
  ).request!;
  expect(removedCar.confirmedOptions.map((option) => option.id)).toEqual([
    "manual-transit",
  ]);
});

it("accepts the traveler gate arrival without flight details or onward facts", () => {
  const d = { ...manual(), transit: { ...manual().transit, enabled: false } };
  expect(buildRequest(d, "real", [], now).request).toMatchObject({
    arrivalAt: "2026-11-18T08:00:30-05:00",
    arrivalBasis: "traveler_confirmed",
    flight: null,
    confirmedOptions: [],
  });
});
it("ignores legacy flight lookup fields when comparing a restored trip", () => {
  const original = buildRequest(manual(), "real", [], now).request!;
  original.arrivalAt = "2026-11-18T13:00:30Z";
  original.arrivalBasis = "actual_gate";
  original.flight = { ident: "ASA123", departureDate: "2026-11-18" };
  const draft = draftFromRequest(original);
  expect(draft).not.toHaveProperty("arrivalChoice");
  expect(draft).not.toHaveProperty("flightIdent");
  expect(draft).not.toHaveProperty("flightDepartureDate");
  const compared = buildRequest(draft, "real", [], now, original).request!;
  expect(compared).toMatchObject({
    arrivalAt: original.arrivalAt,
    arrivalBasis: "traveler_confirmed",
    flight: null,
    confirmedOptions: original.confirmedOptions,
  });
  expect(original.flight).toEqual({ ident: "ASA123", departureDate: "2026-11-18" });
  expect(original.arrivalBasis).toBe("actual_gate");
  const changed = buildRequest(
    { ...draft, arrivalAt: "2026-11-18T08:15:30" }, "real", [], now, original,
  ).request!;
  expect(changed.arrivalAt).toBe("2026-11-18T08:15:30-05:00");
  expect(changed.arrivalBasis).toBe("traveler_confirmed");
  expect(changed.flight).toBeNull();
});
