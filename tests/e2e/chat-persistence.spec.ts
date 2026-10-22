import { test, expect, fakeSession, AUTH_STORAGE_KEY, AUTH_USER_ID, AUTH_SECOND_USER_ID, interceptAuth, installConversationDatabase, type ConversationRow, type ConversationDatabase, type Page } from "./auth-fixture";
import { findCity } from "../../supabase/functions/_shared/domain/city-catalog";
import type { CityCandidate } from "../../supabase/functions/_shared/domain/city-contracts";
import { planCityRecovery } from "../../supabase/functions/_shared/domain/city-planner";

const now = "2026-11-18T12:55:00.000Z";
const trip = { originCityId: "geonames:4930956", destinationCityId: "geonames:4975802", goal: "asap", readyLocal: "", readyAt: now, deadlineLocal: "", budget: "", budgetMode: "soft", priority: "earliest" };
function seed(database: ConversationDatabase, title: string, contents: string[], userId = AUTH_USER_ID) {
  const row: ConversationRow = { id: crypto.randomUUID(), user_id: userId, title, trip, revision: 1,
    messages: contents.map((content, index) => ({ id: crypto.randomUUID(), role: index % 2 ? "assistant" : "user", content, revision: 0 })),
    created_at: now, updated_at: now };
  database.rows.set(row.id, structuredClone(row));
  return row;
}
function rowWith(database: ConversationDatabase, text: string) {
  return [...database.rows.values()].find(row => row.messages.some(message => message.content.includes(text)));
}
async function sources(page: Page) {
  const requests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/functions/v1/recovery")) requests.push(request.url()); });
  await page.clock.setFixedTime(new Date(now));
  await page.route("**/functions/v1/recovery/city", async route => {
    const input = route.request().postDataJSON();
    const origin = findCity(input.request.originCityId)!, destination = findCity(input.request.destinationCityId)!;
    await route.fulfill({ json: { version: 2,
      result: planCityRecovery(input.request, [], { origin, destination, now }),
      facts: { candidates: [], checkedAt: now, expiresAt: "2026-11-18T13:00:00Z", adapterRevision: "public-city-v1" },
      ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}) } });
  });
  await page.route("**/functions/v1/recovery/travel", async route => {
    const input = route.request().postDataJSON();
    const { refinement: _refinement, conversation, ...request } = input;
    await route.fulfill({ json: { version: 3, request, origin: findCity(input.trip.originCityId), destination: findCity(input.trip.destinationCityId),
      generatedAt: now, expiresAt: "2026-11-18T13:00:00Z", flightOffers: [], hotelOffers: [], sourceStatuses: [], journey: null, selectionIssue: null,
      warnings: ["No live inventory checked in this browser fixture."], ...(conversation ? { conversation: { turnId: conversation.turnId, baseRevision: conversation.baseRevision } } : {}) } });
  });
  return requests;
}
async function start(page: Page, destination = "Portland") {
  await page.getByRole("combobox", { name: "From city", exact: true }).fill("Boston MA");
  await page.getByRole("option", { name: /^Boston, MA/ }).click();
  await page.getByRole("combobox", { name: "To city", exact: true }).fill(destination === "Portland" ? "Portland ME" : "New York City NY");
  await page.getByRole("option", { name: destination === "Portland" ? /^Portland, ME/ : /^New York City, NY/ }).click();
  await page.getByRole("button", { name: "Find my options", exact: true }).click();
  await expect(page.getByRole("log", { name: "Recovery conversation", exact: true })).toContainText("No complete ground itinerary");
}
async function history(page: Page) {
  const summary = page.locator("summary").filter({ hasText: /^Chat history/ });
  if (!(await summary.locator("..").evaluate(element => (element as HTMLDetailsElement).open))) await summary.click();
}
async function send(page: Page, message: string) {
  await page.getByLabel("Message about your trip", { exact: true }).fill(message);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByLabel("Message about your trip", { exact: true })).toHaveValue("");
}

