import { describe, expect, it } from "vitest";
import { overnightFixture } from "@domain/fixtures";
import { planRecovery } from "@domain/planner";
import {
  initialRecoveryState,
  recoveryReducer,
} from "../../src/features/recovery/state";
import {
  SAVED_PLAN_KEY,
  SavedSelectionSchema,
  readSavedSelection,
  writeSavedSelection,
  clearSavedSelection,
  selectionSnapshot,
  refreshRequest,
} from "../../src/features/recovery/savedSelection";

const f = overnightFixture();
const result = planRecovery(f.request, f.candidates, { now: f.now });
const plan = result.plans.find((p) => p.hotel)!;
const selectedAt = "2026-10-21T15:02:03Z";
const snapshot = {
  schemaVersion: 1 as const,
  request: f.request,
  plan,
  generatedAt: result.generatedAt,
  selectedAt,
};
function selectedState() {
  let s = recoveryReducer(initialRecoveryState, {
    type: "REQUEST_STARTED",
    request: f.request,
    sequence: 1,
  });
  s = recoveryReducer(s, { type: "RESULT_RECEIVED", result, sequence: 1 });
  return recoveryReducer(s, {
    type: "PLAN_SELECTED",
    planId: plan.id,
    now: f.now,
  });
}
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe("device saved selection", () => {
  it("round trips the full hotel, original provenance and unknown charges without making a current result", () => {
    const storage = memory();
    expect(readSavedSelection(storage)).toEqual({ ok: true, value: null });
    const value = structuredClone(snapshot);
    value.plan.legs[0].costs.push({
      label: "Unknown charge",
      cents: null,
      currency: "USD",
      includedInOtherCharge: false,
    });
    expect(writeSavedSelection(storage, value)).toEqual({ ok: true, value });
    expect(readSavedSelection(storage)).toEqual({ ok: true, value });
    expect(storage.values.size).toBe(1);
    expect(clearSavedSelection(storage)).toEqual({ ok: true, value: null });
    expect(readSavedSelection(storage)).toEqual({ ok: true, value: null });
  });
  it("replaces one snapshot only after a successful write", () => {
    const storage = memory();
    writeSavedSelection(storage, snapshot);
    const replacement = { ...snapshot, selectedAt: "2026-10-21T15:03:00Z" };
    expect(writeSavedSelection(storage, replacement).ok).toBe(true);
    expect(readSavedSelection(storage)).toEqual({
      ok: true,
      value: replacement,
    });
    expect(storage.values.size).toBe(1);
  });
  it.each([
    "{",
    JSON.stringify({ ...snapshot, schemaVersion: 2 }),
    JSON.stringify({ ...snapshot, plan: { ...plan, hotel: undefined } }),
    JSON.stringify({ ...snapshot, selectedAt: "2026-10-21T15:03" }),
  ])("retains invalid stored data for explicit deletion: %s", (raw) => {
    const storage = memory();
    storage.setItem(SAVED_PLAN_KEY, raw);
    expect(readSavedSelection(storage)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/delete.*retry/i),
    });
    expect(writeSavedSelection(storage, snapshot)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/delete.*retry/i),
    });
    expect(storage.getItem(SAVED_PLAN_KEY)).toBe(raw);
    expect(clearSavedSelection(storage).ok).toBe(true);
    expect(writeSavedSelection(storage, snapshot).ok).toBe(true);
  });
  it("does not overwrite an unreadable record and retries storage after access is restored", () => {
    const backing = memory();
    writeSavedSelection(backing, snapshot);
    const original = backing.getItem(SAVED_PLAN_KEY);
    let blocked = true;
    const storage = {
      ...backing,
      getItem: (key: string) => {
        if (blocked) throw new Error("Read blocked");
        return backing.getItem(key);
      },
    };
    const replacement = { ...snapshot, selectedAt: "2026-10-21T15:04:00Z" };
    expect(writeSavedSelection(storage, replacement)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/read.*storage/i),
    });
    expect(backing.getItem(SAVED_PLAN_KEY)).toBe(original);
    blocked = false;
    expect(writeSavedSelection(storage, replacement)).toEqual({
      ok: true,
      value: replacement,
    });
    expect(readSavedSelection(storage)).toEqual({
      ok: true,
      value: replacement,
    });
  });
  it("rejects unknown keys and mismatched plan provenance", () => {
    expect(
      SavedSelectionSchema.safeParse({ ...snapshot, extra: true }).success,
    ).toBe(false);
    const realRequest = {
      ...snapshot.request,
      mode: "real",
      confirmedOptions: [],
    };
    expect(
      SavedSelectionSchema.safeParse({ ...snapshot, request: realRequest })
        .success,
    ).toBe(false);
  });
  it("reports blocked reads, quota writes and blocked deletion without success", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSavedSelection(storage)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/read/i),
    });
    expect(writeSavedSelection(storage, snapshot)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/save.*storage/i),
    });
    expect(clearSavedSelection(storage)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/delete/i),
    });
  });
  it("snapshots only the current selection and preserves comparison times with an actual save time", () => {
    const s = selectedState();
    expect(selectionSnapshot(s, f.now, selectedAt)).toEqual({
      ok: true,
      value: snapshot,
    });
    for (const invalid of [
      initialRecoveryState,
      { ...s, stale: true },
      { ...s, status: "planning" as const },
      { ...s, selectedPlanId: "missing" },
    ]) {
      expect(selectionSnapshot(invalid, f.now, selectedAt).ok).toBe(false);
    }
    expect(selectionSnapshot(s, plan.evidenceExpiresAt!, selectedAt).ok).toBe(
      false,
    );
    const unselectable = {
      ...s,
      result: { ...result, plans: [{ ...plan, selectable: false }] },
    };
    expect(selectionSnapshot(unselectable, f.now, selectedAt).ok).toBe(false);
  });
  it("checks nested evidence and hotel quote expiry even if the aggregate expiry is absent", () => {
    const s = selectedState();
    const altered = structuredClone(plan);
    altered.evidenceExpiresAt = null;
    altered.hotel!.quoteExpiresAt = f.now;
    expect(
      selectionSnapshot(
        { ...s, result: { ...result, plans: [altered] } },
        f.now,
        selectedAt,
      ).ok,
    ).toBe(false);
    altered.hotel!.quoteExpiresAt = null;
    altered.legs[0].evidence[0].expiresAt = f.now;
    expect(
      selectionSnapshot(
        { ...s, result: { ...result, plans: [altered] } },
        f.now,
        selectedAt,
      ).ok,
    ).toBe(false);
  });
  it("refreshes using original evidence and invalidates old provider facts rather than claiming a new check", () => {
    expect(refreshRequest(snapshot)).toEqual(snapshot.request);
    const real = structuredClone(snapshot);
    const convert = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(convert);
      else if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if (obj.type === "synthetic") {
          obj.type = "live";
          obj.environment = "production";
          obj.expiresAt = null;
        }
        Object.values(obj).forEach(convert);
      }
    };
    real.request.mode = "real";
    convert(real.request.confirmedOptions);
    const refreshed = refreshRequest(real);
    expect(refreshed.confirmedOptions[0].kind).toBe("overnight");
    const evidence =
      refreshed.confirmedOptions[0].kind === "overnight"
        ? refreshed.confirmedOptions[0].hotel.evidence[0]
        : null;
    expect(evidence).toMatchObject({
      type: "live",
      checkedAt:
        f.candidates[0].kind === "overnight"
          ? f.candidates[0].hotel.evidence[0].checkedAt
          : expect.any(String),
      expiresAt: snapshot.generatedAt,
    });
    const original = real.request.confirmedOptions[0];
    expect(
      original.kind === "overnight" && original.hotel.evidence[0].expiresAt,
    ).toBeNull();
  });
});
