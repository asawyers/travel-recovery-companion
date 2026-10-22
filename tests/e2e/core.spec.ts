import { demonstrate, openPreferences, openManualOptions, compare, echoConversation, reviewPlan } from "./helpers";
import { test, expect, AUTH_ACCESS_TOKEN, RECOVERY_HTTP_URL, type Page } from "./auth-fixture";
import { daytimeFixture } from "../../supabase/functions/_shared/domain/fixtures";
import { planRecovery } from "../../supabase/functions/_shared/domain/planner";
import {
  ADAPTER_REVISION,
  RecoveryResponseSchema,
} from "../../supabase/functions/_shared/domain/api";
const endpoint = "**/functions/v1/recovery";

async function daytime(page: Page) {
  await demonstrate(page, "Daytime fictional example");
  await expect(page.getByTestId("option-card")).toHaveCount(3);
}
test("real public HTTP compares, refines constraints, saves, restores without HTTP and deletes", async ({
  page,
}) => {
  const posts: { headers: Record<string, string>; body: any }[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/functions/v1/recovery") &&
      request.method() === "POST"
    )
      posts.push({ headers: request.headers(), body: request.postDataJSON() });
  });
  await page.goto("/legacy");
  const initialResponse = page.waitForResponse(
    response => new URL(response.url()).pathname === "/functions/v1/recovery" && response.request().method() === "POST",
    { timeout: 35_000 },
  );
  await demonstrate(page, "Daytime fictional example");
  const response = await initialResponse;
  expect(response.status()).toBe(200);
  await response.finished();
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  expect(posts).toHaveLength(1);
  expect(posts[0].body.investigate).toBe(false);
  expect(posts[0].headers.authorization).toBe(`Bearer ${AUTH_ACCESS_TOKEN}`);
  expect(posts[0].headers.apikey).toBeUndefined();
  expect(posts[0].headers.cookie).toBeUndefined();
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await expect(page.getByTestId("option-card").first()).toContainText(
    "intercity bus",
  );
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "No driving", exact: true }).click();
  await expect(page.getByTestId("option-card")).toHaveCount(2);
  expect(posts).toHaveLength(2);
  await reviewPlan(page, "View Fictional intercity bus");
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(page.getByTestId("saved-plan")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText(
    "Historical snapshot",
  );
  expect(posts).toHaveLength(2);
  await page
    .getByRole("button", { name: "Delete saved plan", exact: true })
    .click();
  await expect(page.getByTestId("saved-plan")).toHaveCount(0);
});
test("network failure retains inputs and makes the previous choice stale; explicit investigation is honest", async ({
  page,
}) => {
  await page.goto("/legacy");
  await daytime(page);
  await reviewPlan(page, "View Fictional intercity bus");
  await page.route(endpoint, (route) => route.abort("failed"));
  await openPreferences(page);
  await page.getByLabel("Budget (USD)").fill("133");
  await compare(page);
  await expect(page.getByRole("alert")).toContainText(/connection.*retained/i);
  await expect(page.getByLabel("Budget (USD)")).toHaveValue("133");
  await expect(
    page.getByRole("button", { name: "Save on this device", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "View Fictional intercity bus",
      exact: true,
    }),
  ).toBeDisabled();
  await page.unroute(endpoint);
  const recovered = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/functions/v1/recovery" &&
    response.request().method() === "POST" &&
    response.request().postDataJSON().investigate === true,
  );
  await page.getByRole("button", { name: "Recheck available sources", exact: true }).click();
  await (await recovered).finished();
  await expect(page.getByRole("button", { name: "Recheck available sources", exact: true })).toBeEnabled();
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  await expect(
    page.getByText(/No live.*checked|unavailable|disabled/).first(),
  ).toBeVisible();
});
for (const outcome of ["result", "failure"]) {
  test(`late HTTP ${outcome} and cache are ignored even when transport ignores abort`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = window.fetch;
      (window as any).__completedComparisons = 0;
      window.fetch = async (input, init) => {
        const response = await original(input, { ...init, signal: undefined });
        if (String(input).includes("/functions/v1/recovery"))
          (window as any).__completedComparisons++;
        return response;
      };
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let count = 0;
    await page.route(endpoint, async (route) => {
      const ordinal = ++count;
      const response = await route.fetch({ url: RECOVERY_HTTP_URL });
      if (ordinal === 1) await held;
      if (ordinal === 1 && outcome === "failure")
        await route.fulfill({
          status: 503,
          json: { error: "Obsolete failure" },
        });
      else await route.fulfill({ response });
    });
    await page.goto("/legacy");
    await demonstrate(page, "Daytime fictional example");
    await expect.poll(() => count).toBe(1);
    await openPreferences(page);
    await page.getByLabel("Budget (USD)").fill("1");
    await page.getByLabel("Budget limit").selectOption("hard");
    await compare(page);
    await expect(
      page.getByRole("heading", { name: "No feasible plan" }),
    ).toBeVisible();
    release();
    await expect
      .poll(() => page.evaluate(() => (window as any).__completedComparisons))
      .toBe(2);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByTestId("option-card")).toHaveCount(0);
    await page.getByRole("button", { name: "Cheaper", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No feasible plan" }),
    ).toBeVisible();
    expect(count).toBe(2);
  });
}
test("validated provider-shaped TEST FIXTURE retains traveler arrival and source timestamps on zero-call priority reranking", async ({
  page,
}) => {
  let posts = 0;
  let providerCalls = 0;
  const sourceOrModelCalls: string[] = [];
  page.on("request", (request) => {
    if (
      ["fetch", "xhr"].includes(request.resourceType()) &&
      !request.url().includes("/functions/v1/recovery")
    )
      sourceOrModelCalls.push(request.url());
  });
  const f = daytimeFixture();
  const convert = (value: any): any =>
    Array.isArray(value)
      ? value.map(convert)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              key === "type" && item === "synthetic"
                ? "live"
                : key === "environment" && item === "synthetic"
                  ? "production"
                  : key === "providerUpdatedAt"
                    ? "2026-11-18T07:40:00-05:00"
                    : convert(item),
            ]),
          )
        : value;
  const candidates = convert(f.candidates);
  const arrival = {
    arrivalAt: "2026-11-18T08:05:00-05:00",
    arrivalBasis: "traveler_confirmed" as const,
  };
  const request = {
    ...f.request,
    ...arrival,
    mode: "real" as const,
    confirmedOptions: candidates,
  };
  const checkedAt = new Date().toISOString();
  const body = RecoveryResponseSchema.parse({
    result: planRecovery(request, candidates, { now: checkedAt }),
    facts: {
      candidates,
      arrival,
      arrivalEvidence: candidates[0].evidence,
      checkedAt,
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
      adapterRevision: ADAPTER_REVISION,
    },
  });
  await page.route(endpoint, async (route) => {
    posts++;
    // The injected adapter fixture is collected exactly once at this boundary.
    providerCalls++;
    await route.fulfill({ json: echoConversation(route, body) });
  });
  await page.goto("/legacy");
  await openManualOptions(page);
  await page.getByLabel("Revised gate arrival").fill("2026-11-18T08:05");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
  await compare(page);
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await expect(page.getByTestId("option-card").first()).toContainText(
    "intercity bus",
  );
  await reviewPlan(page, "View Fictional intercity bus");
  await expect(page.getByTestId("itinerary")).toContainText("8:05");
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("travel-recovery:selected:v1:account:11111111-1111-4111-8111-111111111111")!),
  );
  expect(saved.request.arrivalAt).toBe(arrival.arrivalAt);
  expect(saved.request.arrivalBasis).toBe("traveler_confirmed");
  expect(saved.request.flight).toBeNull();
  expect(saved.request.confirmedOptions).toEqual(candidates);
  expect(posts).toBe(1);
  expect(providerCalls).toBe(1);
  expect(sourceOrModelCalls).toHaveLength(0);
});
test("cache expires by real wall clock and reset never reuses facts", async ({
  page,
}) => {
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/functions/v1/recovery") &&
      request.method() === "POST"
    )
      posts++;
  });
  await page.clock.install();
  await page.goto("/legacy");
  await daytime(page);
  await reviewPlan(page, "View Fictional intercity bus");
  await page.clock.fastForward(301_000);
  await expect(
    page.getByRole("button", { name: "Save on this device", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("itinerary")).toContainText(
    "No itinerary selected",
  );
  await expect(page.getByRole("alert")).toContainText("Source checks expired");
  await expect(page.getByRole("alert")).not.toContainText(
    "Device storage unavailable",
  );
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await expect.poll(() => posts).toBe(2);
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  await demonstrate(page, "Use my own trip");
  await daytime(page);
  expect(posts).toBe(3);
});

