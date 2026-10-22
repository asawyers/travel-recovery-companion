import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cityFixture, namedCityFixtures } from "@domain/city-fixtures";
import {
  emptyCityDraft,
  buildCityRequest,
  localToOffset,
  cityLocalInput,
} from "../../src/features/city/formModel";
import {
  cityReuseKey,
  canReuseCityFacts,
  responseMatchesRequest,
} from "../../src/features/city/session";
import {
  buildManualCityCandidate,
  emptyManualDraft,
} from "../../src/features/city/manualModel";
import { CityRecoveryApp } from "../../src/features/city/CityRecoveryApp";
const f = cityFixture();
describe("city starter", () => {
  it("starts with two empty cities, ASAP and no flight or airport assumptions", () => {
    const d = emptyCityDraft();
    expect(d.origin).toBeNull();
    expect(d.destination).toBeNull();
    expect(d.goal).toBe("asap");
    expect(d.readyLocal).toBe("");
    const html = renderToStaticMarkup(createElement(CityRecoveryApp));
    expect(html).toContain("Where are you trying to get to?");
    expect(html).toContain("From city");
    expect(html).toContain("To city");
    expect(html).toContain("When do you need to get there?");
    expect(html).not.toMatch(
      /45 min|Gate arrival|Flight number|Let&#x27;s get you to Portland/,
    );
    expect(html).not.toContain("Add an option you");
  });
  it("requires exact selected city records and rejects identical IDs", () => {
    expect(buildCityRequest(emptyCityDraft(), f.now).errors).toMatchObject({
      origin: expect.any(String),
      destination: expect.any(String),
    });
    expect(
      buildCityRequest(
        { ...emptyCityDraft(), origin: f.origin, destination: f.origin },
        f.now,
      ).errors.destination,
    ).toMatch(/different/);
  });
  it("defaults readiness to now and interprets deadline in destination local zone", () => {
    const cross = namedCityFixtures.newYork();
    const built = buildCityRequest(
      {
        ...emptyCityDraft(),
        origin: cross.origin,
        destination: cross.destination,
        goal: "deadline",
        deadlineLocal: "2026-11-19T10:30",
      },
      f.now,
    );
    expect(built.request).toMatchObject({
      version: 2,
      mode: "real",
      readyAt: f.now,
      deadlineAt: "2026-11-19T10:30:00-08:00",
      budgetCents: null,
      drivingAllowed: true,
      priority: "earliest",
    });
    expect(built.request?.confirmedOptions).toEqual([]);
  });
  it("rejects impossible, ambiguous, missing and backwards local deadline times", () => {
    for (const local of [
      "2026-03-08T02:30",
      "2026-11-01T01:30",
      "2026-02-30T10:30",
    ])
      expect(() => localToOffset(local, "America/New_York")).toThrow();
    for (const local of ["", "2026-11-18T07:00"])
      expect(
        buildCityRequest(
          {
            ...emptyCityDraft(),
            origin: f.origin,
            destination: f.destination,
            goal: "deadline",
            deadlineLocal: local,
          },
          f.now,
        ).errors.deadlineAt,
      ).toBeTruthy();
    expect(cityLocalInput("2026-11-18T13:00:00Z", "America/Los_Angeles")).toBe(
      "2026-11-18T05:00",
    );
  });
});
describe("transient city facts", () => {
  it("reuses only current source facts for priority changes, never factual or driving changes", () => {
    const cache = {
      inputKey: cityReuseKey(f.request),
      facts: {
        candidates: f.candidates,
        checkedAt: f.now,
        expiresAt: "2026-11-18T08:00:00-05:00",
        adapterRevision: "public-city-v1" as const,
      },
    };
    expect(
      canReuseCityFacts(
        cache,
        { ...f.request, priority: "cheapest" },
        Date.parse(f.now),
      ),
    ).toBe(true);
    expect(
      canReuseCityFacts(
        cache,
        { ...f.request, drivingAllowed: false },
        Date.parse(f.now),
      ),
    ).toBe(false);
    expect(
      canReuseCityFacts(
        cache,
        { ...f.request, readyAt: "2026-11-18T09:00:00-05:00" },
        Date.parse(f.now),
      ),
    ).toBe(false);
    expect(
      canReuseCityFacts(
        cache,
        f.request,
        Date.parse("2026-11-18T08:01:00-05:00"),
      ),
    ).toBe(false);
  });
  it("accepts only unchanged hard facts and explicit matching model preference patches", () => {
    expect(responseMatchesRequest(f.request, f.request, undefined)).toBe(true);
    expect(
      responseMatchesRequest(
        f.request,
        { ...f.request, deadlineAt: "2026-11-19T11:00:00Z" },
        undefined,
      ),
    ).toBe(false);
    expect(
      responseMatchesRequest(
        f.request,
        { ...f.request, priority: "cheapest" },
        undefined,
      ),
    ).toBe(false);
    expect(
      responseMatchesRequest(
        f.request,
        { ...f.request, priority: "cheapest" },
        { priority: "cheapest" },
      ),
    ).toBe(true);
  });
});
describe("traveler confirmed journeys", () => {
  it("requires explicit service, terminal, transfer allowance and cost facts", () => {
    expect(
      buildManualCityCandidate(
        emptyManualDraft(),
        f.origin,
        f.destination,
        f.now,
      ).errors.length,
    ).toBeGreaterThan(0);
  });
  it("builds a contiguous all-label journey without inventing facts or coordinates", () => {
    const draft = {
      ...emptyManualDraft(),
      mode: "bus" as const,
      operator: "Concord Coach Lines",
      service: "Checked service",
      departureStation: "South Station",
      arrivalStation: "Portland station",
      departureLocal: "2026-11-18T09:00",
      arrivalLocal: "2026-11-18T11:00",
      accessMinutes: "20",
      finalMinutes: "15",
      boardingMinutes: "10",
      fare: "35",
      accessCost: "0",
      finalCost: "5",
    };
    const built = buildManualCityCandidate(
      draft,
      f.origin,
      f.destination,
      f.now,
    );
    expect(built.errors).toEqual([]);
    expect(built.candidate?.legs[0].from.name).toBe(f.origin.name);
    expect(built.candidate?.legs.at(-1)?.to.name).toBe(f.destination.name);
    expect(
      built.candidate?.legs.every((l) =>
        [l.from, l.to].every(
          (p) => p.latitude === null && p.longitude === null,
        ),
      ),
    ).toBe(true);
    expect(built.candidate?.evidence[0].checkedAt).toBe(f.now);
  });
});

