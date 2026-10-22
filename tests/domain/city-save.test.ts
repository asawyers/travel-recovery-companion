import { expect, it } from "vitest";
import { cityFixture } from "@domain/city-fixtures";
import { planCityRecovery } from "@domain/city-planner";
import { daytimeFixture } from "@domain/fixtures";
import { planRecovery } from "@domain/planner";
import {
  readCityHistory,
  writeCitySelection,
  citySnapshot,
  refreshCityRequest,
} from "../../src/features/city/savedSelection";
import {
  readSavedSelection,
  SAVED_PLAN_KEY,
} from "../../src/features/recovery/savedSelection";
const f = cityFixture();
const result = () =>
  planCityRecovery(f.request, f.candidates, {
    now: f.now,
    origin: f.origin,
    destination: f.destination,
  });
function storage(raw: string | null = null) {
  return {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
    removeItem: () => {
      raw = null;
    },
  };
}
function snapshot() {
  return citySnapshot(
    result(),
    result().plans[0].id,
    "2026-11-18T07:56:00-05:00",
  );
}
it("round trips exact v2 timestamps and is recognized safely by the v1 reader", () => {
  const s = storage(),
    v = snapshot();
  expect(v.ok).toBe(true);
  if (!v.ok) throw Error(v.message);
  expect(writeCitySelection(s, v.value).ok).toBe(true);
  expect(readCityHistory(s)).toEqual({ ok: true, value: v.value });
  expect(readSavedSelection(s)).toEqual({ ok: true, value: null });
  expect(refreshCityRequest(v.value)).toEqual(v.value.request);
});
it("reads valid v1 history without migration or changed timestamps", () => {
  const old = daytimeFixture();
  const r = planRecovery(old.request, old.candidates, { now: old.now });
  const v = {
    schemaVersion: 1,
    request: r.request,
    plan: r.plans[0],
    generatedAt: old.now,
    selectedAt: old.now,
  };
  expect(readCityHistory(storage(JSON.stringify(v)))).toEqual({
    ok: true,
    value: v,
  });
});
it("never silently overwrites unknown versions, invalid records or blocked storage", () => {
  const v = snapshot();
  if (!v.ok) throw Error(v.message);
  for (const raw of ["{bad", '{"schemaVersion":99}', '{"schemaVersion":2}']) {
    const s = storage(raw);
    expect(writeCitySelection(s, v.value).ok).toBe(false);
    expect(s.getItem()).toBe(raw);
  }
  expect(
    readCityHistory({
      getItem: () => {
        throw Error("blocked");
      },
      setItem() {},
      removeItem() {},
    }).ok,
  ).toBe(false);
  expect(SAVED_PLAN_KEY).toBe("travel-recovery:selected:v1");
});
it("rejects Google selected plans and filters all Google alternatives from manual snapshots", () => {
  const r = result(),
    manual = r.plans[0];
  r.request.confirmedOptions.push({
    ...f.candidates[0],
    id: "google",
    evidence: [
      {
        ...f.candidates[0].evidence[0],
        type: "estimated",
        provider: "Google Maps Routes API",
        environment: "production",
      },
    ],
  });
  // Keep synthetic mode evidence valid while exercising retention independently.
  r.request.confirmedOptions[1].evidence[0].environment = "synthetic";
  r.request.confirmedOptions[1].evidence[0].type = "synthetic";
  const v = citySnapshot(r, manual.id, "2026-11-18T07:56:00-05:00");
  expect(v.ok).toBe(true);
  if (v.ok) expect(v.value.request.confirmedOptions).toHaveLength(1);
  manual.evidence[0].provider = "Google Maps Routes API";
  expect(citySnapshot(r, manual.id, "2026-11-18T07:56:00-05:00").ok).toBe(
    false,
  );
});