test("chat autosaves both roles and trip, restores after reload and opens in a fresh same-account browser context without provider calls", async ({ page, browser, baseURL, conversationDatabase }) => {
  const requests = await sources(page);
  await page.goto("/");
  await start(page);
  await expect.poll(() => rowWith(conversationDatabase, "Boston, MA to Portland, ME")?.messages.some(message => message.role === "assistant")).toBe(true);
  const stored = rowWith(conversationDatabase, "Boston, MA to Portland, ME")!;
  expect(stored.user_id).toBe(AUTH_USER_ID);
  expect(stored.trip).toMatchObject(trip);
  const expectedMessages = structuredClone(stored.messages);
  const before = requests.length;
  await page.reload();
  await expect(page.getByRole("log")).toContainText("Boston, MA to Portland, ME");
  await expect(page.getByText("Historical conversation", { exact: true })).toBeVisible();
  await expect(page.getByTestId("city-option-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check current options", exact: true })).toBeVisible();
  expect(requests).toHaveLength(before);
  expect(conversationDatabase.rows.get(stored.id)?.messages).toEqual(expectedMessages);

  const context = await browser.newContext({ baseURL });
  try {
    await installConversationDatabase(context, conversationDatabase);
    const second = await context.newPage();
    await interceptAuth(second);
    await second.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: fakeSession() });
    const secondRequests = await sources(second);
    await second.goto("/");
    await expect(second.getByRole("log")).toContainText("Boston, MA to Portland, ME");
    await expect(second.getByRole("log")).toContainText("No complete ground itinerary");
    expect(secondRequests).toEqual([]);
  } finally { await context.close(); }
});