describe("city request lifecycle", () => {
  it("archives real replacement results but preserves cards, selection and saved status for clarifications", async () => {
    const { CitySession } = await import("../../src/features/city/session");
    const { planCityRecovery } = await import("@domain/city-planner");
    const result = planCityRecovery(f.request, f.candidates, {
      now: f.now,
      origin: f.origin,
      destination: f.destination,
    });
    let clarify = false;
    const engine = new CitySession({
      now: () => f.now,
      endpoint: () => null,
      transport: async () => ({
        version: 2,
        result,
        facts: {
          candidates: f.candidates,
          checkedAt: f.now,
          expiresAt: "2026-11-18T08:00:00-05:00",
          adapterRevision: "public-city-v1",
        },
        ...(clarify
          ? {
              assistance: {
                status: "limited",
                summary: "Confirm the date.",
                appliedPreferences: {},
                selectedPlanId: null,
                activity: [],
                clarification: { field: "deadlineAt", reason: "ambiguous" },
              },
            }
          : {}),
      }),
    });
    await engine.compare(f.request, f.origin, f.destination, false);
    engine.select(result.plans[0].id);
    engine.markSaved();
    clarify = true;
    engine.options.endpoint = () => "https://example.com/city";
    await engine.compare(f.request, f.origin, f.destination, true, "tomorrow");
    expect(engine.getSnapshot().selectedId).toBe(result.plans[0].id);
    expect(engine.getSnapshot().saved).toBe(true);
    expect(engine.getSnapshot().history).toHaveLength(0);
    engine.edit();
    expect(engine.getSnapshot().result).toBeNull();
    expect(engine.getSnapshot().saved).toBe(false);
  });
  it("ignores stale replies after edits and rejects mismatched echoes or hard facts", async () => {
    const { CitySession } = await import("../../src/features/city/session");
    const { planCityRecovery } = await import("@domain/city-planner");
    const result = planCityRecovery(f.request, f.candidates, {
      now: f.now,
      origin: f.origin,
      destination: f.destination,
    });
    const response = {
      version: 2 as const,
      result,
      facts: {
        candidates: f.candidates,
        checkedAt: f.now,
        expiresAt: "2026-11-18T08:00:00-05:00",
        adapterRevision: "public-city-v1" as const,
      },
    };
    let release!: (value: typeof response) => void;
    const engine = new CitySession({
      now: () => f.now,
      endpoint: () => "https://x.test/city",
      transport: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const pending = engine.compare(f.request, f.origin, f.destination, true);
    engine.edit();
    release(response);
    await pending;
    expect(engine.getSnapshot().result).toBeNull();
    engine.options.transport = async () => response;
    await engine.compare(f.request, f.origin, f.destination, true, "hello", {
      turnId: "current",
      baseRevision: engine.revision,
      history: [],
    });
    expect(engine.getSnapshot().error).toMatch(/earlier trip|message/);
    expect(engine.getSnapshot().result).toBeNull();
    engine.options.transport = async () => ({
      ...response,
      result: { ...result, request: { ...result.request, budgetCents: 1 } },
    });
    await engine.compare(f.request, f.origin, f.destination, true);
    expect(engine.getSnapshot().error).toMatch(/changed trip facts/);
  });
});

it("never reuses cached facts beyond an original evidence expiry or after a future check", () => {
  const request = { ...f.request };
  const facts = {
    candidates: structuredClone(f.candidates),
    checkedAt: f.now,
    expiresAt: "2026-11-18T08:00:00-05:00",
    adapterRevision: "public-city-v1" as const,
  };
  facts.candidates[0].evidence[0].expiresAt = "2026-11-18T07:56:00-05:00";
  expect(
    canReuseCityFacts(
      { inputKey: cityReuseKey(request), facts },
      request,
      Date.parse("2026-11-18T07:57:00-05:00"),
    ),
  ).toBe(false);
  expect(
    canReuseCityFacts(
      { inputKey: cityReuseKey(request), facts },
      request,
      Date.parse("2026-11-18T07:54:00-05:00"),
    ),
  ).toBe(false);
});
it("renders full leg modes, service, zones, incomplete prices and safe nationwide handoffs", async () => {
  const { CityPlanCard } = await import("../../src/features/city/CityPlanCard");
  const { planCityRecovery } = await import("@domain/city-planner");
  const cross = namedCityFixtures.newYork(),
    result = planCityRecovery(cross.request, cross.candidates, {
      now: cross.now,
      origin: cross.origin,
      destination: cross.destination,
    });
  const plan = result.plans[0];
  plan.priceComplete = false;
  plan.knownCostCents = 4500;
  const html = renderToStaticMarkup(
    createElement(CityPlanCard, {
      plan,
      origin: cross.origin,
      destination: cross.destination,
    }),
  );
  expect(html).toContain("At least $45.00 + unknown costs");
  expect(html).toContain("Fictional Rail");
  expect(html).toContain("Fictional service");
  expect(html).toContain("America/New_York");
  expect(html).toContain("America/Los_Angeles");
  expect(html).toContain("www.google.com/maps/dir/");
  expect(html).not.toMatch(/Boston|BOS|rental/);
});
it("clears saved status explicitly after deleting a record", async () => {
  const { CitySession } = await import("../../src/features/city/session");
  const engine = new CitySession({ now: () => f.now });
  await engine.compare(f.request, f.origin, f.destination, false);
  engine.select(engine.getSnapshot().result!.plans[0].id);
  engine.markSaved();
  expect(engine.getSnapshot().saved).toBe(true);
  engine.clearSaved();
  expect(engine.getSnapshot().saved).toBe(false);
});
it("prevents choosing a local option after its original evidence expires", async () => {
  const { CitySession } = await import("../../src/features/city/session");
  let clock = f.now;
  const candidates = structuredClone(f.candidates);
  candidates[0].evidence[0].expiresAt = "2026-11-18T07:56:00-05:00";
  const engine = new CitySession({ now: () => clock });
  await engine.compare(
    { ...f.request, confirmedOptions: candidates },
    f.origin,
    f.destination,
    false,
  );
  const id = engine.getSnapshot().result!.plans[0].id;
  clock = "2026-11-18T07:57:00-05:00";
  engine.select(id);
  expect(engine.getSnapshot().selectedId).toBeNull();
  expect(engine.getSnapshot().error).toMatch(/expired/);
});
it("does not present an earlier comparison as a new assistant answer after a controlled error", async () => {
  const { cityAnswer } = await import(
    "../../src/features/city/conversationModel"
  );
  const { CitySession } = await import("../../src/features/city/session");
  const engine = new CitySession({ now: () => f.now });
  await engine.compare(f.request, f.origin, f.destination, false);
  const current = engine.getSnapshot();
  expect(cityAnswer(current)).toMatch(/ready/);
  expect(
    cityAnswer({
      ...current,
      error: "That reply belongs to an earlier trip or message.",
    }),
  ).toBeNull();
  expect(cityAnswer({ ...current, busy: true })).toBeNull();
});

it("retains a saved comparison through unconfirmed hard-fact edits and archives it only after confirmation", async () => {
  const { CitySession } = await import("../../src/features/city/session");
  const engine = new CitySession({ now: () => f.now });
  await engine.compare(f.request, f.origin, f.destination, false);
  const previous = engine.getSnapshot().result!;
  engine.select(previous.plans[0].id);
  engine.markSaved();
  engine.edit(true);
  expect(engine.getSnapshot()).toMatchObject({
    result: previous,
    selectedId: previous.plans[0].id,
    saved: true,
    dirty: true,
  });
  expect(engine.getSnapshot().history).toHaveLength(0);
  await engine.compare(
    { ...f.request, budgetCents: 10000 },
    f.origin,
    f.destination,
    true,
  );
  expect(engine.getSnapshot().history).toEqual([previous]);
  expect(engine.getSnapshot()).toMatchObject({
    selectedId: null,
    saved: false,
    dirty: false,
  });
  expect(engine.getSnapshot().result?.request.budgetCents).toBe(10000);
  engine.edit();
  expect(engine.getSnapshot().result).toBeNull();
  expect(engine.getSnapshot().history).toHaveLength(0);
});
it("invalidates in-flight clarification replies while draft edits retain the accepted cards", async () => {
  const { CitySession } = await import("../../src/features/city/session");
  const engine = new CitySession({ now: () => f.now });
  await engine.compare(f.request, f.origin, f.destination, false);
  const previous = engine.getSnapshot().result!;
  engine.select(previous.plans[0].id);
  engine.markSaved();
  let release!: (value: any) => void;
  engine.options.endpoint = () => "https://example.com/city";
  engine.options.transport = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = engine.compare(
    f.request,
    f.origin,
    f.destination,
    true,
    "change my deadline",
  );
  engine.edit(true);
  release({
    version: 2,
    result: { ...previous, plans: [] },
    facts: {
      candidates: f.candidates,
      checkedAt: f.now,
      expiresAt: "2026-11-18T08:00:00-05:00",
      adapterRevision: "public-city-v1",
    },
  });
  await pending;
  expect(engine.getSnapshot()).toMatchObject({
    result: previous,
    selectedId: previous.plans[0].id,
    saved: true,
    busy: false,
    dirty: true,
  });
});
it("never posts a cached priority action after expiry and preserves accepted facts until explicit recheck", async () => {
  const { CitySession } = await import("../../src/features/city/session");
  const { planCityRecovery } = await import("@domain/city-planner");
  let clock = f.now,
    posts = 0;
  const result = planCityRecovery(f.request, f.candidates, {
    now: f.now,
    origin: f.origin,
    destination: f.destination,
  });
  const engine = new CitySession({
    now: () => clock,
    endpoint: () => "https://example.com/city",
    transport: async () => {
      posts++;
      return {
        version: 2,
        result,
        facts: {
          candidates: f.candidates,
          checkedAt: f.now,
          expiresAt: "2026-11-18T08:00:00-05:00",
          adapterRevision: "public-city-v1",
        },
      };
    },
  });
  await engine.compare(f.request, f.origin, f.destination, true);
  const accepted = engine.getSnapshot().result;
  clock = "2026-11-18T08:01:00-05:00";
  await engine.compare(
    { ...f.request, priority: "cheapest" },
    f.origin,
    f.destination,
    false,
  );
  expect(posts).toBe(1);
  expect(engine.canRerank()).toBe(false);
  expect(engine.getSnapshot().result).toBe(accepted);
  expect(engine.getSnapshot().history).toHaveLength(0);
  expect(engine.getSnapshot().error).toMatch(/recheck available sources/i);
});

it("retains source expiry after a failed recheck without making old cards usable again", async () => {
  const { CitySession } = await import("../../src/features/city/session");
  const { planCityRecovery } = await import("@domain/city-planner");
  let clock = f.now,
    fail = false;
  const result = planCityRecovery(f.request, f.candidates, {
    now: f.now,
    origin: f.origin,
    destination: f.destination,
  });
  const engine = new CitySession({
    now: () => clock,
    endpoint: () => "https://example.com/city",
    transport: async () => {
      if (fail) throw Error("offline");
      return {
        version: 2,
        result,
        facts: {
          candidates: f.candidates,
          checkedAt: f.now,
          expiresAt: "2026-11-18T08:00:00-05:00",
          adapterRevision: "public-city-v1",
        },
      };
    },
  });
  await engine.compare(f.request, f.origin, f.destination, true);
  const accepted = engine.getSnapshot().result;
  clock = "2026-11-18T08:01:00-05:00";
  expect(engine.expired()).toBe(true);
  engine.expire();
  fail = true;
  await engine.compare(f.request, f.origin, f.destination, true);
  expect(engine.expired()).toBe(true);
  expect(engine.getSnapshot().result).toBe(accepted);
  expect(engine.getSnapshot().factsExpiresAt).toBe("2026-11-18T08:00:00-05:00");
  engine.select(result.plans[0].id);
  expect(engine.getSnapshot().selectedId).toBeNull();
  expect(engine.canUseResult()).toBe(false);
});
it("blocks selecting or saving retained cards after a failed recheck even before original expiry", async () => {
  const { CitySession } = await import("../../src/features/city/session");
  const { planCityRecovery } = await import("@domain/city-planner");
  let fail = false;
  const result = planCityRecovery(f.request, f.candidates, {
    now: f.now,
    origin: f.origin,
    destination: f.destination,
  });
  const engine = new CitySession({
    now: () => f.now,
    endpoint: () => "https://example.com/city",
    transport: async () => {
      if (fail) throw Error("offline");
      return {
        version: 2,
        result,
        facts: {
          candidates: f.candidates,
          checkedAt: f.now,
          expiresAt: "2026-11-18T08:00:00-05:00",
          adapterRevision: "public-city-v1",
        },
      };
    },
  });
  await engine.compare(f.request, f.origin, f.destination, true);
  engine.select(result.plans[0].id);
  fail = true;
  await engine.compare(f.request, f.origin, f.destination, true);
  expect(engine.getSnapshot().error).toBeTruthy();
  engine.select(result.plans[0].id);
  engine.markSaved();
  expect(engine.getSnapshot().saved).toBe(false);
  expect(engine.canUseResult()).toBe(false);
});
