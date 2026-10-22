import { openManualOptions, compare, investigate, echoConversation, revealPlan, reviewPlan } from "./helpers";
import { test, expect, type Page } from "./auth-fixture";
import { daytimeFixture } from "../../supabase/functions/_shared/domain/fixtures";
import { planRecovery } from "../../supabase/functions/_shared/domain/planner";
import {
  ADAPTER_REVISION,
  RecoveryResponseSchema,
} from "../../supabase/functions/_shared/domain/api";
import type { ConfirmedOption } from "../../supabase/functions/_shared/domain/schemas";
const endpoint = "**/functions/v1/recovery";
const key = "travel-recovery:selected:v1:account:11111111-1111-4111-8111-111111111111";
function fixtureResponse(arrivalAt = "2026-11-18T08:00:00-05:00") {
  const f = daytimeFixture();
  function production(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(production);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [
          name,
          name === "type" && item === "synthetic"
            ? "traveler_confirmed"
            : name === "environment" && item === "synthetic"
              ? "production"
              : production(item),
        ]),
      );
    return value;
  }
  const candidates = production(f.candidates) as ConfirmedOption[];
  const google = candidates.find((c) => c.kind === "bus")!;
  if (google.kind === "overnight") throw new Error("Expected bus fixture");
  google.evidence[0].provider = "Google Maps Routes API";
  google.evidence[0].type = "schedule";
  const arrival = { arrivalAt, arrivalBasis: "traveler_confirmed" as const };
  const request = {
    ...f.request,
    ...arrival,
    mode: "real" as const,
    flight: null,
    confirmedOptions: candidates,
  };
  const checkedAt = new Date().toISOString();
  return RecoveryResponseSchema.parse({
    result: planRecovery(request, candidates, { now: checkedAt }),
    facts: {
      candidates,
      arrival,
      arrivalEvidence: [{
        type: "traveler_confirmed",
        provider: "Traveler fixture arrival",
        sourceUrl: null,
        serviceDate: "2026-11-18",
        checkedAt: "2026-10-20T01:23:45Z",
        providerUpdatedAt: null,
        expiresAt: null,
        environment: "production",
        warnings: [],
      }],
      checkedAt,
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
      adapterRevision: ADAPTER_REVISION,
    },
  });
}
async function enterTrip(page: Page) {
  await page.goto("/legacy");
  await openManualOptions(page);
  await page.getByLabel("Revised gate arrival", { exact: true }).fill("2026-11-18T08:00");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
}


test("traveler arrival is sufficient without flight inputs, status or unavailable warnings", async ({ page }) => {
  const posts: any[] = [];
  await page.route(endpoint, async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ json: echoConversation(route, fixtureResponse()) });
  });
  await enterTrip(page);
  await expect(page.getByLabel("Arrival time source")).toHaveCount(0);
  await expect(page.getByLabel("Flight identifier", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("San Diego departure date")).toHaveCount(0);
  await investigate(page);
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ investigate: true, request: {
    arrivalAt: "2026-11-18T08:00:00-05:00", arrivalBasis: "traveler_confirmed", flight: null,
  } });
  await expect(page.getByTestId("flight-status")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText(/FlightAware|Gate arrival unavailable/);
  await reviewPlan(page, "View Fictional intercity train");
  await expect(page.getByTestId("itinerary")).toContainText("Traveler fixture arrival");
  await expect(page.getByTestId("itinerary")).toContainText("2026-10-20T01:23:45Z");
});

