import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
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
import { CityRecoveryResponseSchema, type CityRecoveryInput, type CityCandidate } from "../../supabase/functions/_shared/domain/city-contracts";

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
function flightResponse(input: TravelRecoveryInput) {
  const fixture = travelFixture();
  const flight = structuredClone(fixture.flight);
  flight.departureDate = input.departureDate;
  for (const segment of flight.segments) {
    segment.departureAt = segment.departureAt.replace("2026-11-19", input.departureDate);
    segment.arrivalAt = segment.arrivalAt.replace("2026-11-19", input.departureDate);
  }
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
async function fixtures(page: Page) {
  const cityPosts: CityRecoveryInput[] = [];
  const travelPosts: TravelRecoveryInput[] = [];
  let nextRefinementGate: ReturnType<typeof deferred> | undefined;
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/functions/v1/recovery/city", async (route) => {
    expect(route.request().method()).toBe("POST");
    const input = route.request().postDataJSON() as CityRecoveryInput;
    cityPosts.push(input);
    if (input.refinement) { const gate = nextRefinementGate; nextRefinementGate = undefined; await gate?.promise; }
    const origin = findCity(input.request.originCityId)!;
    const destination = findCity(input.request.destinationCityId)!;
    const candidates: CityCandidate[] = Array.from({ length: 3 }, (_, index) => ({
      id: `checked-bus-${index}`, title: `Checked fixture coach ${index + 1}`, kind: "transit",
      originCityId: origin.id, destinationCityId: destination.id,
      legs: [{ id: `bus-leg-${index}`, mode: "bus", from: { name: origin.name, latitude: origin.latitude, longitude: origin.longitude },
        to: { name: destination.name, latitude: destination.latitude, longitude: destination.longitude },
        startAt: input.request.readyAt, endAt: new Date(Date.parse(input.request.readyAt) + (180 + index * 30) * 60000).toISOString(),
        departureTimeZone: origin.timeZone, arrivalTimeZone: destination.timeZone, operator: "Concord Coach Lines", service: `Fixture ${index + 1}`,
        vehicleId: `fixture-${index}`, assumptions: [] }],
      costs: [{ label: "Fixture complete fare", cents: 4000 + index * 1000, currency: "USD", includedInOtherCharge: false }],
      evidence: [{ type: "traveler_confirmed", provider: "Traveler fixture — no live check", sourceUrl: null, checkedAt: now,
        serviceDate: input.request.readyAt.slice(0, 10), providerUpdatedAt: null, expiresAt: null, environment: "production", warnings: [] }],
      confirmations: [],
    }));
    const response = CityRecoveryResponseSchema.parse({
      version: 2,
      result: planCityRecovery(input.request, candidates, { origin, destination, now }),
      facts: { candidates, checkedAt: now, expiresAt, adapterRevision: "public-city-v1" },
      ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
      ...(input.refinement ? {
        assistance: {
          status: "limited", summary: `Checked comparison ${cityPosts.length}: the confirmed coach facts and prices are unchanged.`,
          appliedPreferences: {}, selectedPlanId: null, activity: [actualActivity],
        },
      } : {}),
    });
    await route.fulfill({ json: response });
  });
  await page.route("**/functions/v1/recovery/travel", async (route) => {
    expect(route.request().method()).toBe("POST");
    const input = route.request().postDataJSON() as TravelRecoveryInput;
    travelPosts.push(input);
    await route.fulfill({ json: flightResponse(input) });
  });
  return { cityPosts, travelPosts, holdNextRefinement() { nextRefinementGate = deferred(); return nextRefinementGate; } };
}
async function start(page: Page) {
  await page.goto("/");
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

const history = (page: Page) => page.getByRole("region", { name: "Conversation history", exact: true });
const optionsRegion = (page: Page) => page.getByRole("region", { name: "Travel options", exact: true });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message about your trip", exact: true });
async function populate(page: Page, count = 8) {
  for (let index = 1; index <= count; index++) {
    await composer(page).fill(`Compare the checked coach choices, question ${index}`);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log", { name: "Recovery conversation", exact: true })).toContainText(`Checked comparison ${index + 1}:`);
  }
}
async function scrollState(page: Page) {
  return page.evaluate(() => {
    const log = document.querySelector('[aria-label="Recovery conversation"]')!;
    const left = document.querySelector('[aria-label="Conversation history"]') ?? log.parentElement!;
    const right = document.querySelector('[aria-label="Travel options"]')!;
    const geometry = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height,
      top: node.scrollTop, client: node.clientHeight, total: node.scrollHeight }; };
    const rect = left.getBoundingClientRect();
    return { left: geometry(left), right: geometry(right), windowY: window.scrollY,
      visibleTurns: [...log.querySelectorAll(".conversation-turn")].filter(node => { const r = node.getBoundingClientRect(); return r.top >= rect.top && r.bottom <= rect.bottom; }).length };
  });
}
async function settleScroll(target: Locator) {
  let previous = -1, stableSamples = 0;
  await expect.poll(async () => {
    const top = await target.evaluate(node => node.scrollTop);
    stableSamples = top === previous ? stableSamples + 1 : 0;
    previous = top;
    return stableSamples;
  }, { intervals: [50, 100, 100] }).toBeGreaterThanOrEqual(2);
}
async function wheel(page: Page, target: Locator, deltaY: number) {
  const r = await box(target);
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.wheel(0, deltaY);
  await settleScroll(target);
}

