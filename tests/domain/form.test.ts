import { describe, expect, it } from "vitest";
import {
  buildRequest,
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
