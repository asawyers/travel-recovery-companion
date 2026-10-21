import { expect, it } from "vitest";
import { buildRequest, draftFromRequest, emptyDraft, hotelSandboxDraft } from "../../src/features/recovery/formModel";
import { buildReuseKey } from "../../src/features/recovery/refinement";

const now = "2026-12-31T23:30:00Z";
function demoDraft() {
  return {
    ...emptyDraft(), hotelSandbox: true,
    arrivalAt: "2027-01-01T18:00", originalDepartureAt: "2027-01-01T18:15", deadlineAt: "2027-01-02T14:00",
    overnightAllowed: true, checkin: "2027-01-01", checkout: "2027-01-02", guestNationality: "US",
    transit: { ...emptyDraft().transit, enabled: true, title: "Fictional demo bus — test fare", departure: "2027-01-02T10:00", arrival: "2027-01-02T12:00", departureTerminal: "Fictional Boston boarding stop", arrivalTerminal: "Fictional Portland stop", fare: "35", accessMinutes: "30", accessCost: "0", finalMinutes: "15", finalCost: "0", checkedAt: now },
  };
}
it("starts ordinary trips outside the explicit hotel sandbox", () => {
  expect(emptyDraft()).toHaveProperty("hotelSandbox", false);
});
it("builds editable sandbox onward facts with synthetic provenance and round-trips them", () => {
  const built = buildRequest(demoDraft(), "synthetic", [], now);
  expect(built.errors).toEqual({});
  expect(built.request).toMatchObject({ hotelDataMode: "sandbox", confirmedOptions: [{ id: "manual-transit", evidence: [{ type: "synthetic", environment: "synthetic" }], access: { evidence: [{ type: "synthetic", environment: "synthetic" }] } }] });
  const request = built.request!;
  expect(draftFromRequest(request)).toMatchObject({ hotelSandbox: true, transit: { enabled: true, title: demoDraft().transit.title } });
  const edited = draftFromRequest(request); edited.transit.fare = "40";
  expect(buildRequest(edited, "synthetic", [], now, request).request?.confirmedOptions).toMatchObject([{ id: "manual-transit", fareCents: 4000 }]);
  expect(buildRequest({ ...edited, hotelSandbox: false }, "real", [], now).request).not.toHaveProperty("hotelDataMode");
});
it("binds selected sandbox property transfers without fabricating a service date", () => {
  const draft = demoDraft();
  draft.hotel = { hotelId: "sandbox-property", checkinMinutes: "20", leaveHotelAt: "2027-01-02T09:00", hotelMinutes: "20", hotelCost: "", hotelKind: "transfer", hotelCheckedAt: now, stationMinutes: "25", stationCost: "0", stationKind: "walk", stationCheckedAt: now };
  const request = buildRequest(draft, "synthetic", [], now).request!;
  expect(request.hotelSelection).toMatchObject({ hotelId: "sandbox-property", nextDayTransitId: "manual-transit", hotelAccess: { minutes: 20, costCents: null }, stationAccess: { minutes: 25, costCents: 0 } });
  expect(buildReuseKey(request, "revision")).not.toBe(buildReuseKey({ ...request, hotelDataMode: undefined }, "revision"));
  draft.transit.departure = "2027-01-01T10:00";
  const invalid = buildRequest(draft, "synthetic", [], now);
  expect(invalid.request?.hotelSelection).toBeUndefined();
  expect(invalid.warnings.join()).toMatch(/checkout-date/);
});

it("creates a future one-night demo from the current New York calendar across year and DST boundaries", () => {
  for (const [clock, checkin, checkout] of [
    ["2026-12-31T23:30:00Z", "2027-01-01", "2027-01-02"],
    ["2027-01-01T03:00:00Z", "2027-01-01", "2027-01-02"],
    ["2026-10-31T23:00:00Z", "2026-11-01", "2026-11-02"],
  ]) {
    const draft = hotelSandboxDraft(clock);
    expect(draft).toMatchObject({ checkin, checkout, hotelSandbox: true, overnightAllowed: true, hotel: { hotelId: "", hotelMinutes: "", stationMinutes: "" }, transit: { departure: `${checkout}T10:00`, checkedAt: clock } });
    const request = buildRequest(draft, "synthetic", [], clock).request!;
    expect(request.confirmedOptions).toHaveLength(1);
    expect(request.confirmedOptions[0]).toMatchObject({ title: "Fictional demo bus — test fare", evidence: [{ type: "synthetic", environment: "synthetic" }] });
  }
});