test("desktop history fits normal turns and both panels respond independently to wheel and keyboard", async ({ page }) => {
  const requests = await fixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await start(page);
  await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(1);
  await populate(page);
  await page.evaluate(() => document.fonts.ready);
  const before = await scrollState(page);
  console.log("WORKSPACE_DESKTOP_GEOMETRY", JSON.stringify(before));
  await page.screenshot({ path: process.env.WORKSPACE_BASELINE ? "/tmp/travel-workspace-scroll-before-desktop.png" : "/tmp/travel-workspace-scroll-after-desktop.png", fullPage: true });
  expect(before.left.client).toBeGreaterThanOrEqual(420);
  expect(before.visibleTurns).toBeGreaterThanOrEqual(3);
  await expect(history(page)).toHaveAttribute("tabindex", "0");
  await expect(optionsRegion(page)).toHaveAttribute("tabindex", "0");
  expect(before.left.total).toBeGreaterThan(before.left.client);
  expect(before.right.total).toBeGreaterThan(before.right.client);
  const requestCounts = [requests.cityPosts.length, requests.travelPosts.length];
  await wheel(page, history(page), -500);
  const leftMoved = await scrollState(page);
  expect(leftMoved.left.top).toBeLessThan(before.left.top - 100);
  expect(leftMoved.right.top).toBe(before.right.top);
  expect(leftMoved.windowY).toBe(before.windowY);
  await expect(composer(page)).toBeInViewport({ ratio: 1 });
  await history(page).focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await scrollState(page)).left.top).toBe(0);
  await wheel(page, history(page), -1500);
  expect((await scrollState(page)).windowY).toBe(before.windowY);
  await page.keyboard.press("PageDown");
  await expect.poll(async () => (await scrollState(page)).left.top).toBeGreaterThan(0);
  // Keyboard paging animates in Chromium; wait until it settles before
  // testing whether a subsequent right-panel gesture changes the left panel.
  await settleScroll(history(page));
  const leftStable = (await scrollState(page)).left.top;
  await wheel(page, optionsRegion(page), 600);
  const rightMoved = await scrollState(page);
  expect(rightMoved.right.top).toBeGreaterThan(before.right.top + 100);
  expect(rightMoved.left.top).toBe(leftStable);
  expect(rightMoved.windowY).toBe(before.windowY);
  await optionsRegion(page).focus();
  await page.keyboard.press("End");
  await expect.poll(async () => { const s = await scrollState(page); return s.right.total - s.right.client - s.right.top; }).toBeLessThanOrEqual(1);
  await wheel(page, optionsRegion(page), 1500);
  expect((await scrollState(page)).left.top).toBe(leftStable);
  expect((await scrollState(page)).windowY).toBe(before.windowY);
  await writeFile("/tmp/travel-workspace-scroll-after-geometry.json", JSON.stringify({ desktop: before, afterLeftWheel: leftMoved, afterRightWheel: rightMoved, afterRightBoundary: await scrollState(page) }, null, 2));
  await expect(page.getByRole("button", { name: "Save on this device", exact: true })).toBeInViewport();
  const manual = page.getByText("Add an option you’ve checked", { exact: true });
  await manual.click();
  await page.getByRole("textbox", { name: "Operator", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("textbox", { name: "Operator", exact: true })).toBeInViewport({ ratio: 1 });
  await manual.click();
  const sources = page.getByText("Journey details and sources", { exact: true }).first();
  await sources.click();
  await expect(page.getByText("Traveler fixture — no live check", { exact: false }).first()).toBeVisible();
  await page.getByText("Edit trip", { exact: true }).click();
  await page.getByRole("combobox", { name: "From city", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("combobox", { name: "From city", exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByText("Edit trip", { exact: true }).click();
  await page.getByText("Try a demonstration", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Try a demonstration", { exact: true })).toBeInViewport();
  const privacy = page.getByRole("link", { name: "Privacy", exact: true });
  await privacy.scrollIntoViewIfNeeded();
  await expect(privacy).toBeInViewport({ ratio: 1 });
  await expectNoOverflow(page);
  expect([requests.cityPosts.length, requests.travelPosts.length]).toEqual(requestCounts);
});

test("a deferred checked answer preserves a reader's position and follows only a reader at the bottom", async ({ page }) => {
  const requests = await fixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await start(page);
  await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(1);
  await populate(page);
  const gate = requests.holdNextRefinement();
  await composer(page).fill("Compare the checked prices once more");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => requests.cityPosts.length).toBe(10);
  await expect(page.getByRole("status").filter({ hasText: "Checking available journey facts" })).toBeVisible();
  await wheel(page, history(page), -700);
  const reading = await scrollState(page);
  expect(reading.left.top).toBeGreaterThan(0);
  expect(reading.left.total - reading.left.client - reading.left.top).toBeGreaterThan(300);
  gate.resolve();
  await expect(page.getByRole("log", { name: "Recovery conversation", exact: true })).toContainText("Checked comparison 10:");
  await expect.poll(async () => Math.abs((await scrollState(page)).left.top - reading.left.top)).toBeLessThanOrEqual(2);
  expect((await scrollState(page)).right.top).toBe(reading.right.top);
  expect((await scrollState(page)).windowY).toBe(reading.windowY);
  await expect(composer(page)).toBeInViewport({ ratio: 1 });
  const followGate = requests.holdNextRefinement();
  await composer(page).fill("Compare the coach timing again please");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => requests.cityPosts.length).toBe(11);
  await expect.poll(async () => { const s = await scrollState(page); return s.left.total - s.left.client - s.left.top; }).toBeLessThanOrEqual(2);
  followGate.resolve();
  await expect(page.getByRole("log", { name: "Recovery conversation", exact: true })).toContainText("Checked comparison 11:");
  await expect.poll(async () => { const s = await scrollState(page); return s.left.total - s.left.client - s.left.top; }).toBeLessThanOrEqual(2);
  // Cross the rendered 24-turn cap through actual UI submissions. A new
  // assistant turn must still trigger follow even when the length stays 24.
  for (const comparison of [12, 13, 14]) {
    await composer(page).fill(`Compare these checked coach choices again, request ${comparison}`);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("log", { name: "Recovery conversation", exact: true })).toContainText(`Checked comparison ${comparison}:`);
    console.log(`WORKSPACE_CAPPED_FOLLOW_${comparison}`, JSON.stringify(await scrollState(page)));
    await expect.poll(async () => { const s = await scrollState(page); return s.left.total - s.left.client - s.left.top; }).toBeLessThanOrEqual(2);
  }
  await expect(page.getByRole("log", { name: "Recovery conversation", exact: true }).locator(".conversation-turn")).toHaveCount(24);
  const cappedCounts = [requests.cityPosts.length, requests.travelPosts.length];
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await expect(page.getByRole("log", { name: "Recovery conversation", exact: true })).toContainText("Cheaper");
  await expect.poll(async () => { const s = await scrollState(page); return s.left.total - s.left.client - s.left.top; }).toBeLessThanOrEqual(2);
  expect([requests.cityPosts.length, requests.travelPosts.length]).toEqual(cappedCounts);
  expect(requests.travelPosts).toHaveLength(1);
  expect(requests.cityPosts.at(-1)?.request).toEqual(requests.cityPosts.at(-2)?.request);
});

test("short desktop workspaces provide useful bounded history and reachable composition", async ({ page }) => {
  const requests = await fixtures(page);
  for (const { width, height, minimum } of [
    { width: 1280, height: 600, minimum: 200 },
    { width: 901, height: 700, minimum: 280 },
    { width: 1024, height: 700, minimum: 280 },
  ]) {
    await page.setViewportSize({ width, height });
    await start(page);
    await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(1);
    const geometry = await scrollState(page);
    console.log(`WORKSPACE_SHORT_GEOMETRY_${width}x${height}`, JSON.stringify(geometry));
    expect(geometry.left.client).toBeGreaterThanOrEqual(minimum);
    expect(geometry.left.y + geometry.left.height).toBeLessThanOrEqual(height);
    expect(geometry.right.y + geometry.right.height).toBeLessThanOrEqual(height);
    await composer(page).fill("Keep this comparison question ready");
    await expect(composer(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeInViewport({ ratio: 1 });
    await expectNoOverflow(page);
    if (width === 1280) await page.screenshot({ path: "/tmp/travel-workspace-scroll-after-short.png", fullPage: true });
  }
  expect(requests.cityPosts).toHaveLength(3);
  expect(requests.travelPosts).toHaveLength(3);
});

test("wide to narrow to wide preserves actual conversation and draft with natural mobile stacking", async ({ page }) => {
  const requests = await fixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await start(page);
  await expect(page.getByRole("button", { name: "Plan this flight", exact: true })).toHaveCount(1);
  await populate(page);
  const log = page.getByRole("log", { name: "Recovery conversation", exact: true });
  const transcript = await log.locator(".conversation-turn").allTextContents();
  const requestCounts = [requests.cityPosts.length, requests.travelPosts.length];
  await composer(page).fill("My unsent comparison survives resizing");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await log.locator(".conversation-turn").allTextContents()).toEqual(transcript);
    await expect(composer(page)).toHaveValue("My unsent comparison survives resizing");
    const aside = await box(page.getByRole("complementary", { name: "Trip conversation", exact: true }));
    const right = await box(optionsRegion(page));
    expect(right.y).toBeGreaterThanOrEqual(aside.y + aside.height - 1);
    expect(await history(page).evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    expect(await optionsRegion(page).evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    await composer(page).scrollIntoViewIfNeeded();
    await composer(page).click();
    await expect(composer(page)).toBeFocused();
    expect(await composer(page).evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    await expectNoOverflow(page);
    if (width === 390) await page.screenshot({ path: "/tmp/travel-workspace-scroll-after-mobile.png", fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await log.locator(".conversation-turn").allTextContents()).toEqual(transcript);
  await expect(composer(page)).toHaveValue("My unsent comparison survives resizing");
  expect((await scrollState(page)).left.client).toBeGreaterThanOrEqual(420);
  await expect(composer(page)).toBeInViewport({ ratio: 1 });
  expect([requests.cityPosts.length, requests.travelPosts.length]).toEqual(requestCounts);
});