test("manual confirmation timestamps survive priority-only input edits without another POST", async ({
  page,
}) => {
  const posts: any[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/functions/v1/recovery") &&
      request.method() === "POST"
    )
      posts.push(request.postDataJSON());
  });
  await page.clock.install();
  await page.goto("/legacy");
  await openManualOptions(page);
  await page.getByLabel("Revised gate arrival").fill("2026-11-18T08:00");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
  await page.getByText("Add a confirmed train or bus", { exact: true }).click();
  await page.getByLabel("Include this transit option").check();
  for (const [label, value] of [
    ["Operator / service name", "Manual priority test"],
    ["Transit departure", "2026-11-18T10:00"],
    ["Transit arrival", "2026-11-18T12:00"],
    ["Departure terminal", "Boston terminal"],
    ["Arrival terminal", "Portland terminal"],
    ["Access minutes", "15"],
    ["Final transfer minutes", "20"],
    ["Fare (USD)", "35"],
    ["Access cost (USD)", "0"],
    ["Final transfer cost (USD)", "0"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await compare(page);
  const manualCard = page.getByTestId("option-card").filter({
    has: page.getByRole("heading", { name: "Manual priority test", exact: true, includeHidden: true }),
  });
  await expect(manualCard).toHaveCount(1);
  expect(posts[0].investigate).toBe(true);
  await page.clock.fastForward(2_000);
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await reviewPlan(page, "View Manual priority test");
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("travel-recovery:selected:v1:account:11111111-1111-4111-8111-111111111111")!),
  );
  expect(saved.request.confirmedOptions[0].evidence[0].checkedAt).toBe(
    posts[0].request.confirmedOptions[0].evidence[0].checkedAt,
  );
  expect(posts).toHaveLength(1);
});

