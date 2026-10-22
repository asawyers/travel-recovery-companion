import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cityFixture, namedCityFixtures } from "@domain/city-fixtures";
import {
  emptyCityDraft,
  buildCityRequest,
  localToOffset,
  cityLocalInput,
  draftFromCityRequest,
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
import { CityPlanCard, cityTime } from "../../src/features/city/CityPlanCard";
import { planCityRecovery } from "@domain/city-planner";
import { CitySession } from "../../src/features/city/session";
import { cityAnswer, cityResultCount } from "../../src/features/city/conversationModel";
const f = cityFixture();

function drivingFixture(minutes: number) {
  const fixture = cityFixture();
  const candidate = fixture.candidates[0];
  candidate.kind = "driving_estimate";
  candidate.title = "Fictional driving estimate";
  candidate.legs = [{
    ...candidate.legs[0], mode: "drive", from: candidate.legs[0].from,
    to: candidate.legs.at(-1)!.to, startAt: fixture.request.readyAt,
    endAt: new Date(Date.parse(fixture.request.readyAt) + minutes * 60_000).toISOString(),
  }];
  candidate.costs = [{ label: "Driving costs unconfirmed", cents: null, currency: "USD", includedInOtherCharge: false }];
  return fixture;
}

describe("informational long driving estimates", () => {
  it("shows unknown pricing for a short journey with no known payable cost", () => {
    const fixture = drivingFixture(120);
    const result = planCityRecovery(fixture.request, fixture.candidates, fixture);
    const html = renderToStaticMarkup(createElement(CityPlanCard, {
      plan: result.plans[0], origin: fixture.origin, destination: fixture.destination,
    }));
    expect(html).toContain("Total trip cost unknown");
    expect(html).toContain("Price unknown");
    expect(html).not.toContain("$0.00");
  });
  it("keeps an explicitly confirmed zero payable cost as a zero price", () => {
    const fixture = drivingFixture(120);
    fixture.candidates[0].costs[0].cents = 0;
    const result = planCityRecovery(fixture.request, fixture.candidates, fixture);
    const html = renderToStaticMarkup(createElement(CityPlanCard, {
      plan: result.plans[0], origin: fixture.origin, destination: fixture.destination,
    }));
    expect(html).toContain("$0.00");
    expect(html).not.toContain("Price unknown");
  });

  it("shows driving time and unknown costs without presenting continuous arrival as a planned journey", () => {
    const fixture = drivingFixture(2880);
    const result = planCityRecovery(fixture.request, fixture.candidates, fixture);
    expect(result.plans).toHaveLength(0);
    const plan = result.rejected[0];
    const html = renderToStaticMarkup(createElement(CityPlanCard, {
      plan, origin: fixture.origin, destination: fixture.destination, onSelect: () => {},
    }));
    expect(html).toContain("48 hours of driving time before breaks and overnight stops");
    expect(html).toContain("Informational estimate");
    expect(html).toContain("Arrival time has not been planned");
    expect(html).toContain("Total trip cost unknown");
    expect(html).not.toContain(cityTime(plan.finalArrivalAt, fixture.destination.timeZone));
    expect(html).not.toContain("Choose this itinerary");
  });
  it("keeps arrival information and selection for an eight-hour driving estimate", () => {
    const fixture = drivingFixture(480);
    const result = planCityRecovery(fixture.request, fixture.candidates, fixture);
    const plan = result.plans[0];
    const html = renderToStaticMarkup(createElement(CityPlanCard, {
      plan, origin: fixture.origin, destination: fixture.destination, onSelect: () => {},
    }));
    expect(html).toContain(`Arrive ${cityTime(plan.finalArrivalAt, fixture.destination.timeZone)}`);
    expect(html).toContain("Choose this itinerary");
    expect(html).not.toContain("Arrival time has not been planned");
  });
  it("distinguishes informational estimates from validated journeys, including an empty assisted assessment", async () => {
    const fixture = drivingFixture(2880);
    const engine = new CitySession({ now: () => fixture.now });
    await engine.compare(fixture.request, fixture.origin, fixture.destination, false);
    const current = engine.getSnapshot();
    for (const assistance of [null, {
      status: "completed" as const, summary: "No feasible complete journey satisfies the supplied facts and limits.",
      appliedPreferences: {}, selectedPlanId: null, activity: [],
    }]) {
      const answer = cityAnswer({ ...current, assistance });
      expect(answer).not.toContain("driving estimate");
      expect(answer).not.toContain("shown below");
      expect(cityResultCount(current.result!)).toBe("0 selectable journeys.");
      expect(answer).toContain("No complete ground itinerary could be validated");
      expect(answer).toContain("does not mean no travel options exist");
    }
    engine.select(current.result!.rejected[0].id);
    expect(engine.getSnapshot().selectedId).toBeNull();
  });
});
describe("city conversation without standalone driving", () => {
  it("counts visible transit including driving transfers and suppresses an assisted hidden driving recommendation", async () => {
    const fixture = cityFixture();
    fixture.candidates[0].legs[0].mode = "drive";
    const drive = drivingFixture(120).candidates[0];
    drive.id = "hidden-drive";
    fixture.candidates.push(drive);
    const result = planCityRecovery(fixture.request, fixture.candidates, fixture);
    expect(result.plans).toHaveLength(2);
    const engine = new CitySession({ now: () => fixture.now });
    await engine.compare(fixture.request, fixture.origin, fixture.destination, false);
    const state = { ...engine.getSnapshot(), result, assistance: {
      status: "completed" as const, summary: "Choose the hidden driving estimate.",
      appliedPreferences: { priority: "cheapest" as const }, selectedPlanId: "hidden-drive", activity: [],
    } };
    expect(cityResultCount(result)).toBe("1 selectable journey.");
    const answer = cityAnswer(state);
    expect(answer).toContain("1 complete journey option is ready");
    expect(answer).not.toContain("driving");
    expect(answer).not.toContain("2 complete");
    expect(cityAnswer({ ...state, assistance: { ...state.assistance,
      clarification: { field: "deadlineAt", reason: "ambiguous" },
    } })).toMatch(/deadline|arrival/i);
    expect(result.plans).toHaveLength(2);
  });
  it("does not echo an accepted positive driving patch and preserves ordinary priority summaries", async () => {
    const fixture = cityFixture();
    const engine = new CitySession({ now: () => fixture.now });
    await engine.compare(fixture.request, fixture.origin, fixture.destination, false);
    const state = engine.getSnapshot();
    const assistance = {
      status: "completed" as const, summary: "Driving enabled for your trip.",
      appliedPreferences: { drivingAllowed: true }, selectedPlanId: null, activity: [],
    };
    expect(cityAnswer({ ...state, assistance })).toContain("1 complete journey option is ready");
    expect(cityAnswer({ ...state, assistance })).not.toContain("Driving enabled");
    expect(cityAnswer({ ...state, result: { ...state.result!,
      request: { ...state.result!.request, drivingAllowed: false },
    }, assistance: { ...assistance, summary: "Lowest complete price comes first.",
      appliedPreferences: { priority: "cheapest" },
    } })).toBe("Lowest complete price comes first.");
  });
  it("does not describe a hidden selectable drive as a complete visible journey", async () => {
    const fixture = drivingFixture(120);
    const engine = new CitySession({ now: () => fixture.now });
    await engine.compare(fixture.request, fixture.origin, fixture.destination, false);
    const state = engine.getSnapshot();
    expect(state.result!.plans).toHaveLength(1);
    expect(cityResultCount(state.result!)).toBe("0 selectable journeys.");
    expect(cityAnswer(state)).toContain("No complete ground itinerary could be validated");
    expect(cityAnswer(state)).not.toContain("driving");
  });
});
describe("city starter", () => {
  it("starts with two empty cities, ASAP and no flight or airport assumptions", () => {
    const d = emptyCityDraft();
    expect(d.origin).toBeNull();
    expect(d.destination).toBeNull();
    expect(d.goal).toBe("asap");
    expect(d.readyLocal).toBe("");
    expect(d.drivingAllowed).toBe(false);
    const html = renderToStaticMarkup(createElement(CityRecoveryApp));
    expect(html).toContain("Where are you trying to get to?");
    expect(html).toContain("From city");
    expect(html).not.toContain("Driving allowed");
    expect(html).toContain("To city");
    expect(html).toContain("When do you need to get there?");
    expect(html).not.toMatch(
      /45 min|Gate arrival|Flight number|Let&#x27;s get you to Portland/,
    );
    expect(html).not.toContain("Add an option you");
    expect(html).toContain("Compare ground travel and flight quotes. Explore an origin overnight when you need it.");
  });
  it("keeps standalone driving disabled when an old or assisted draft enables it", () => {
    const built = buildCityRequest({
      ...emptyCityDraft(), origin: f.origin, destination: f.destination,
      drivingAllowed: true, priority: "fewest_transfers", budget: "75",
    }, f.now);
    expect(built.request).toMatchObject({
      drivingAllowed: false, priority: "fewest_transfers", budgetCents: 7500,
      readyAt: f.now, confirmedOptions: [],
    });
    expect(built.errors).toEqual({});
  });
  it("restores trip facts and priority while keeping standalone driving disabled", () => {
    const request = { ...f.request, priority: "cheapest" as const, budgetCents: 12500 };
    expect(request.drivingAllowed).toBe(true);
    const draft = draftFromCityRequest(request, f.origin, f.destination);
    expect(draft).toMatchObject({
      origin: f.origin, destination: f.destination, readyAt: request.readyAt,
      budget: "125", priority: "cheapest", drivingAllowed: false,
    });
    expect(request.drivingAllowed).toBe(true);
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
      drivingAllowed: false,
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
  it("reuses accepted source facts for priority changes, never factual or driving changes", () => {
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
    ).toBe(true);
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

it("reuses aged accepted facts but rejects a future check", () => {
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
  ).toBe(true);
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
it("allows choosing a local estimate after its original observation window", async () => {
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
  expect(engine.getSnapshot().selectedId).toBe(id);
  expect(engine.getSnapshot().error).toBeNull();
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
it("reranks aged accepted facts locally without a POST or rewriting original check times", async () => {
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
  expect(engine.canRerank()).toBe(true);
  expect(engine.canUseResult()).toBe(true);
  expect(engine.getSnapshot().result?.request.priority).toBe("cheapest");
  expect(engine.getSnapshot().history).toEqual([accepted]);
  expect(engine.getSnapshot().error).toBeNull();
  expect(engine.getSnapshot().factsExpiresAt).toBe("2026-11-18T08:00:00-05:00");
  expect(engine.getSnapshot().result?.plans[0].evidence).toEqual(accepted?.plans[0].evidence);
  engine.select(engine.getSnapshot().result!.plans[0].id);
  engine.markSaved();
  const selected = engine.getSnapshot().selectedId;
  engine.expire();
  expect(engine.getSnapshot()).toMatchObject({ selectedId: selected, saved: true, error: null });
});

it("keeps last-checked estimates usable after an optional refresh fails", async () => {
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
  expect(engine.getSnapshot().selectedId).toBe(result.plans[0].id);
  expect(engine.canUseResult()).toBe(true);
  expect(engine.getSnapshot().notice).toMatch(/could not refresh/i);
});
it("keeps selection and saving available after an optional refresh fails before observation expiry", async () => {
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
  expect(engine.getSnapshot().error).toBeNull();
  expect(engine.getSnapshot().notice).toMatch(/could not refresh/i);
  engine.select(result.plans[0].id);
  engine.markSaved();
  expect(engine.getSnapshot().saved).toBe(true);
  expect(engine.canUseResult()).toBe(true);
  engine.edit(true);
  await engine.compare(f.request, f.origin, f.destination, true);
  expect(engine.getSnapshot().error).toBeTruthy();
  expect(engine.canUseResult()).toBe(false);
});
it('synchronizes accepted soft preferences through the local city planner and clears obsolete selection without a POST',async()=>{
 const {CitySession}=await import('../../src/features/city/session')
 const engine=new CitySession({now:()=>f.now})
 await engine.compare(f.request,f.origin,f.destination,false)
 const original=engine.getSnapshot().result!
 engine.select(original.plans[0].id);engine.markSaved()
 engine.applyPreferences({priority:'cheapest',drivingAllowed:false})
 expect(engine.getSnapshot().result?.request).toMatchObject({priority:'cheapest',drivingAllowed:false,readyAt:original.request.readyAt,deadlineAt:original.request.deadlineAt})
 expect(engine.getSnapshot().selectedId).toBeNull();expect(engine.getSnapshot().saved).toBe(false)
 expect(engine.canUseResult()).toBe(true)
 let release!:(value:any)=>void
 engine.options.endpoint=()=> 'https://example.test/city'
 engine.options.transport=()=>new Promise(resolve=>release=resolve)
 const pending=engine.compare(f.request,f.origin,f.destination,true)
 engine.applyPreferences({priority:'fewest_transfers'})
 release({});await pending
 expect(engine.getSnapshot().dirty).toBe(true)
 expect(engine.canUseResult()).toBe(false)
})

it("reuses original accepted manual evidence when its observation window ended before collection", () => {
  const facts = { candidates: structuredClone(f.candidates), checkedAt: "2026-11-18T07:57:00-05:00",
    expiresAt: "2026-11-18T07:56:00-05:00", adapterRevision: "public-city-v1" as const };
  facts.candidates[0].evidence[0].expiresAt = "2026-11-18T07:56:00-05:00";
  expect(canReuseCityFacts({ inputKey: cityReuseKey(f.request), facts }, f.request,
    Date.parse("2026-11-18T08:30:00-05:00"))).toBe(true);
  facts.candidates[0].evidence[0].expiresAt = "2026-11-18T07:54:00-05:00";
  expect(canReuseCityFacts({ inputKey: cityReuseKey(f.request), facts }, f.request,
    Date.parse("2026-11-18T08:30:00-05:00"))).toBe(false);
});

it("reassesses actual transit boarding before selecting while preserving original source checks", async () => {
  let clock = f.now;
  const engine = new CitySession({ now: () => clock });
  await engine.compare(f.request, f.origin, f.destination, false);
  const original = engine.getSnapshot().result!;
  clock = "2026-11-18T08:31:00-05:00";
  engine.select(original.plans[0].id);
  expect(engine.getSnapshot().selectedId).toBeNull();
  expect(engine.getSnapshot().result?.plans).toHaveLength(0);
  expect(engine.getSnapshot().result?.rejected[0].violations.join(" ")).toMatch(/depart|boarding/i);
  expect(engine.getSnapshot().result?.rejected[0].evidence).toEqual(original.plans[0].evidence);
  expect(engine.getSnapshot().result?.generatedAt).toBe(original.generatedAt);
});