test("Google-only TEST FIXTURE preserves attribution and transient retention through zero-POST reranking", async ({ page }) => {
  const posts: any[] = [];
  await page.route(endpoint, async (route) => {
    const post = route.request().postDataJSON();
    posts.push(post);
    await route.fulfill({ json: echoConversation(route, fixtureResponse(post.request.arrivalAt)) });
  });
  await enterTrip(page);
  await compare(page);
  await revealPlan(page, "View Fictional intercity bus");
  const googleCard = page.getByTestId("option-card").filter({ hasText: "intercity bus" });
  await expect(googleCard).toContainText("Google Maps");
  await expect(googleCard).not.toContainText("Traveler-entered sources");
  const attribution = googleCard.getByText("Google Maps", { exact: true });
  await expect(attribution).toHaveAttribute("translate", "no");
  await expect(attribution).toHaveCSS("white-space", "nowrap");
  await expect(attribution).toHaveCSS("font-weight", "400");
  await expect(attribution).toHaveCSS("font-size", "12px");
  await expect(attribution).toHaveCSS("color", "rgb(31, 31, 31)");
  await expect(googleCard.getByRole("link", { name: "Google Maps terms" })).toHaveAttribute("href", "https://www.google.com/help/terms_maps/");
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  expect(posts).toHaveLength(1);
  await reviewPlan(page, "View Fictional intercity train");
  await page.getByRole("button", { name: "Save on this device", exact: true }).click();
  await expect(page.getByTestId("saved-plan")).toBeVisible();
  const previous = await page.evaluate((key) => localStorage.getItem(key), key);
  expect(previous).not.toContain("Google Maps Routes API");
  const parsed = JSON.parse(previous!);
  expect(parsed.request.confirmedOptions.some((c: { kind: string }) => c.kind === "bus")).toBe(false);
  await reviewPlan(page, "View Fictional intercity bus");
  await expect(page.getByTestId("itinerary").getByText("Google Maps", { exact: true })).toHaveAttribute("translate", "no");
  await page.getByRole("button", { name: "Save on this device", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Google Maps route content cannot be saved");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(previous);
  await openManualOptions(page);
  await page.getByLabel("Revised gate arrival", { exact: true }).fill("2026-11-18T08:15");
  await compare(page);
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].request.arrivalAt).toBe("2026-11-18T08:15:00-05:00");
  await reviewPlan(page, "View Fictional intercity train");
  await expect(page.getByTestId("itinerary")).toContainText("8:15");
  await expect(page.getByTestId("itinerary")).toContainText("traveler confirmed");
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText("Historical snapshot");
  expect(posts).toHaveLength(2);
  await expect(page.getByTestId("option-card")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("Google Maps Routes API");
});

test("public terms and privacy pages explain current sharing and device retention", async ({ page }) => {
  await page.goto("/legacy");
  await page.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Find my options");
  await expect(page.getByRole("main")).toContainText("Google Maps");
  await expect(page.getByRole("main")).not.toContainText(/flight identifiers|departure date|flight lookup/i);
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("No booking");
  await expect(page.getByRole("link", { name: "Google Privacy Policy", exact: true })).toHaveAttribute("href", "https://policies.google.com/privacy");
});

test("legacy saved flight metadata remains historical while refresh sends traveler arrival", async ({ page }) => {
  const posts: any[] = [];
  await page.route(endpoint, async (route) => {
    const post = route.request().postDataJSON();
    posts.push(post);
    await route.fulfill({ json: echoConversation(route, fixtureResponse(post.request.arrivalAt)) });
  });
  await enterTrip(page);
  await compare(page);
  await reviewPlan(page, "View Fictional intercity train");
  await page.getByRole("button", { name: "Save on this device", exact: true }).click();
  await expect(page.getByTestId("saved-plan")).toBeVisible();
  const historical = await page.evaluate((key) => {
    const record = JSON.parse(localStorage.getItem(key)!);
    record.request.arrivalAt = "2026-11-18T13:00:00Z";
    record.request.arrivalBasis = "actual_gate";
    record.request.flight = { ident: "ASA123", departureDate: "2026-11-18" };
    const raw = JSON.stringify(record);
    localStorage.setItem(key, raw);
    return raw;
  }, key);
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText("Historical snapshot");
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "Refresh this plan", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ investigate: true, request: {
    arrivalAt: "2026-11-18T13:00:00Z", arrivalBasis: "traveler_confirmed", flight: null,
  } });
  expect(posts[1].request.confirmedOptions).toEqual(JSON.parse(historical).request.confirmedOptions);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(historical);
  await expect(page.getByLabel("Flight identifier", { exact: true })).toHaveCount(0);
});
