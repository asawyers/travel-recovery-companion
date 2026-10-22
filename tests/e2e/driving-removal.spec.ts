import { expect, test, type Page } from "@playwright/test";
import { findCity } from "../../supabase/functions/_shared/domain/city-catalog";
import { CityRecoveryResponseSchema, type CityCandidate, type CityRecoveryInput } from "../../supabase/functions/_shared/domain/city-contracts";
import { planCityRecovery } from "../../supabase/functions/_shared/domain/city-planner";
import { travelFixture } from "../../supabase/functions/_shared/domain/travel-fixtures";
import { flightOfferFingerprint, flightOfferId, TravelRecoveryResponseSchema, travelRequestBinding, type TravelRecoveryInput } from "../../supabase/functions/_shared/domain/travel-contracts";
import { assessTravelSelection } from "../../supabase/functions/_shared/domain/travel-planner";

const now = "2026-11-18T14:00:00Z", expiresAt = "2026-11-18T14:05:00Z";
const storageKey = "travel-recovery:selected:v1";
const shortTitle = "Stale short driving alternative", longTitle = "Stale cross-country driving alternative";

function candidates(input: CityRecoveryInput, driveOnly: boolean): CityCandidate[] {
  const origin = findCity(input.request.originCityId)!, destination = findCity(input.request.destinationCityId)!;
  const candidate = (id: string, title: string, minutes: number, kind: CityCandidate["kind"], cents: number | null): CityCandidate => ({
    id, title, kind, originCityId: origin.id, destinationCityId: destination.id,
    legs: [{ id: `${id}-leg`, mode: kind === "transit" ? "bus" : "drive",
      from: { name: origin.name, latitude: origin.latitude, longitude: origin.longitude },
      to: { name: destination.name, latitude: destination.latitude, longitude: destination.longitude },
      startAt: input.request.readyAt, endAt: new Date(Date.parse(input.request.readyAt) + minutes * 60_000).toISOString(),
      departureTimeZone: origin.timeZone, arrivalTimeZone: destination.timeZone,
      operator: kind === "transit" ? "Concord Coach Lines" : null,
      service: kind === "transit" ? "Deterministic checked fixture" : null,
      vehicleId: kind === "transit" ? `${id}-vehicle` : null, assumptions: [], }],
    costs: [{ label: kind === "transit" ? "Checked fixture fare" : "Driving costs unconfirmed", cents, currency: "USD", includedInOtherCharge: false }],
    evidence: [{ type: kind === "transit" ? "traveler_confirmed" : "estimated", provider: kind === "transit" ? "Traveler fixture — no live check" : "Google Maps Routes API",
      environment: "production", sourceUrl: null, checkedAt: now, expiresAt,
      serviceDate: input.request.readyAt.slice(0, 10), providerUpdatedAt: null, warnings: ["Deterministic acceptance fixture; no live inventory checked."] }],
    confirmations: [],
  });
  const drives = [candidate("stale-short-drive", shortTitle, 120, "driving_estimate", null), candidate("stale-long-drive", longTitle, 2736, "driving_estimate", null)];
  return driveOnly ? drives : [...drives, candidate("checked-known-bus", "Checked complete-fare transit", 3000, "transit", 4000), candidate("checked-unknown-bus", "Checked unknown-fare transit", 3060, "transit", null)];
}

