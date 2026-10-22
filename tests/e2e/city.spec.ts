import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  CityCandidate,
  CityRecoveryResponse,
  CityTripRequest,
} from "../../supabase/functions/_shared/domain/city-contracts";
import { CityRecoveryResponseSchema } from "../../supabase/functions/_shared/domain/city-contracts";
import { findCity } from "../../supabase/functions/_shared/domain/city-catalog";
import { planCityRecovery } from "../../supabase/functions/_shared/domain/city-planner";
import { daytimeFixture } from "../../supabase/functions/_shared/domain/fixtures";
import { planRecovery } from "../../supabase/functions/_shared/domain/planner";
const endpoint = "**/functions/v1/recovery/city",
  key = "travel-recovery:selected:v1",
  now = "2026-11-18T12:55:00Z";
type Envelope = {
  request: CityTripRequest;
  investigate: boolean;
  refinement?: string;
  conversation?: {
    turnId: string;
    baseRevision: number;
    history: { role: string; content: string }[];
  };
};
function response(
  input: Envelope,
  extra: Partial<CityRecoveryResponse> = {},
): CityRecoveryResponse {
  const request = input.request,
    origin = findCity(request.originCityId)!,
    destination = findCity(request.destinationCityId)!;
  const start = request.readyAt,
    arrival = new Date(Date.parse(start) + 180 * 60000).toISOString();
  const candidate: CityCandidate = {
    id: "checked-fixture-bus",
    title: `Checked fixture bus to ${destination.name}`,
    kind: "transit",
    originCityId: origin.id,
    destinationCityId: destination.id,
    legs: [
      {
        id: "bus-leg",
        mode: "bus",
        from: {
          name: origin.name,
          latitude: origin.latitude,
          longitude: origin.longitude,
        },
        to: {
          name: destination.name,
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
        startAt: start,
        endAt: arrival,
        departureTimeZone: origin.timeZone,
        arrivalTimeZone: destination.timeZone,
        operator: "Concord Coach Lines",
        service: "Fixture service 1",
        vehicleId: "fixture-bus-1",
        assumptions: [],
      },
    ],
    costs: [
      {
        label: "Fixture checked complete fare",
        cents: 4000,
        currency: "USD",
        includedInOtherCharge: false,
      },
    ],
    evidence: [
      {
        type: "traveler_confirmed",
        provider: "Traveler fixture — no live check",
        sourceUrl: null,
        checkedAt: now,
        serviceDate: start.slice(0, 10),
        providerUpdatedAt: null,
        expiresAt: null,
        environment: "production",
        warnings: [],
      },
    ],
    confirmations: [],
  };
  const candidates = [
    ...request.confirmedOptions.filter((c) => c.id !== candidate.id),
    candidate,
  ];
  const result = planCityRecovery(request, candidates, {
    now,
    origin,
    destination,
  });
  return CityRecoveryResponseSchema.parse({
    version: 2,
    result,
    facts: {
      candidates,
      checkedAt: now,
      expiresAt: "2026-11-18T13:00:00Z",
      adapterRevision: "public-city-v1",
    },
    ...(input.conversation
      ? {
          conversation: {
            turnId: input.conversation.turnId,
            baseRevision: input.conversation.baseRevision,
          },
        }
      : {}),
    ...extra,
  });
}
async function selectCity(
  page: Page,
  label: "From city" | "To city",
  query: string,
  name: RegExp,
) {
  await page.getByRole("combobox", { name: label, exact: true }).fill(query);
  await page.getByRole("option", { name }).click();
}
async function start(page: Page) {
  await selectCity(page, "From city", "Boston MA", /^Boston, MA/);
  await selectCity(page, "To city", "Portland ME", /^Portland, ME/);
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  await expect(page.getByTestId("city-option-card")).toHaveCount(1);
}
async function openTrip(page: Page) {
  const details = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: /^Edit trip/ }) })
    .first();
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
    await details.locator("summary").first().click();
}
async function fulfill(
  route: Route,
  input: Envelope,
  extra: Partial<CityRecoveryResponse> = {},
) {
  await route.fulfill({ json: response(input, extra) });
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/functions/v1/recovery/travel", async route => {
    const input = route.request().postDataJSON();
    const { refinement: _refinement, conversation, ...request } = input;
    await route.fulfill({json:{version:3,request,origin:findCity(request.trip.originCityId),destination:findCity(request.trip.destinationCityId),generatedAt:now,expiresAt:"2026-11-18T13:00:00Z",flightOffers:[],hotelOffers:[],sourceStatuses:[],journey:null,selectionIssue:null,warnings:["Travel fixture unavailable; no live inventory was checked."],...(conversation?{conversation:{turnId:conversation.turnId,baseRevision:conversation.baseRevision}}:{})}});
  });
});
test("long-drive-only city comparison exposes an informational estimate without a continuous-arrival or save claim", async ({ page }) => {
  let posts = 0;
  await page.route(endpoint, async route => {
    posts++;
    const input: Envelope = route.request().postDataJSON();
    const base = response(input);
    const candidate = base.facts.candidates[0];
    candidate.title = "Google Maps driving duration estimate";
    candidate.kind = "driving_estimate";
    candidate.legs[0] = {
      ...candidate.legs[0], mode: "drive", operator: null, service: null, vehicleId: null,
      endAt: new Date(Date.parse(input.request.readyAt) + 48 * 60 * 60_000).toISOString(),
    };
    candidate.costs = [{ label: "Driving costs unconfirmed", cents: null, currency: "USD", includedInOtherCharge: false }];
    candidate.evidence[0] = { ...candidate.evidence[0], provider: "Google Maps Routes API", type: "estimated", expiresAt: "2026-11-18T13:00:00Z" };
    const result = planCityRecovery(input.request, [candidate], {
      now, origin: base.result.origin, destination: base.result.destination,
    });
    expect(result.plans).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].violations).toEqual([]);
    await route.fulfill({ json: CityRecoveryResponseSchema.parse({ ...base, result, facts: { ...base.facts, candidates: result.request.confirmedOptions } }) });
  });
  await page.goto("/");
  await selectCity(page, "From city", "San Diego CA", /^San Diego, CA/);
  await selectCity(page, "To city", "Portland ME", /^Portland, ME/);
  await page.getByRole("button", { name: "Find my options", exact: true }).click();
  const card = page.getByTestId("city-option-card").filter({ hasText: "Google Maps driving duration estimate" });
  await expect(card).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /0 selectable journeys.*1 informational driving estimate/ })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("No complete ground itinerary could be validated");
  await expect(page.getByRole("log")).toContainText("does not mean no travel options exist");
  await expect(page.getByText("Compare ground travel and flight quotes. Explore an origin overnight when you need it.", { exact: true })).toBeVisible();
  await expect(card).toContainText("48 hours of driving time before breaks and overnight stops");
  await expect(card).toContainText("Arrival time has not been planned");
  await expect(card).toContainText("Total trip cost unknown");
  await card.getByText("Journey details and sources", { exact: true }).click();
  await expect(card).not.toContainText(/\bArrive /);
  await expect(card.getByRole("button", { name: "Choose this itinerary", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save on this device", exact: true })).toBeDisabled();
  expect(posts).toBe(1);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
});
test("empty city starter requires actual disambiguated selections and no default airport inputs", async ({
  page,
}) => {
  const posts: Envelope[] = [];
  await page.route(endpoint, async (route) => {
    const input = route.request().postDataJSON();
    posts.push(input);
    await fulfill(route, input);
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Where are you trying to get to?" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("As soon as possible", { exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Gate arrival", { exact: true })).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "From city", exact: true })
    .fill("Boston MA");
  await page
    .getByRole("combobox", { name: "To city", exact: true })
    .fill("Portland ME");
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  expect(posts).toHaveLength(0);
  await expect(page.getByRole("alert").first()).toContainText("Choose");
  await start(page);
  expect(posts).toHaveLength(1);
  expect(posts[0].request).toMatchObject({
    version: 2,
    mode: "real",
    originCityId: "geonames:4930956",
    destinationCityId: "geonames:4975802",
    readyAt: new Date(now).toISOString(),
    deadlineAt: null,
  });
  await expect(
    page.getByRole("log", { name: "Recovery conversation" }),
  ).toContainText("Boston, MA to Portland, ME");
  await expect(
    page.getByText("Add an option you’ve checked", { exact: true }),
  ).toBeVisible();
});
test("arrival deadlines use destination time zone and are validated before a POST", async ({
  page,
}) => {
  const posts: Envelope[] = [];
  await page.route(endpoint, async (route) => {
    const input = route.request().postDataJSON();
    posts.push(input);
    await fulfill(route, input);
  });
  await page.goto("/");
  await selectCity(page, "From city", "New York City NY", /^New York City, NY/);
  await selectCity(page, "To city", "Los Angeles CA", /^Los Angeles, CA/);
  await page.getByLabel("By a date and time", { exact: true }).check();
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  expect(posts).toHaveLength(0);
  await expect(page.getByRole("alert")).toContainText("arrival deadline");
  await expect(
    page.getByText("Destination local time:", { exact: false }),
  ).toContainText("America/Los_Angeles");
  await page.getByLabel("Arrive by", { exact: true }).fill("2026-11-19T10:30");
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].request.deadlineAt).toBe("2026-11-19T10:30:00-08:00");
});
test("DST gaps and repeated origin hours require another explicit local time", async ({
  page,
}) => {
  let posts = 0;
  await page.route(endpoint, async (route) => {
    posts++;
    await route.abort();
  });
  await page.goto("/");
  await selectCity(page, "From city", "Boston MA", /^Boston, MA/);
  await selectCity(page, "To city", "Portland ME", /^Portland, ME/);
  await page
    .locator("summary")
    .filter({ hasText: /^Leaving now/ })
    .click();
  for (const local of ["2026-03-08T02:30", "2026-11-01T01:30"]) {
    await page.getByLabel("Leaving time", { exact: true }).fill(local);
    await page
      .getByRole("button", { name: "Find my options", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "unambiguous leaving time",
    );
  }
  expect(posts).toBe(0);
});
test("priority quick replies reassess cached facts without POST and no-driving discovers again", async ({
  page,
}) => {
  const posts: Envelope[] = [];
  await page.route(endpoint, async (route) => {
    const input = route.request().postDataJSON();
    posts.push(input);
    await fulfill(route, input);
  });
  await page.goto("/");
  await start(page);
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Cheaper");
  await expect(
    page.getByRole("status").filter({ hasText: "1 selectable journey." }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  await page
    .getByRole("button", { name: "Fewer changes", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("Fewer changes");
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "No driving", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].request.drivingAllowed).toBe(false);
  await page
    .getByRole("button", { name: "Explore overnight", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText(
    "Explore overnight",
  );
  expect(posts).toHaveLength(2);
});
test("clarifications preserve selected saved cards until explicit hard facts are confirmed", async ({
  page,
}) => {
  const posts: Envelope[] = [];
  await page.route(endpoint, async (route) => {
    const input: Envelope = route.request().postDataJSON();
    posts.push(input);
    await fulfill(
      route,
      input,
      input.refinement
        ? {
            assistance: {
              status: "limited",
              summary: "Confirm the deadline.",
              appliedPreferences: {},
              selectedPlanId: null,
              activity: [],
              clarification: { field: "deadlineAt", reason: "ambiguous" },
            },
          }
        : {},
    );
  });
  await page.goto("/");
  await start(page);
  await page
    .getByRole("button", { name: "Choose this itinerary", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  await page
    .getByLabel("Message about your trip", { exact: true })
    .fill("What about tomorrow?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(
    "latest acceptable arrival",
  );
  await expect(page.getByTestId("city-option-card")).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "Selected · Saved on this device",
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  expect(
    posts[1].conversation?.history.some(
      (t) => t.content === "What about tomorrow?",
    ),
  ).toBe(false);
  await page.getByLabel("By a date and time", { exact: true }).check();
  await page.getByLabel("Arrive by", { exact: true }).fill("2026-11-19T15:00");
  await expect(page.getByTestId("city-option-card")).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "Selected · Saved on this device",
      exact: true,
    }),
  ).toBeVisible();
  expect(posts).toHaveLength(2);
  await page
    .getByRole("button", {
      name: "Confirm trip facts and update options",
      exact: true,
    })
    .click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2].request.deadlineAt).toBe("2026-11-19T15:00:00-05:00");
  expect(posts[2].refinement).toBeUndefined();
  await expect(
    page.getByText("Earlier comparisons", { exact: true }),
  ).toBeVisible();
});
test("wrong conversation echo and stale city replies never mutate the current trip", async ({
  page,
}) => {
  const posts: Envelope[] = [];
  let delayed: Route | undefined;
  await page.route(endpoint, async (route) => {
    const input: Envelope = route.request().postDataJSON();
    posts.push(input);
    if (input.refinement === "wait") {
      delayed = route;
      return;
    }
    const extra = input.conversation
      ? {
          conversation: {
            turnId: "wrong-turn",
            baseRevision: input.conversation.baseRevision,
          },
          assistance: {
            status: "completed" as const,
            summary: "WRONG REPLY MUST NOT APPEAR",
            appliedPreferences: {},
            selectedPlanId: null,
            activity: [],
          },
        }
      : {};
    await fulfill(route, input, extra);
  });
  await page.goto("/");
  await start(page);
  await page
    .getByLabel("Message about your trip", { exact: true })
    .fill("Compare");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "earlier trip or message",
  );
  await expect(page.getByRole("log")).not.toContainText("WRONG REPLY");
  await page
    .getByLabel("Message about your trip", { exact: true })
    .fill("wait");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => !!delayed).toBe(true);
  await openTrip(page);
  await selectCity(page, "To city", "Los Angeles CA", /^Los Angeles, CA/);
  await expect(page.getByTestId("city-option-card")).toHaveCount(0);
  await delayed!.fulfill({ json: response(posts.at(-1)!) }).catch(() => {});
  await expect(page.getByTestId("city-option-card")).toHaveCount(0);
  await expect(page.getByRole("log")).not.toContainText("Portland");
});
test("checked manual plan saves without provider alternatives, reloads exact history and refresh preserves original checks", async ({
  page,
}) => {
  const posts: Envelope[] = [];
  await page.route(endpoint, async (route) => {
    const input: Envelope = route.request().postDataJSON();
    posts.push(input);
    await fulfill(route, input);
  });
  await page.goto("/");
  await start(page);
  await page.getByText("Add an option you’ve checked", { exact: true }).click();
  await page.getByLabel("Travel mode", { exact: true }).selectOption("rail");
  const inputs: Record<string, string> = {
    Operator: "Amtrak",
    "Service name or number": "Checked train 1",
    "Departure station": "South Station",
    "Arrival station": "Portland station",
    "Departure time (America/New_York)": "2026-11-18T09:00",
    "Arrival time (America/New_York)": "2026-11-18T11:00",
    "Walking to departure station (minutes)": "20",
    "Boarding allowance (minutes)": "10",
    "Final walk to destination city center (minutes)": "15",
    "Service fare (USD)": "35",
    "Origin access cost (USD)": "0",
    "Final transfer cost (USD)": "5",
  };
  for (const [label, value] of Object.entries(inputs))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", {
      name: "Confirm checked option and compare",
      exact: true,
    })
    .click();
  const card = page
    .getByTestId("city-option-card")
    .filter({ hasText: "Amtrak train" });
  await card
    .getByRole("button", { name: "Choose this itinerary", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(saved.schemaVersion).toBe(2);
  expect(
    saved.plan.legs.some(
      (leg: { mode: string; service: string | null }) =>
        leg.mode === "rail" && leg.service === "Checked train 1",
    ),
  ).toBe(true);
  expect(
    saved.request.confirmedOptions.some((c: CityCandidate) =>
      c.id.startsWith("manual-"),
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText(saved.selectedAt);
  await expect(page.getByTestId("saved-plan")).toContainText(saved.generatedAt);
  const before = posts.length;
  await page
    .getByRole("button", { name: "Refresh this plan", exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(before + 1);
  const refreshed = posts.at(-1)!.request;
  expect(refreshed.readyAt).toBe(saved.request.readyAt);
  expect(refreshed.confirmedOptions).toEqual(saved.request.confirmedOptions);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key),
  ).toEqual(saved);
});
test("valid v1 history uses the original airport path and unknown records remain protected", async ({
  page,
}) => {
  const f = daytimeFixture(),
    result = planRecovery(f.request, f.candidates, { now: f.now }),
    saved = {
      schemaVersion: 1,
      request: result.request,
      plan: result.plans[0],
      generatedAt: f.now,
      selectedAt: f.now,
    };
  await page.goto("/");
  await page.evaluate(
    ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    { key, saved },
  );
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText(f.now);
  let legacyPosts = 0;
  await page.route("**/functions/v1/recovery", async (route) => {
    legacyPosts++;
    await route.abort();
  });
  await page
    .getByRole("button", { name: "Refresh this plan", exact: true })
    .click();
  await expect(page).toHaveURL(/\/legacy\?refreshSaved=1/);
  await expect.poll(() => legacyPosts).toBe(1);
  await expect(
    page.getByRole("link", { name: "Return to city planning", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (key) => localStorage.setItem(key, '{"schemaVersion":99}'),
    key,
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("unsupported version");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    '{"schemaVersion":99}',
  );
});

test("expired priority controls stay local and require an explicit source recheck", async ({
  page,
}) => {
  const posts: Envelope[] = [];
  await page.route(endpoint, async (route) => {
    const input: Envelope = route.request().postDataJSON();
    posts.push(input);
    await fulfill(route, input);
  });
  await page.goto("/");
  await start(page);
  await page.clock.setFixedTime(new Date("2026-11-18T13:01:00Z"));
  // This ordinary draft-free render exposes expiration without advancing a real five-minute timer.
  await page
    .getByLabel("Message about your trip", { exact: true })
    .fill("Check freshness");
  await expect(
    page.getByRole("button", { name: "Cheaper", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Fewer changes", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Source checks need refreshing.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("city-option-card")).toHaveCount(1);
  expect(posts).toHaveLength(1);
  await page
    .getByRole("button", { name: "Recheck available sources", exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].investigate).toBe(true);
});
