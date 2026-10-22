import { expect, test, type Locator, type Page } from "./auth-fixture";
import { travelFixture } from "../../supabase/functions/_shared/domain/travel-fixtures";
import {
  flightOfferFingerprint,
  flightOfferId,
  TravelRecoveryResponseSchema,
  travelRequestBinding,
  type TravelRecoveryInput,
} from "../../supabase/functions/_shared/domain/travel-contracts";
import { assessTravelSelection } from "../../supabase/functions/_shared/domain/travel-planner";
import { findCity } from "../../supabase/functions/_shared/domain/city-catalog";
import { planCityRecovery } from "../../supabase/functions/_shared/domain/city-planner";
import { CityRecoveryResponseSchema, type CityRecoveryInput } from "../../supabase/functions/_shared/domain/city-contracts";

const now = "2026-11-18T14:00:00Z";
const expiresAt = "2026-11-18T14:05:00Z";
const actualActivity = {
  tool: "find_transport_options" as const,
  status: "limited" as const,
  message: "Fixture source returned no confirmed ground departures.",
  checkedAt: now,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function flightResponse(input: TravelRecoveryInput, unknownFare = false) {
  const fixture = travelFixture();
  const flight = structuredClone(fixture.flight);
  flight.departureDate = input.departureDate;
  for (const segment of flight.segments) {
    segment.departureAt = segment.departureAt.replace("2026-11-19", input.departureDate);
    segment.arrivalAt = segment.arrivalAt.replace("2026-11-19", input.departureDate);
  }
  if (unknownFare) flight.costs[0].cents = null;
  flight.id = flightOfferId(flight);
  flight.fingerprint = flightOfferFingerprint(flight);
  const offers = { flightOffers: [flight], hotelOffers: [] };
  return TravelRecoveryResponseSchema.parse({
    version: 3,
    request: travelRequestBinding(input),
    origin: fixture.origin,
    destination: fixture.destination,
    generatedAt: now,
    expiresAt,
    ...offers,
    ...assessTravelSelection(input, { ...offers, origin: fixture.origin, destination: fixture.destination, now }),
    sourceStatuses: [{ source: "flights", status: "available", message: "Fixture flight quote checked.", checkedAt: now, expiresAt }],
    warnings: ["Test fixture only; no live inventory was requested."],
    ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
  });
}
async function fixtures(page: Page, options: {
  cityGate?: ReturnType<typeof deferred>;
  travelGate?: ReturnType<typeof deferred>;
  refinementGate?: ReturnType<typeof deferred>;
  unknownFare?: boolean;
  failTravel?: boolean;
} = {}) {
  const cityPosts: CityRecoveryInput[] = [];
  const travelPosts: TravelRecoveryInput[] = [];
  const fulfilledTravel: TravelRecoveryInput[] = [];
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/functions/v1/recovery/city", async (route) => {
    expect(route.request().method()).toBe("POST");
    const input = route.request().postDataJSON() as CityRecoveryInput;
    cityPosts.push(input);
    if (input.refinement) await options.refinementGate?.promise;
    else await options.cityGate?.promise;
    const origin = findCity(input.request.originCityId)!;
    const destination = findCity(input.request.destinationCityId)!;
    const response = CityRecoveryResponseSchema.parse({
      version: 2,
      result: planCityRecovery(input.request, [], { origin, destination, now }),
      facts: { candidates: [], checkedAt: now, expiresAt, adapterRevision: "public-city-v1" },
      ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
      ...(input.refinement ? {
        assistance: {
          status: "limited", summary: "Only checked source facts are shown.",
          appliedPreferences: {}, selectedPlanId: null, activity: [actualActivity],
        },
      } : {}),
    });
    await route.fulfill({ json: response });
  });
  await page.route("**/functions/v1/recovery/travel", async (route) => {
    expect(route.request().method()).toBe("POST");
    const input = route.request().postDataJSON() as TravelRecoveryInput;
    // This suite exercises the primary SAN–PWM flow. The automatic alternate
    // search receives an honest empty response and is tested in nearby-airport.spec.
    if (input.originAirportIata !== "SAN" || input.destinationAirportIata !== "PWM") {
      const fixture = travelFixture();
      await route.fulfill({ json: TravelRecoveryResponseSchema.parse({
        version: 3, request: travelRequestBinding(input), origin: fixture.origin, destination: fixture.destination,
        generatedAt: now, expiresAt: expiresAt, flightOffers: [], hotelOffers: [], journey: null, selectionIssue: null,
        sourceStatuses: [{ source: "flights", status: "empty", message: "No quotes from this airport pair in the scoped fixture.", checkedAt: now, expiresAt: expiresAt }],
        warnings: ["Deterministic empty alternate response; no live inventory requested."],
        ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
      }) });
      return;
    }

    travelPosts.push(input);
    await options.travelGate?.promise;
    await route.fulfill(options.failTravel
      ? { status: 503, json: { error: "Fixture travel source temporarily unavailable." } }
      : { json: flightResponse(input, options.unknownFare) });
    fulfilledTravel.push(input);
  });
  return { cityPosts, travelPosts, fulfilledTravel };
}
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where are you trying to get to?", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "From city", exact: true }).fill("San Diego CA");
  await page.getByRole("option", { name: /^San Diego, CA/ }).click();
  await page.getByRole("combobox", { name: "To city", exact: true }).fill("Portland ME");
  await page.getByRole("option", { name: /^Portland, ME/ }).click();
  await expect(page.getByLabel("As soon as possible", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Find my options", exact: true }).click();
}
async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test("real pending requests show named, noninteractive busy feedback and settle after fulfillment", async ({ page }) => {
  const cityGate = deferred(), travelGate = deferred();
  const { cityPosts, travelPosts } = await fixtures(page, { cityGate, travelGate });
  await start(page);
  await expect.poll(() => cityPosts.length + travelPosts.length).toBe(2);
  const status = page.getByRole("status").filter({ hasText: "Checking available journey facts" });
  await expect(status).toBeVisible();
  await expect(status.locator(".companion-spinner")).toBeVisible();
  await expect(status.locator(".companion-spinner")).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("textbox", { name: "Message about your trip", exact: true }).fill("Help me compare these choices");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await page.getByText("Edit trip", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm trip facts and update options", exact: true })).toBeDisabled();
  cityGate.resolve(); travelGate.resolve();
  await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(1);
  await expect(page.locator(".companion-spinner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  expect(cityPosts).toHaveLength(1); expect(travelPosts).toHaveLength(1);
});

test("canceling a pending travel check clears busy feedback and ignores a late fixture response", async ({ page }) => {
  const travelGate = deferred();
  const { travelPosts, fulfilledTravel } = await fixtures(page, { travelGate });
  await start(page);
  const panel = page.getByRole("region", { name: "Flight and overnight planning", exact: true });
  await expect(panel.getByRole("status").filter({ hasText: "Checking flight and overnight sources" })).toBeVisible();
  await expect(panel.locator(".companion-spinner")).toBeVisible();
  await page.getByRole("button", { name: "Cancel travel search", exact: true }).click();
  await expect(panel.locator(".companion-spinner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel travel search", exact: true })).toHaveCount(0);
  travelGate.resolve();
  await expect.poll(() => fulfilledTravel.length).toBe(1);
  await page.getByRole("textbox", { name: "Message about your trip", exact: true }).fill("My unsent trip question");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(0);
  expect(travelPosts).toHaveLength(1);
});

test("desktop places conversation and reachable composer left of qualified, prominent travel fares", async ({ page }) => {
  await fixtures(page);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await start(page);
    await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `/tmp/travel-polish-after-desktop-${width}.png`, fullPage: true });
    const conversation = await box(page.getByRole("log", { name: "Recovery conversation", exact: true }));
    const options = await box(page.getByRole("region", { name: "Travel options", exact: true }));
    expect(conversation.x + conversation.width).toBeLessThanOrEqual(options.x + 2);
    const message = page.getByRole("textbox", { name: "Message about your trip", exact: true });
    const composer = await box(message);
    expect(composer.x + composer.width).toBeLessThanOrEqual(options.x + 2);
    expect(composer.y + composer.height).toBeLessThanOrEqual(900);
    const quote = page.getByRole("region", { name: "Flight quotes", exact: true });
    const price = quote.locator(".companion-price").filter({ hasText: "$250.00" }).first();
    await expect(price).toBeVisible();
    const styles = await price.evaluate((node) => ({ size: parseFloat(getComputedStyle(node).fontSize), family: getComputedStyle(node).fontFamily }));
    expect(styles.size).toBeGreaterThanOrEqual(28);
    expect(styles.family).toContain("Sora");
    await expect(quote).toContainText(/fare is not a complete journey total/i);
    await expectNoOverflow(page);
  }
});