async function fixtures(page: Page, driveOnly = false) {
  const cityPosts: CityRecoveryInput[] = [], travelPosts: TravelRecoveryInput[] = [];
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/functions/v1/recovery/city", async route => {
    expect(route.request().method()).toBe("POST");
    const input = route.request().postDataJSON() as CityRecoveryInput;
    cityPosts.push(input);
    const origin = findCity(input.request.originCityId)!, destination = findCity(input.request.destinationCityId)!;
    // Simulate a stale backend that still includes an eligible short drive. Restore
    // the real request binding; the UI must filter both eligible and rejected drives.
    const result = planCityRecovery({ ...input.request, drivingAllowed: true }, candidates(input, driveOnly), { now, origin, destination });
    expect(result.plans.some(plan => plan.id === "stale-short-drive" && plan.selectable)).toBe(true);
    if (input.request.priority === "earliest") expect(result.plans[0].id).toBe("stale-short-drive");
    expect(result.rejected.some(plan => plan.id === "stale-long-drive" && !plan.selectable)).toBe(true);
    result.request.drivingAllowed = input.request.drivingAllowed;
    await route.fulfill({ json: CityRecoveryResponseSchema.parse({ version: 2, result,
      facts: { candidates: result.request.confirmedOptions, checkedAt: now, expiresAt, adapterRevision: "public-city-v1" },
      ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
    }) });
  });
  await page.route("**/functions/v1/recovery/travel", async route => {
    expect(route.request().method()).toBe("POST");
    const input = route.request().postDataJSON() as TravelRecoveryInput;
    travelPosts.push(input);
    const fixture = travelFixture(), flight = structuredClone(fixture.flight);
    flight.departureDate = input.departureDate;
    for (const segment of flight.segments) {
      segment.departureAt = segment.departureAt.replace("2026-11-19", input.departureDate);
      segment.arrivalAt = segment.arrivalAt.replace("2026-11-19", input.departureDate);
    }
    flight.id = flightOfferId(flight); flight.fingerprint = flightOfferFingerprint(flight);
    const offers = { flightOffers: [flight], hotelOffers: [] };
    await route.fulfill({ json: TravelRecoveryResponseSchema.parse({ version: 3, request: travelRequestBinding(input), origin: fixture.origin, destination: fixture.destination,
      generatedAt: now, expiresAt, ...offers,
      ...assessTravelSelection(input, { ...offers, origin: fixture.origin, destination: fixture.destination, now }),
      sourceStatuses: [{ source: "flights", status: "available", message: "Fixture flight quote checked.", checkedAt: now, expiresAt }],
      warnings: ["Test fixture only; no live inventory was requested."],
      ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
    }) });
  });
  return { cityPosts, travelPosts };
}
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "From city", exact: true }).fill("San Diego CA");
  await page.getByRole("option", { name: /^San Diego, CA/ }).click();
  await page.getByRole("combobox", { name: "To city", exact: true }).fill("Portland ME");
  await page.getByRole("option", { name: /^Portland, ME/ }).click();
  await expect(page.getByLabel("Driving allowed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Find my options", exact: true }).click();
  await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(1);
}
async function expectDrivingAbsent(page: Page) {
  await expect(page.getByRole("button", { name: "No driving", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Driving allowed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Travel options", exact: true })).not.toContainText(/Stale short driving alternative|Stale cross-country driving alternative|informational driving|Long drives need|Driving costs unconfirmed|driving estimates? (?:is|are) shown below/i);
  await expect(page.getByRole("log")).not.toContainText(/informational driving|driving estimates? (?:is|are) shown below/i);
}
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("stale eligible and rejected drives disappear while transit prices, selection, cached priorities and rechecks remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { cityPosts, travelPosts } = await fixtures(page);
  await start(page);
  await expect(page.getByTestId("city-option-card")).toHaveCount(2);
  await expectDrivingAbsent(page);
  await expect(page.getByRole("status").filter({ hasText: /^2 selectable journeys\.$/ })).toBeVisible();
  const known = page.getByTestId("city-option-card").filter({ hasText: "Checked complete-fare transit" });
  const unknown = page.getByTestId("city-option-card").filter({ hasText: "Checked unknown-fare transit" });
  await expect(page.getByTestId("city-option-card").locator("h3")).toHaveText(["Checked complete-fare transit", "Checked unknown-fare transit"]);
  await expect(known).toContainText("$40.00");
  await expect(known).toContainText("Complete journey price");
  await expect(unknown).toContainText("Total trip cost unknown");
  await expect(unknown).not.toContainText(/\$0(?:\.00)?\b/);
  await expect(unknown.getByRole("group", { name: "Total trip cost unknown", exact: true })).not.toContainText(/\$0(?:\.00)?\b|\bfree\b/i);
  await expect(page.getByRole("region", { name: "Flight quotes", exact: true })).toContainText("$250.00");
  await known.getByRole("button", { name: "Choose this itinerary", exact: true }).click();
  await page.getByRole("button", { name: "Save on this device", exact: true }).click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(saved.plan.id).toBe("checked-known-bus");
  expect(saved.plan.kind).toBe("transit");
  expect(saved.request.drivingAllowed).toBe(false);
  expect(saved.request.confirmedOptions.every((candidate: CityCandidate) => candidate.kind === "transit")).toBe(true);
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Cheaper");
  expect(cityPosts).toHaveLength(1); expect(travelPosts).toHaveLength(1);
  await expectDrivingAbsent(page);
  await page.getByRole("button", { name: "Recheck available sources", exact: true }).click();
  await expect.poll(() => cityPosts.length).toBe(2);
  await expect.poll(() => travelPosts.length).toBe(2);
  expect(cityPosts[1].request.priority).toBe("cheapest");
  expect(cityPosts.every(input => input.request.drivingAllowed === false)).toBe(true);
  expect(travelPosts.every(input => input.trip.drivingAllowed === false)).toBe(true);
  await page.getByText("Earlier comparisons", { exact: true }).click();
  await expect(page.getByTestId("historical-city-option")).not.toHaveCount(0);
  await expectDrivingAbsent(page);
  await page.evaluate(() => document.fonts.ready);
  await expectNoOverflow(page);
  await page.screenshot({ path: "/tmp/travel-driving-removal-desktop.png", fullPage: true });
});

test("drive-only defensive responses leave flight planning usable without a hidden-driving count or save claim", async ({ page }) => {
  const { cityPosts, travelPosts } = await fixtures(page, true);
  await start(page);
  await expect(page.getByTestId("city-option-card")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^0 selectable journeys\.$/ })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("does not mean no travel options exist");
  await expectDrivingAbsent(page);
  await expect(page.getByRole("button", { name: "Choose this itinerary", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save on this device", exact: true })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  await page.getByRole("button", { name: "Plan this flight", exact: true }).click();
  await expect(page.getByRole("form", { name: "Complete journey facts", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Flight quotes", exact: true })).toContainText("$250.00");
  expect(cityPosts).toHaveLength(1); expect(travelPosts).toHaveLength(1);
  expect(cityPosts[0].request.drivingAllowed).toBe(false);
  expect(travelPosts[0].trip.drivingAllowed).toBe(false);
});

test("390 and 320 pixel layouts show transit and flights without driving cards or horizontal overflow", async ({ page }) => {
  const { cityPosts, travelPosts } = await fixtures(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await start(page);
    await expect(page.getByTestId("city-option-card")).toHaveCount(2);
    await expectDrivingAbsent(page);
    const conversation = await page.getByRole("log").boundingBox();
    const options = await page.getByRole("region", { name: "Travel options", exact: true }).boundingBox();
    expect(conversation).not.toBeNull(); expect(options).not.toBeNull();
    expect(options!.y).toBeGreaterThanOrEqual(conversation!.y + conversation!.height - 2);
    await page.getByTestId("city-option-card").first().getByText("Journey details and sources", { exact: true }).click();
    await expect(page.getByTestId("city-option-card").first()).toContainText("Traveler fixture — no live check");
    await page.getByRole("button", { name: "Plan this flight", exact: true }).scrollIntoViewIfNeeded();
    await expectNoOverflow(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `/tmp/travel-driving-removal-mobile-${width}.png`, fullPage: true });
  }
  expect(cityPosts).toHaveLength(2); expect(travelPosts).toHaveLength(2);
  expect(cityPosts.every(input => input.request.drivingAllowed === false)).toBe(true);
  expect(travelPosts.every(input => input.trip.drivingAllowed === false)).toBe(true);
});
