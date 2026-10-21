import { test, expect, type Page } from "@playwright/test";
import { daytimeFixture, overnightFixture } from "../../supabase/functions/_shared/domain/fixtures";
import { planRecovery } from "../../supabase/functions/_shared/domain/planner";
import { createRecoveryHandler } from "../../supabase/functions/_shared/server/handlers";
import { ADAPTER_REVISION, RecoveryResponseSchema } from "../../supabase/functions/_shared/domain/api";
import type { TripRequest, HotelOption, ConfirmedOption } from "../../supabase/functions/_shared/domain/schemas";
const endpoint = "**/functions/v1/recovery";
function production(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(production);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "type" && item === "synthetic" ? "traveler_confirmed" : key === "environment" && item === "synthetic" ? "production" : production(item)]));
  return value;
}
function response(input: TripRequest, refinement?: string, offers = false) {
  const checkedAt = new Date().toISOString();
  const candidates = (offers ? input.confirmedOptions : production(daytimeFixture().candidates)) as ConfirmedOption[];
  const request = { ...input, ...(refinement ? { drivingAllowed: false, priority: "cheapest" as const } : {}), confirmedOptions: candidates };
  const hotel = overnightFixture().candidates.find(c => c.kind === "overnight")!;
  if (hotel.kind !== "overnight") throw new Error("Missing hotel test fixture");
  const offer = production({ ...hotel.hotel, id: "test-property-1", name: "TEST FIXTURE Boston Hotel", quoteExpiresAt: new Date(Date.now() + 240_000).toISOString() }) as HotelOption;
  return RecoveryResponseSchema.parse({
    result: planRecovery(request, candidates, { now: checkedAt }),
    facts: { candidates, arrival: { arrivalAt: request.arrivalAt, arrivalBasis: request.arrivalBasis }, arrivalEvidence: [{ ...production(daytimeFixture().candidates[0].evidence[0]) as object, checkedAt }], checkedAt, expiresAt: new Date(Date.now() + 180_000).toISOString(), adapterRevision: ADAPTER_REVISION,
      ...(offers ? { hotelOffers: [offer, { ...offer, id: "test-property-2", name: "TEST FIXTURE Airport Hotel" }] } : {}) },
    ...(refinement ? { assistance: { status: "completed", summary: "Driving disabled and cheapest priority applied.", appliedPreferences: { drivingAllowed: false, priority: "cheapest" }, selectedPlanId: null, activity: [{ tool: "assess_recovery_options", status: "completed", message: "Compared supplied facts.", checkedAt }] } } : {}),
  });
}
async function enterTrip(page: Page) {
  await page.goto("/");
  await page.getByLabel("Revised gate arrival", { exact: true }).fill("2026-11-18T08:00");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-19T14:00");
}
const compare = (page: Page) => page.getByRole("button", { name: "Compare recovery options", exact: true }).click();
test("refinement bypasses cache, shows accepted preferences and keeps source identity for reranking", async ({ page }) => {
  const posts: any[] = [];
  await page.route(endpoint, async route => { const post = route.request().postDataJSON(); posts.push(post); await route.fulfill({ json: response(post.request, post.refinement) }); });
  await enterTrip(page); await compare(page);
  await page.getByLabel("Refine this comparison").fill("Avoid driving; prefer cheapest");
  await page.getByRole("button", { name: "Apply refinement", exact: true }).click();
  await expect(page.getByTestId("assistance-panel")).toContainText("Driving disabled and cheapest priority applied.");
  await expect(page.getByTestId("assistance-panel")).toContainText("Compared supplied facts.");
  await expect(page.getByLabel("Allow driving", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Priority", { exact: true })).toHaveValue("cheapest");
  expect(posts).toHaveLength(2);
  expect(posts[1].refinement).toBe("Avoid driving; prefer cheapest");
  expect(posts[1].request.confirmedOptions).toEqual([]);
  await page.getByLabel("Priority", { exact: true }).selectOption("earliest");
  await compare(page);
  await expect(page.getByTestId("option-card")).toHaveCount(2);
  expect(posts).toHaveLength(2);
  await expect(page.getByTestId("option-card").filter({ hasText: "rental car" })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose Fictional intercity train", exact: true }).click();
  await page.getByRole("button", { name: "Save on this device", exact: true }).click();
  const raw = await page.evaluate(() => localStorage.getItem("travel-recovery:selected:v1"));
  expect(raw).not.toContain("appliedPreferences"); expect(raw).not.toContain("Avoid driving");
});
test("hotel offers are rates only, require two property transfers, and a new property clears those facts", async ({ page }) => {
  await page.clock.install();
  const posts: any[] = [];
  await page.route(endpoint, async route => { const post = route.request().postDataJSON(); posts.push(post); await route.fulfill({ json: response(post.request, undefined, true) }); });
  await enterTrip(page);
  await page.getByLabel("Allow overnight stay", { exact: true }).check();
  await page.getByLabel("Check-in date", { exact: true }).fill("2026-11-18");
  await page.getByLabel("Check-out date", { exact: true }).fill("2026-11-19");
  await page.getByLabel("Guest nationality (2-letter country code)").fill("US");
  await page.getByLabel("Investigate available sources").check(); await compare(page);
  await expect(page.getByTestId("hotel-offers")).toContainText("Hotel rates only");
  await expect(page.getByTestId("option-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Use TEST FIXTURE Boston Hotel", exact: true }).click();
  await page.getByLabel("Airport to hotel minutes", { exact: true }).fill("20");
  await page.getByLabel("Hotel check-in minutes", { exact: true }).fill("15");
  await page.getByLabel("Leave hotel at", { exact: true }).fill("2026-11-19T08:00");
  await page.getByText("Add a confirmed train or bus", { exact: true }).click();
  await page.getByLabel("Include this transit option").check();
  await page.getByLabel("Operator / service name").fill("TEST FIXTURE checkout bus");
  await page.getByLabel("Transit departure", { exact: true }).fill("2026-11-19T09:00");
  await page.getByLabel("Transit arrival", { exact: true }).fill("2026-11-19T11:00");
  await page.getByLabel("Departure terminal", { exact: true }).fill("Actual Boston boarding stop");
  await page.getByLabel("Arrival terminal", { exact: true }).fill("Portland bus stop");
  await page.getByLabel("Access minutes", { exact: true }).fill("30");
  await page.getByLabel("Final transfer minutes", { exact: true }).fill("15");
  await page.getByLabel("Hotel to boarding stop minutes", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Investigate selected hotel journey", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ investigate: true, request: { hotelSelection: { hotelId: "test-property-1", nextDayTransitId: "manual-transit", hotelAccess: { minutes: 20, costCents: null }, stationAccess: { minutes: 25, costCents: null } } } });
  await expect(page.getByRole("button", { name: "Compare recovery options", exact: true })).toBeVisible();
  await page.getByLabel("Priority", { exact: true }).selectOption("cheapest");
  await compare(page);
  await expect(page.getByRole("button", { name: "Compare recovery options", exact: true })).toBeVisible();
  expect(posts).toHaveLength(2);
  await page.getByLabel("Departure terminal", { exact: true }).fill("Different Boston boarding stop");
  await expect(page.getByLabel("Airport to hotel minutes", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("Hotel to boarding stop minutes", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Use TEST FIXTURE Airport Hotel", exact: true }).click();
  await expect(page.getByLabel("Airport to hotel minutes", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Hotel to boarding stop minutes", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Leave hotel at", { exact: true })).toHaveValue("");
  await page.clock.fastForward(181_000);
  await expect(page.getByTestId("hotel-offers")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Source checks expired");
});

test("an unavailable model reports its limitation without applying preferences", async ({ page }) => {
  await page.route(endpoint, async route => {
    const post = route.request().postDataJSON(); const body = response(post.request);
    if (post.refinement) body.assistance = { status: "unavailable", summary: "Assisted refinement is disabled. Supplied facts were compared.", appliedPreferences: {}, selectedPlanId: null, activity: [] };
    await route.fulfill({ json: body });
  });
  await enterTrip(page); await compare(page);
  await page.getByLabel("Refine this comparison").fill("No driving");
  await page.getByRole("button", { name: "Apply refinement", exact: true }).click();
  await expect(page.getByTestId("assistance-panel")).toContainText("Assistance unavailable");
  await expect(page.getByTestId("assistance-panel")).toContainText("Assisted refinement is disabled");
  await expect(page.getByLabel("Allow driving", { exact: true })).toBeChecked();
});
test("an ignored-abort refinement cannot overwrite a newer trip edit", async ({ page }) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let refinementStarted = false;
  await page.route(endpoint, async route => {
    const post = route.request().postDataJSON();
    if (post.refinement) { refinementStarted = true; await delayed; }
    await route.fulfill({ json: response(post.request, post.refinement) }).catch(() => {});
  });
  await enterTrip(page); await compare(page);
  await page.getByLabel("Refine this comparison").fill("No driving");
  await page.getByRole("button", { name: "Apply refinement", exact: true }).click();
  await expect.poll(() => refinementStarted).toBe(true);
  await page.getByLabel("Revised gate arrival", { exact: true }).fill("2026-11-18T08:30");
  await compare(page);
  await expect(page.getByTestId("option-card").filter({ hasText: "one-way rental car" })).toBeVisible();
  release();
  await expect(page.getByLabel("Allow driving", { exact: true })).toBeChecked();
  await expect(page.getByTestId("assistance-panel")).toHaveCount(0);
});

test("explicit source consent on refinement reaches the real handler and retains provider routes", async ({ page }) => {
  const posts: any[] = [];
  let sourceChecks = 0;
  const candidates = production(daytimeFixture().candidates) as ConfirmedOption[];
  const handler = createRecoveryHandler({ now: () => new Date().toISOString(), providers: { gatherPermittedFacts: async () => { sourceChecks++; return { candidates, warnings: [] }; } } });
  await page.route(endpoint, async route => {
    const post = route.request().postDataJSON(); posts.push(post);
    const result = await handler(new Request("https://fixture.example/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(post) }));
    await route.fulfill({ status: result.status, json: await result.json() });
  });
  await enterTrip(page);
  await page.getByLabel("Investigate available sources", { exact: true }).check(); await compare(page);
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  await page.getByLabel("Refine this comparison").fill("No driving");
  await page.getByLabel("Check enabled sources with this refinement", { exact: true }).check();
  await page.getByRole("button", { name: "Apply refinement", exact: true }).click();
  await expect(page.getByTestId("assistance-panel")).toContainText("AI assistance is unavailable");
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  expect(posts).toHaveLength(2); expect(sourceChecks).toBe(2);
  expect(posts[1]).toMatchObject({ investigate: true, refinement: "No driving", request: { confirmedOptions: [] } });
});

test("changing the actual boarding stop clears only the property-to-stop transfer facts", async ({ page }) => {
  await page.route(endpoint, async route => { const post = route.request().postDataJSON(); await route.fulfill({ json: response(post.request, undefined, true) }); });
  await enterTrip(page);
  await page.getByLabel("Allow overnight stay", { exact: true }).check();
  await page.getByLabel("Check-in date", { exact: true }).fill("2026-11-18");
  await page.getByLabel("Check-out date", { exact: true }).fill("2026-11-19");
  await page.getByLabel("Guest nationality (2-letter country code)").fill("US");
  await compare(page);
  await page.getByRole("button", { name: "Use TEST FIXTURE Boston Hotel", exact: true }).click();
  await page.getByText("Add a confirmed train or bus", { exact: true }).click();
  await page.getByLabel("Departure terminal", { exact: true }).fill("North Station");
  await page.getByLabel("Airport to hotel minutes", { exact: true }).fill("20");
  await page.getByLabel("Hotel to boarding stop minutes", { exact: true }).fill("10");
  await page.getByLabel("Hotel to boarding stop cost (USD)", { exact: true }).fill("15");
  await page.getByLabel("Departure terminal", { exact: true }).fill("South Station");
  await expect(page.getByLabel("Hotel to boarding stop minutes", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Hotel to boarding stop cost (USD)", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Airport to hotel minutes", { exact: true })).toHaveValue("20");
});
