import { describe, expect, it } from "vitest";
import { daytimeFixture } from "@domain/fixtures";
import { planRecovery } from "@domain/planner";
import {
  initialRecoveryState,
  recoveryReducer,
} from "../../src/features/recovery/state";
const f = daytimeFixture();
const result = planRecovery(f.request, f.candidates, { now: f.now });
describe("guest comparison state", () => {
  it("ignores an older result after a newer request completes", () => {
    let s = recoveryReducer(initialRecoveryState, {
      type: "REQUEST_STARTED",
      request: f.request,
      sequence: 1,
    });
    s = recoveryReducer(s, {
      type: "REQUEST_STARTED",
      request: { ...f.request, priority: "cheapest" },
      sequence: 2,
    });
    const newer = {
      ...result,
      request: { ...f.request, priority: "cheapest" as const },
    };
    s = recoveryReducer(s, {
      type: "RESULT_RECEIVED",
      sequence: 2,
      result: newer,
    });
    s = recoveryReducer(s, { type: "RESULT_RECEIVED", sequence: 1, result });
    expect(s.result).toBe(newer);
    expect(s.status).toBe("results");
  });
  it("invalidates selection and pending results as soon as an input changes", () => {
    let s = recoveryReducer(initialRecoveryState, {
      type: "REQUEST_STARTED",
      request: f.request,
      sequence: 1,
    });
    s = recoveryReducer(s, { type: "RESULT_RECEIVED", sequence: 1, result });
    s = recoveryReducer(s, {
      type: "PLAN_SELECTED",
      planId: "bus",
      now: f.now,
    });
    expect(s.selectedPlanId).toBe("bus");
    s = recoveryReducer(s, { type: "INPUT_EDITED" });
    s = recoveryReducer(s, { type: "RESULT_RECEIVED", sequence: 1, result });
    expect(s.result).toBe(result);
    expect(s.stale).toBe(true);
    expect(s.selectedPlanId).toBeNull();
    expect(s.persistence).toBe("unsaved");
  });
  it("does not select an expired plan or claim a guest selection was saved", () => {
    let s = recoveryReducer(initialRecoveryState, {
      type: "REQUEST_STARTED",
      request: f.request,
      sequence: 1,
    });
    s = recoveryReducer(s, { type: "RESULT_RECEIVED", sequence: 1, result });
    s = recoveryReducer(s, {
      type: "PLAN_SELECTED",
      planId: "bus",
      now: "2026-11-20T00:00:00Z",
    });
    expect(s.selectedPlanId).toBeNull();
    s = recoveryReducer(s, {
      type: "PLAN_SELECTED",
      planId: "bus",
      now: f.now,
    });
    expect(s.persistence).toBe("unsaved");
  });
  it("retains the current request on a planner error and ignores stale errors", () => {
    let s = recoveryReducer(initialRecoveryState, {
      type: "REQUEST_STARTED",
      request: f.request,
      sequence: 1,
    });
    s = recoveryReducer(s, {
      type: "REQUEST_FAILED",
      sequence: 1,
      message: "Try again",
    });
    expect(s.request).toEqual(f.request);
    expect(s.status).toBe("error");
    expect(
      recoveryReducer(s, {
        type: "REQUEST_FAILED",
        sequence: 0,
        message: "Old",
      }).error,
    ).toBe("Try again");
  });
});

it("keeps the last comparison visibly stale and unselectable after a failed replan", () => {
  let s = recoveryReducer(initialRecoveryState, {
    type: "REQUEST_STARTED",
    request: f.request,
    sequence: 1,
  });
  s = recoveryReducer(s, { type: "RESULT_RECEIVED", sequence: 1, result });
  s = recoveryReducer(s, {
    type: "REQUEST_STARTED",
    request: { ...f.request, budgetCents: 1 },
    sequence: 2,
  });
  s = recoveryReducer(s, {
    type: "REQUEST_FAILED",
    sequence: 2,
    message: "Unavailable",
  });
  expect(s.result).toBe(result);
  expect(s.stale).toBe(true);
  expect(
    recoveryReducer(s, { type: "PLAN_SELECTED", planId: "bus", now: f.now })
      .selectedPlanId,
  ).toBeNull();
  s = recoveryReducer(s, { type: "RESET" });
  expect(s.result).toBeNull();
});