test("New chat preserves the older chat, history reopens it, and deletion removes only the selected chat", async ({ page, conversationDatabase }) => {
  await sources(page);
  await page.goto("/");
  await start(page);
  await expect.poll(() => rowWith(conversationDatabase, "Boston, MA to Portland, ME")?.messages.some(message => message.role === "assistant")).toBe(true);
  const older = [...conversationDatabase.rows.values()][0];
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where are you trying to get to?", exact: true })).toBeVisible();
  await start(page, "New York City");
  await expect.poll(() => rowWith(conversationDatabase, "Boston, MA to New York City, NY")?.messages.some(message => message.role === "assistant")).toBe(true);
  const newer = [...conversationDatabase.rows.values()].find(row => row.id !== older.id)!;
  await history(page);
  await page.getByRole("button", { name: new RegExp(`^${older.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  await expect(page.getByRole("log")).toContainText("Boston, MA to Portland, ME");
  await expect(page.getByRole("log")).not.toContainText("Boston, MA to New York City, NY");
  await page.getByRole("button", { name: "Delete selected chat", exact: true }).click();
  await expect.poll(() => conversationDatabase.rows.has(older.id)).toBe(false);
  expect(conversationDatabase.rows.has(newer.id)).toBe(true);
  await expect(page.getByRole("button", { name: new RegExp(`^${older.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(`^${newer.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  await expect(page.getByRole("log")).toContainText("Boston, MA to New York City, NY");
});

test("a failed chat write keeps visible messages and Retry save persists them", async ({ page, conversationDatabase }) => {
  await sources(page);
  conversationDatabase.failNextWrite = true;
  await page.goto("/");
  await start(page);
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("Boston, MA to Portland, ME");
  await expect(page.getByRole("log")).toContainText("No complete ground itinerary");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect.poll(() => rowWith(conversationDatabase, "Boston, MA to Portland, ME")?.messages.some(message => message.role === "assistant")).toBe(true);
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("log")).toContainText("Boston, MA to Portland, ME");
});

test("the full archive survives the 24-message view and Show earlier messages reveals it after reload", async ({ page, conversationDatabase }) => {
  const archive = Array.from({ length: 32 }, (_, index) => `Archive message ${String(index + 1).padStart(2, "0")}`);
  const row = seed(conversationDatabase, "Long archived chat", archive);
  const requests = await sources(page);
  await page.goto("/");
  await expect(page.getByRole("log").locator(".conversation-turn")).toHaveCount(24);
  await expect(page.getByRole("log")).not.toContainText("Archive message 01");
  await page.getByRole("button", { name: "Show earlier messages", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Archive message 01");
  await expect(page.getByRole("log").locator(".conversation-turn")).toHaveCount(32);
  expect(conversationDatabase.rows.get(row.id)?.messages).toHaveLength(32);
  await page.reload();
  await page.getByRole("button", { name: "Show earlier messages", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Archive message 01");
  expect(requests).toEqual([]);
});

test("a delayed write for an older chat cannot replace the newly selected chat", async ({ page, conversationDatabase }) => {
  await sources(page);
  await page.goto("/");
  await start(page);
  await expect.poll(() => rowWith(conversationDatabase, "Boston, MA to Portland, ME")?.messages.some(message => message.role === "assistant")).toBe(true);
  const older = [...conversationDatabase.rows.values()][0];
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  let writePending = false;
  await page.route("**/rest/v1/recovery_conversations**", async route => {
    if (route.request().method() === "PATCH" && new URL(route.request().url()).searchParams.get("id") === `eq.${older.id}`) {
      writePending = true;
      await held;
    }
    await route.fallback();
  });
  await send(page, "Older chat pending write");
  await expect.poll(() => writePending).toBe(true);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await start(page, "New York City");
  release!();
  await expect.poll(() => conversationDatabase.rows.size).toBe(2);
  await expect.poll(() => rowWith(conversationDatabase, "Older chat pending write")?.id).toBe(older.id);
  await expect(page.getByRole("log")).toContainText("Boston, MA to New York City, NY");
  await expect(page.getByRole("log")).not.toContainText("Older chat pending write");
  const newer = [...conversationDatabase.rows.values()].find(row => row.id !== older.id)!;
  expect(newer.messages.some(message => message.content.includes("Older chat pending write"))).toBe(false);
});

test("another account's browser sees only its own fixture chats", async ({ browser, baseURL, conversationDatabase }) => {
  seed(conversationDatabase, "Account A private chat", ["Private account A message", "Private account A answer"]);
  seed(conversationDatabase, "Account B private chat", ["Private account B message", "Private account B answer"], AUTH_SECOND_USER_ID);
  const context = await browser.newContext({ baseURL });
  try {
    await installConversationDatabase(context, conversationDatabase);
    const second = await context.newPage();
    await interceptAuth(second, fakeSession(AUTH_SECOND_USER_ID, "second-account@example.test"));
    await second.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: AUTH_STORAGE_KEY, session: fakeSession(AUTH_SECOND_USER_ID, "second-account@example.test") });
    const requests = await sources(second);
    await second.goto("/");
    await expect(second.getByRole("log")).toContainText("Private account B message");
    await expect(second.getByRole("log")).not.toContainText("Private account A");
    await history(second);
    await expect(second.getByRole("button", { name: /^Account A private chat/ })).toHaveCount(0);
    await expect(second.getByRole("button", { name: /^Account B private chat/ })).toBeVisible();
    expect(requests).toEqual([]);
  } finally { await context.close(); }
  // This exercises account-scoped UI and mock transport only. Hosted RLS is verified separately.
  expect([...conversationDatabase.rows.values()].filter(row => row.user_id === AUTH_USER_ID)).toHaveLength(1);
});


test("Google Maps-derived assistant text is redacted in storage while the traveler's own text persists", async ({ page, conversationDatabase }) => {
  await sources(page);
  await page.route("**/functions/v1/recovery/travel", route => route.fulfill({ status: 503, json: { error: "No travel quotes in the Maps retention fixture" } }));
  await page.route("**/functions/v1/recovery/city", async route => {
    const input = route.request().postDataJSON();
    const origin = findCity(input.request.originCityId)!, destination = findCity(input.request.destinationCityId)!;
    const candidate: CityCandidate = {
      id: "maps-fixture", title: "Google Maps route fixture", kind: "transit", originCityId: origin.id, destinationCityId: destination.id,
      legs: [{ id: "maps-leg", mode: "bus", from: { name: origin.name, latitude: origin.latitude, longitude: origin.longitude },
        to: { name: destination.name, latitude: destination.latitude, longitude: destination.longitude },
        startAt: "2026-11-18T14:00:00Z", endAt: "2026-11-18T17:00:00Z", departureTimeZone: origin.timeZone, arrivalTimeZone: destination.timeZone,
        operator: "Fixture coach", service: "Fixture 1", vehicleId: "fixture-1", assumptions: [] }],
      costs: [{ label: "Checked fare", cents: 4000, currency: "USD", includedInOtherCharge: false }],
      evidence: [{ type: "estimated", provider: "Google Maps Routes API", sourceUrl: "https://routes.googleapis.com/directions/v2:computeRoutes",
        checkedAt: now, serviceDate: "2026-11-18", providerUpdatedAt: null, expiresAt: "2026-11-18T13:00:00Z", environment: "production", warnings: [] }], confirmations: [],
    };
    await route.fulfill({ json: { version: 2, result: planCityRecovery(input.request, [candidate], { origin, destination, now }),
      facts: { candidates: [candidate], checkedAt: now, expiresAt: "2026-11-18T13:00:00Z", adapterRevision: "public-city-v1" },
      assistance: { status: "completed", summary: "MAPS_ASSISTANT_SENTINEL: source-derived route description.", appliedPreferences: {}, selectedPlanId: null, activity: [] },
      ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}) } });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "From city", exact: true }).fill("Boston MA");
  await page.getByRole("option", { name: /^Boston, MA/ }).click();
  await page.getByRole("combobox", { name: "To city", exact: true }).fill("Portland ME");
  await page.getByRole("option", { name: /^Portland, ME/ }).click();
  await page.getByRole("button", { name: "Find my options", exact: true }).click();
  await expect.poll(() => [...conversationDatabase.rows.values()].some(row => row.messages.some(message => message.role === "assistant"))).toBe(true);
  await send(page, "My own Google Maps note must remain in my chat");
  await expect.poll(() => rowWith(conversationDatabase, "My own Google Maps note")?.messages.filter(message => message.role === "assistant").length ?? 0).toBeGreaterThan(1);
  const stored = rowWith(conversationDatabase, "My own Google Maps note")!;
  expect(stored.messages.filter(message => message.role === "assistant").every(message => message.content.includes("Route-specific details were not saved"))).toBe(true);
  expect(JSON.stringify(stored)).not.toContain("MAPS_ASSISTANT_SENTINEL");
  expect(JSON.stringify(stored)).not.toContain("routes.googleapis.com");
  await page.reload();
  await expect(page.getByRole("log")).toContainText("My own Google Maps note must remain in my chat");
  await expect(page.getByRole("log")).toContainText("Route-specific details were not saved");
});

test("resuming a historical Leaving now trip uses the current time only after explicit source checking", async ({ page, conversationDatabase }) => {
  const row = seed(conversationDatabase, "Earlier Leaving now chat", ["My previous trip", "Previous answer"]);
  row.trip = { ...trip, readyAt: "2026-11-17T12:55:00.000Z" };
  conversationDatabase.rows.set(row.id, row);
  const requests = await sources(page);
  let requestReadyAt: string | undefined;
  await page.route("**/functions/v1/recovery/city", async route => {
    requestReadyAt = route.request().postDataJSON().request.readyAt;
    await route.fallback();
  });
  await page.goto("/");
  await expect(page.getByText("Historical conversation", { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Check current options", exact: true }).click();
  await expect.poll(() => requestReadyAt).toBe(now);
});
