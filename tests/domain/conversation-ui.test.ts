import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import App from "../../src/App";
import { nextHotelFact } from "../../src/features/recovery/HotelJourneyFacts";
import { emptyDraft } from "../../src/features/recovery/formModel";
import { conversationContext, matchesConversation, appendConversation } from "../../src/features/recovery/conversation";
import { recoveryReducer, initialRecoveryState } from "../../src/features/recovery/state";
import { daytimeFixture } from "@domain/fixtures";
import { planRecovery } from "@domain/planner";

describe("calm recovery workspace", () => {
  it("starts with a short arrival form and source-checking action", () => {
    vi.stubGlobal("window", { location: { pathname: "/" } });
    const html = renderToStaticMarkup(createElement(App));
    vi.unstubAllGlobals();
    expect(html).toContain("Let&#x27;s get you to Portland");
    expect(html).toContain("Find my options");
    expect(html).toContain("As soon as possible");
    expect(html).not.toContain('id="investigate-sources"');
    expect(html).not.toContain('id="originalDepartureAt"');
  });
  it("retains the current comparison when assistance only asks a factual question", () => {
    const f = daytimeFixture();
    const result = planRecovery(f.request, f.candidates, { now: f.now });
    const current = { ...initialRecoveryState, sequence: 3, status: "planning" as const, result, request: f.request, selectedPlanId: result.plans[0].id };
    const assistance = { status: "limited", summary: "Clarify your arrival", appliedPreferences: {}, selectedPlanId: null, activity: [], clarification: { field: "arrivalAt", reason: "ambiguous" } } as const;
    const next = recoveryReducer(current, { type: "CLARIFICATION_RECEIVED", sequence: 3, assistance } as never);
    expect(next.result).toBe(result);
    expect(next.stale).toBe(false);
    expect(next.assistance).toEqual(assistance);
    expect(next.selectedPlanId).toBe(current.selectedPlanId);
  });
});

it("bounds tab-only context, excludes the current message and rejects wrong or obsolete echoes", () => {
  const turns = Array.from({ length: 20 }, (_, index) => ({ id: String(index), role: "user" as const, revision: 1, content: "x".repeat(1000) }));
  const context = conversationContext("current", 3, turns);
  expect(context.history.length).toBeLessThanOrEqual(12);
  expect(context.history.reduce((sum, turn) => sum + turn.content.length, 0)).toBeLessThanOrEqual(8000);
  expect(matchesConversation(context, { turnId: "other", baseRevision: 3 }, 3)).toBe(false);
  expect(matchesConversation(context, { turnId: "current", baseRevision: 2 }, 3)).toBe(false);
  expect(matchesConversation(context, { turnId: "current", baseRevision: 3 }, 4)).toBe(false);
  expect(matchesConversation(context, { turnId: "current", baseRevision: 3 }, 3)).toBe(true);
  expect(appendConversation(turns, { id: "new", role: "assistant", revision: 3, content: "x".repeat(2000) }).at(-1)?.content).toHaveLength(1000);
});

it("focuses invalid hotel allowances and date-specific departures before moving to another fact", () => {
  const draft = emptyDraft();
  draft.hotel.hotelId = "property-one";
  draft.hotel.hotelMinutes = "abc";
  expect(nextHotelFact(draft)).toBe("hotelMinutes");
  draft.hotel.hotelMinutes = "20"; draft.hotel.checkinMinutes = "15";
  draft.checkout = "2026-11-19"; draft.hotel.leaveHotelAt = "2026-11-18T09:00";
  expect(nextHotelFact(draft)).toBe("leaveHotelAt");
  draft.hotel.leaveHotelAt = "2026-11-19T09:00";
  expect(nextHotelFact(draft)).toBe("stationMinutes");
});

it("keeps malformed hotel prices and service facts in focused correction controls", () => {
  const complete = () => {
    const draft = emptyDraft();
    draft.checkin = "2026-11-18"; draft.checkout = "2026-11-19";
    draft.hotel = { hotelId:"property-one", hotelMinutes:"20", hotelCost:"0", hotelKind:"transfer", hotelCheckedAt:"2026-10-22T12:00:00Z", checkinMinutes:"15", leaveHotelAt:"2026-11-19T09:00", stationMinutes:"25", stationCost:"0", stationKind:"transfer", stationCheckedAt:"2026-10-22T12:00:00Z" };
    draft.transit = { ...draft.transit, enabled:true, title:"Checked bus", departure:"2026-11-19T10:00", arrival:"2026-11-19T12:00", departureTerminal:"Actual Boston stop", arrivalTerminal:"Actual Portland stop", boardingMinutes:"15", accessMinutes:"30", finalMinutes:"15", fare:"35" };
    return draft;
  };
  expect(nextHotelFact(complete())).toBe("ready");
  for (const [key, value, step] of [["hotelCost","-1","hotelMinutes"], ["stationCost","1.234","stationMinutes"], ["checkinMinutes","1.5","checkinMinutes"]] as const) {
    const draft = complete(); draft.hotel[key] = value; expect(nextHotelFact(draft)).toBe(step);
  }
  for (const [key,value] of [["departure","2026-11-18T10:00"], ["arrival","2026-11-19T09:00"], ["boardingMinutes",""], ["accessMinutes","-1"], ["finalMinutes","1.5"], ["fare","1.234"], ["finalCost","-1"]] as const) {
    const draft = complete(); draft.transit[key] = value; expect(nextHotelFact(draft)).toBe("service");
  }
});