test("unknown flight amounts stay explicitly unknown and never become a zero or free fare", async ({ page }) => {
  await fixtures(page, { unknownFare: true });
  await start(page);
  const quote = page.getByRole("region", { name: "Flight quotes", exact: true });
  await expect(quote).toBeVisible();
  await expect(quote.locator(".companion-price")).toContainText(/unknown/i);
  await expect(quote).not.toContainText(/\$0(?:\.00)?\b|\bfree\b/i);
  await expect(quote).toContainText(/not a complete journey total/i);
});

test("narrow mobile layouts stack all options and allow unobscured keyboard composition", async ({ page }) => {
  await fixtures(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await start(page);
    const message = page.getByRole("textbox", { name: "Message about your trip", exact: true });
    const conversation = await box(page.getByRole("log", { name: "Recovery conversation", exact: true }));
    const options = await box(page.getByRole("region", { name: "Travel options", exact: true }));
    expect(options.y).toBeGreaterThanOrEqual(conversation.y + conversation.height - 2);
    await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Plan this flight", exact: true }).scrollIntoViewIfNeeded();
    await expectNoOverflow(page);
    await message.scrollIntoViewIfNeeded();
    await message.click();
    await page.keyboard.type("Please help me compare the timing");
    await expect(message).toBeFocused();
    await expect(message).toHaveValue("Please help me compare the timing");
    const unobscured = await message.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(unobscured).toBe(true);
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
    await expectNoOverflow(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `/tmp/travel-polish-after-mobile-${width}.png`, fullPage: true });
    if (width === 320) {
      await page.getByRole("button", { name: "Plan this flight", exact: true }).click();
      await expect(page.getByRole("form", { name: "Complete journey facts", exact: true })).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({ path: "/tmp/travel-polish-after-mobile-320-facts.png", fullPage: true });
    }
  }
});

