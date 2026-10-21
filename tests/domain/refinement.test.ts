import { describe, expect, it } from "vitest";
import { daytimeFixture } from "@domain/fixtures";
import { ADAPTER_REVISION, MAX_FACT_AGE_MS } from "@domain/api";
import type { NormalizedFacts } from "@domain/api";
import {
  buildReuseKey,
  canReuseFacts,
} from "../../src/features/recovery/refinement";
const f = daytimeFixture();
const checkedAt = "2026-10-21T12:00:00Z";
const facts: NormalizedFacts = {
  candidates: f.candidates,
  arrival: {
    arrivalAt: f.request.arrivalAt,
    arrivalBasis: f.request.arrivalBasis,
  },
  arrivalEvidence: f.candidates[0].evidence,
  checkedAt,
  expiresAt: "2026-10-21T12:05:00Z",
  adapterRevision: ADAPTER_REVISION,
};
const key = (r = f.request, revision = ADAPTER_REVISION) =>
  buildReuseKey(r, revision);
const cache = {
  get inputKey() {
    return key();
  },
  facts,
};
describe("one tab normalized fact reuse", () => {
  it("ignores only priority, canonicalizes object keys and preserves array order", () => {
    expect(key({ ...f.request, priority: "cheapest" })).toBe(key());
    expect(
      key(
        Object.fromEntries(
          Object.entries(f.request).reverse(),
        ) as typeof f.request,
      ),
    ).toBe(key());
    expect(
      key({
        ...f.request,
        confirmedOptions: [...f.request.confirmedOptions].reverse(),
      }),
    ).not.toBe(key());
  });
  it("includes every other original request field, nested evidence and adapter revision", () => {
    for (const [field, value] of Object.entries(f.request)) {
      if (field === "priority") continue;
      expect(
        buildReuseKey(
          {
            ...f.request,
            [field]:
              value === null
                ? "changed"
                : typeof value === "boolean"
                  ? !value
                  : typeof value === "number"
                    ? value + 1
                    : [value, "changed"],
          } as typeof f.request,
          ADAPTER_REVISION,
        ),
        field,
      ).not.toBe(key());
    }
    const changed = structuredClone(f.request);
    changed.confirmedOptions[0].evidence[0].checkedAt =
      "2026-11-18T07:56:00-05:00";
    expect(key(changed)).not.toBe(key());
    expect(key(f.request, "next-adapter")).not.toBe(key());
  });
  it("uses real collection time, rejects expiry at the boundary and cannot extend original evidence", () => {
    expect(
      canReuseFacts(
        cache,
        { ...f.request, priority: "cheapest" },
        Date.parse(checkedAt) + 1,
        ADAPTER_REVISION,
      ),
    ).toBe(true);
    expect(
      canReuseFacts(
        cache,
        f.request,
        Date.parse(checkedAt) + MAX_FACT_AGE_MS,
        ADAPTER_REVISION,
      ),
    ).toBe(false);
    expect(
      canReuseFacts(
        cache,
        f.request,
        Date.parse(checkedAt) - 1,
        ADAPTER_REVISION,
      ),
    ).toBe(false);
    const expired = structuredClone(cache);
    expired.facts.candidates[0].evidence[0].expiresAt = checkedAt;
    expect(
      canReuseFacts(
        expired,
        f.request,
        Date.parse(checkedAt) + 1,
        ADAPTER_REVISION,
      ),
    ).toBe(false);
  });
  it("rejects factual, mode, revision and absent-cache changes", () => {
    for (const request of [
      { ...f.request, budgetCents: 1 },
      { ...f.request, mode: "real" as const },
    ])
      expect(
        canReuseFacts(cache, request, Date.parse(checkedAt), ADAPTER_REVISION),
      ).toBe(false);
    expect(
      canReuseFacts(cache, f.request, Date.parse(checkedAt), "different"),
    ).toBe(false);
    expect(
      canReuseFacts(null, f.request, Date.parse(checkedAt), ADAPTER_REVISION),
    ).toBe(false);
  });
});