test("explicit recheck investigates once and a priority quick reply reuses the checked facts", async ({
  page,
}) => {
  const posts: any[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/functions/v1/recovery") &&
      request.method() === "POST"
    )
      posts.push(request.postDataJSON());
  });
  await page.goto("/legacy");
  await daytime(page);
  const investigationResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/functions/v1/recovery") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON().investigate === true,
  );
  await page.getByRole("button", { name: "Recheck available sources", exact: true }).click();
  const response = await investigationResponse;
  expect(response.ok()).toBe(true);
  await response.finished();
  // Previous cards remain visible while the new source facts are being checked.
  await expect(
    page.getByRole("button", { name: "Recheck available sources", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  expect(posts[1].investigate).toBe(true);
  await expect(page.getByLabel("Investigate available sources")).toHaveCount(0);
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await expect(page.getByTestId("option-card").first()).toContainText(
    "intercity bus",
  );
  expect(posts).toHaveLength(2);
  await openPreferences(page);
  await page.getByLabel("Priority", { exact: true }).selectOption("earliest");
  const updated = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/functions/v1/recovery" &&
    response.request().method() === "POST" &&
    response.request().postDataJSON().investigate === true,
  );
  await page.getByRole("button", { name: "Update options", exact: true }).click();
  await (await updated).finished();
  await expect(page.getByRole("button", { name: "Update options", exact: true })).toBeEnabled();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2].investigate).toBe(true);
});
test("configured saved-plan refresh explicitly investigates", async ({
  page,
}) => {
  const posts: any[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/functions/v1/recovery") &&
      request.method() === "POST"
    )
      posts.push(request.postDataJSON());
  });
  await page.goto("/legacy");
  await daytime(page);
  await reviewPlan(page, "View Fictional intercity bus");
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const refreshed = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/functions/v1/recovery" &&
    response.request().method() === "POST" &&
    response.request().postDataJSON().investigate === true,
  );
  await page
    .getByRole("button", { name: "Refresh this plan", exact: true })
    .click();
  await (await refreshed).finished();
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  expect(posts.map((post) => post.investigate)).toEqual([false, true]);
});
test("configured saved-plan wording describes public investigation without promising live results", async ({
  page,
}) => {
  await page.goto("/legacy");
  await daytime(page);
  await reviewPlan(page, "View Fictional intercity bus");
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(page.getByTestId("saved-plan")).toContainText(
    "Refresh asks the public planner",
  );
  await expect(page.getByTestId("saved-plan")).toContainText(
    "may be unavailable",
  );
  await expect(page.getByTestId("saved-plan")).not.toContainText(
    "new local comparison",
  );
});