test("reduced motion retains honest loading text, renders only returned agent activity, and clears busy on error", async ({ page }) => {
  const travelGate = deferred(), refinementGate = deferred();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { cityPosts, travelPosts } = await fixtures(page, { travelGate, refinementGate, failTravel: true });
  await start(page);
  const panel = page.getByRole("region", { name: "Flight and overnight planning", exact: true });
  const busy = panel.getByRole("status").filter({ hasText: "Checking flight and overnight sources" });
  await expect(busy).toBeVisible();
  const spinner = busy.locator(".companion-spinner");
  await expect(spinner).toBeVisible();
  expect(await spinner.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  await expect(page.getByText(actualActivity.message, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Recorded agent activity", exact: true })).toHaveCount(0);
  await expect(page.getByText(/(?:find transport options|find hotel options|assess recovery options).*completed/i)).toHaveCount(0);
  travelGate.resolve();
  await expect(panel.getByRole("alert")).toContainText(/unavailable/i);
  await expect(page.locator(".companion-spinner")).toHaveCount(0);
  const message = page.getByRole("textbox", { name: "Message about your trip", exact: true });
  await message.fill("Compare the departure times please");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => cityPosts.length).toBe(2);
  await expect(page.getByText(actualActivity.message, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Recorded agent activity", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Checking available journey facts" })).toBeVisible();
  refinementGate.resolve();
  const activityMessage = page.getByText(actualActivity.message, { exact: false });
  await expect(activityMessage).toHaveCount(1);
  const activityDetails = activityMessage.locator("xpath=ancestor::details");
  for (const details of await activityDetails.all()) {
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
      await details.locator(":scope > summary").click();
    }
  }
  await expect(activityMessage).toBeVisible();
  const recorded = page.getByRole("list", { name: "Recorded agent activity", exact: true });
  await expect(recorded.getByRole("listitem")).toHaveCount(1);
  await expect(recorded).toContainText("Transport options");
  await expect(recorded).toContainText("Limited");
  await expect(recorded).not.toContainText(/Completed|Places to stay|Recovery comparison/);
  await expect(page.getByText(/(?:find hotel options|assess recovery options).*completed/i)).toHaveCount(0);
  await expect(page.locator(".companion-spinner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  expect(travelPosts).toHaveLength(1);
});

test("short desktop viewports keep expanded privacy help and older-source composition reachable", async ({ page }) => {
  await fixtures(page);
  for (const { width, height } of [
    { width: 1280, height: 600 },
    { width: 1024, height: 600 },
    { width: 901, height: 700 },
    { width: 1024, height: 700 },
  ]) {
    await page.setViewportSize({ width, height });
    await start(page);
    await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(1);
    await page.clock.setFixedTime(new Date("2026-11-18T14:06:00Z"));
    await page.getByRole("button", { name: "Plan this flight", exact: true }).click();
    await expect(page.getByRole("form", { name: "Complete journey facts", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cheaper", exact: true })).toBeEnabled();
    await page.getByText("About messages and privacy", { exact: true }).click();
    const conversationViewportHeight = await page
      .getByRole("region", { name: "Conversation history", exact: true })
      .evaluate((node) => node.clientHeight);
    expect(conversationViewportHeight).toBeGreaterThanOrEqual(128);
    const privacyHelp = page.getByText(/Chats and trip details are saved to your signed-in account/);
    await privacyHelp.scrollIntoViewIfNeeded();
    await expect(privacyHelp).toBeInViewport({ ratio: 1 });
    const message = page.getByRole("textbox", { name: "Message about your trip", exact: true });
    await message.scrollIntoViewIfNeeded();
    await message.click();
    await page.keyboard.type("Help me recheck these options");
    await expect(message).toBeFocused();
    expect(await message.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    const send = page.getByRole("button", { name: "Send message", exact: true });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeEnabled();
    await expect(send).toBeInViewport({ ratio: 1 });
    expect(await send.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    await expectNoOverflow(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `/tmp/travel-polish-after-short-desktop-${width}x${height}.png`, fullPage: true });
    await page.clock.setFixedTime(new Date(now));
  }
});
