import { test, expect, type Page } from "@playwright/test";
import { overnightFixture } from "../../supabase/functions/_shared/domain/fixtures";
import { planRecovery } from "../../supabase/functions/_shared/domain/planner";
import {
  ADAPTER_REVISION,
  RecoveryResponseSchema,
} from "../../supabase/functions/_shared/domain/api";
const key = "travel-recovery:selected:v1";
async function chooseHotel(page: Page) {
  await page
    .getByRole("button", { name: "Overnight fictional example", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Choose Fictional overnight hotel and morning bus",
      exact: true,
    })
    .click();
}
test("saves full itinerary locally, restores historical details without network and deletes explicitly", async ({
  page,
}) => {
  await page.goto("/");
  await chooseHotel(page);
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(
    page.getByText(
      "Saved on this device. No tickets or reservations have been purchased.",
      { exact: true },
    ),
  ).toBeVisible();
  const saved = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    key,
  );
  expect(saved.plan.hotel.room).toBe("Fictional standard queen room");
  expect(Date.now() - Date.parse(saved.selectedAt)).toBeLessThan(10_000);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (["fetch", "xhr"].includes(request.resourceType()))
      requests.push(request.url());
  });
  await page.reload();
  const historical = page.getByTestId("saved-plan");
  await expect(historical).toContainText("Historical snapshot");
  await expect(historical).toContainText("Fictional standard queen room");
  await expect(historical).toContainText(saved.plan.hotel.board);
  await expect(historical).toContainText(
    `${saved.plan.hotel.checkin} to ${saved.plan.hotel.checkout}`,
  );
  await expect(historical).toContainText("1 adult · 1 room");
  await expect(historical).toContainText(
    saved.plan.hotel.cancellation?.text ?? "Cancellation terms unconfirmed.",
  );
  await expect(historical).toContainText(saved.generatedAt);
  await expect(historical).toContainText(saved.selectedAt);
  await expect(historical).toContainText(
    saved.plan.hotel.evidence[0].checkedAt,
  );
  await expect(page.getByTestId("option-card")).toHaveCount(0);
  await expect(page.getByTestId("itinerary")).toContainText(
    "No itinerary selected",
  );
  expect(requests).toEqual([]);
  await expect(page.getByRole("button", { name: /sign in/i })).toHaveCount(0);
  await historical
    .getByRole("button", { name: "Delete saved plan", exact: true })
    .click();
  await expect(page.getByTestId("saved-plan")).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toHaveCount(0);
});
test("editing clears the current saved badge but retains history; refresh starts a new comparison", async ({
  page,
}) => {
  await page.goto("/");
  await chooseHotel(page);
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const before = await page.evaluate((k) => localStorage.getItem(k), key);
  await expect(page.getByTestId("itinerary")).toContainText(
    "Saved on this device",
  );
  await page.getByLabel("Budget (USD)").fill("300");
  await expect(page.getByTestId("itinerary")).toContainText(
    "No itinerary selected",
  );
  await expect(
    page.getByRole("button", { name: "Save on this device", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("saved-plan")).toContainText(
    "Historical snapshot",
  );
  await page
    .getByRole("button", { name: "Refresh this plan", exact: true })
    .click();
  await expect(page.getByTestId("option-card")).toHaveCount(2);
  await expect(page.getByTestId("itinerary")).toContainText(
    "No itinerary selected",
  );
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(before);
});
for (const raw of [
  "{invalid",
  JSON.stringify({ schemaVersion: 2, futurePayload: "retain" }),
]) {
  test(`invalid or future saved data requires deletion before replacement: ${raw}`, async ({
    page,
  }) => {
    await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
      key,
      raw,
    });
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(/delete.*retry/i);
    await chooseHotel(page);
    await page
      .getByRole("button", { name: "Save on this device", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(/delete.*retry/i);
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(raw);
    await expect(
      page.getByText(
        "Saved on this device. No tickets or reservations have been purchased.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Delete saved plan", exact: true })
      .click();
    await expect(
      page.getByText("Saved plan deleted from this device.", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
    await page
      .getByRole("button", { name: "Save on this device", exact: true })
      .click();
    await expect(
      page.getByText(
        "Saved on this device. No tickets or reservations have been purchased.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByTestId("saved-plan")).toContainText(
      "Fictional standard queen room",
    );
  });
}
test("storage getter and write/remove failures are useful and preserve the current trip", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(/storage/i);
  await chooseHotel(page);
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/storage/i);
  await expect(
    page.getByText(
      "Saved on this device. No tickets or reservations have been purchased.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(page.getByTestId("itinerary")).toContainText(
    "Fictional standard queen room",
  );
  await page
    .getByRole("button", { name: "Delete saved plan", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/delete/i);
  await expect(
    page.getByText("Saved plan deleted from this device.", { exact: true }),
  ).toHaveCount(0);
});
test("quota and removal failure do not replace or discard the previous saved record", async ({
  page,
}) => {
  await page.goto("/");
  await chooseHotel(page);
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const before = await page.evaluate((k) => localStorage.getItem(k), key);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    Storage.prototype.removeItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
  });
  await page
    .getByRole("button", { name: "Daytime fictional example", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Choose Fictional intercity bus",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/save.*storage/i);
  await expect(page.getByTestId("itinerary")).toContainText(
    "Not booked or saved",
  );
  await page
    .getByRole("button", { name: "Delete saved plan", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/delete/i);
  await expect(page.getByTestId("saved-plan")).toContainText(
    "Fictional standard queen room",
  );
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(before);
});

test("expired history and unknown costs remain readable on a narrow device without becoming a current choice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await chooseHotel(page);
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await page.evaluate((k) => {
    const value = JSON.parse(localStorage.getItem(k)!);
    value.plan.evidenceExpiresAt = "2020-01-01T00:00:00Z";
    value.plan.priceComplete = false;
    value.plan.legs[0].costs.push({
      label: "Unknown historical fee",
      cents: null,
      currency: "USD",
      includedInOtherCharge: false,
    });
    value.plan.hotel.cancellation = {
      text: "Original cancellation terms",
      deadlineAt: "2026-11-18T18:00:00-05:00",
      penalty: "Original penalty",
    };
    localStorage.setItem(k, JSON.stringify(value));
  }, key);
  await page.reload();
  const history = page.getByTestId("saved-plan");
  await expect(history).toContainText("Evidence expired");
  await expect(history).toContainText("Unknown historical fee: unknown");
  await expect(history).toContainText("Original cancellation terms");
  await expect(history).toContainText("Original penalty");
  await expect(page.getByTestId("option-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save on this device", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

// This response fixture represents a validated API-created hotel absent from user input;
// it is not evidence that a production provider is enabled.
test("API-created hotel absent from original input saves and restores every detail without refetch", async ({
  page,
}) => {
  const f = overnightFixture();
  const checkedAt = new Date().toISOString();
  const convert = (value: any): any =>
    Array.isArray(value)
      ? value.map(convert)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([name, item]) => [
              name,
              name === "type" && item === "synthetic"
                ? "live"
                : name === "environment" && item === "synthetic"
                  ? "production"
                  : convert(item),
            ]),
          )
        : value;
  const candidates = convert(f.candidates);
  candidates.find(
    (candidate: any) => candidate.kind === "overnight",
  ).hotel.cancellation = {
    text: "Refundable until the stated deadline",
    deadlineAt: "2026-11-18T18:00:00-05:00",
    penalty: "One room night after deadline",
  };
  const request = {
    ...f.request,
    mode: "real" as const,
    confirmedOptions: candidates,
  };
  const result = planRecovery(request, candidates, { now: checkedAt });
  const body = RecoveryResponseSchema.parse({
    result,
    facts: {
      candidates,
      arrival: {
        arrivalAt: request.arrivalAt,
        arrivalBasis: request.arrivalBasis,
      },
      arrivalEvidence: result.plans.find((p) => p.hotel)!.hotel!.evidence,
      checkedAt,
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
      adapterRevision: ADAPTER_REVISION,
    },
  });
  let posts = 0;
  let submitted: any;
  await page.route("**/functions/v1/recovery", async (route) => {
    posts++;
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByLabel("Revised gate arrival").fill("2026-11-18T08:00");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-19T14:00");
  await page
    .getByRole("button", { name: "Compare recovery options", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Choose Fictional overnight hotel and morning bus",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  expect(submitted.request.confirmedOptions).toEqual([]);
  const stored = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!),
    key,
  );
  expect(stored.plan.hotel).toEqual(
    body.result.plans.find((p) => p.hotel)!.hotel,
  );
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText(
    stored.plan.hotel.room,
  );
  await expect(page.getByTestId("saved-plan")).toContainText(
    stored.plan.hotel.cancellation.text,
  );
  expect(
    await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k)!).plan.hotel,
      key,
    ),
  ).toEqual(stored.plan.hotel);
  expect(posts).toBe(1);
});

test("refreshed manual trip retains editable inputs and priority reranks without another request", async ({
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
  await page.goto("/");
  const configured = !(
    await page.getByTestId("provenance-banner").textContent()
  )?.includes("compared locally");
  await page.getByLabel("Revised gate arrival").fill("2026-11-18T08:00");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
  await page.getByText("Add a confirmed train or bus", { exact: true }).click();
  await page.getByLabel("Include this transit option").check();
  for (const [label, value] of [
    ["Operator / service name", "Refresh manual bus"],
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
  await page
    .getByRole("button", { name: "Compare recovery options", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose Refresh manual bus", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const saved = await page.evaluate((k) => localStorage.getItem(k), key);
  const refreshResponse = configured
    ? page.waitForResponse(
        (response) =>
          response.url().includes("/functions/v1/recovery") &&
          response.request().method() === "POST" &&
          response.request().postDataJSON().investigate === true,
      )
    : null;
  await page
    .getByRole("button", { name: "Refresh this plan", exact: true })
    .click();
  let expectedCards = 1;
  if (refreshResponse) {
    const response = await refreshResponse;
    expect(response.ok()).toBe(true);
    const refreshed = RecoveryResponseSchema.parse(await response.json());
    await response.finished();
    expectedCards = refreshed.result.plans.length;
    expect(expectedCards).toBeGreaterThanOrEqual(1);
    expect(refreshed.facts.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "manual-transit", title: "Refresh manual bus" }),
      ]),
    );
  }
  await expect(
    page.getByRole("button", { name: "Compare recovery options", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("option-card")).toHaveCount(expectedCards);
  await expect(page.getByLabel("Operator / service name")).toHaveValue(
    "Refresh manual bus",
  );
  const count = posts.length;
  await page.getByRole("button", { name: "Cheapest", exact: true }).click();
  await expect(page.getByTestId("option-card")).toHaveCount(expectedCards);
  await page
    .getByRole("button", { name: "Choose Refresh manual bus", exact: true })
    .click();
  expect(posts).toHaveLength(count);
  expect(posts).toHaveLength(configured ? 2 : 0);
  if (configured)
    expect(posts.map((post) => post.request.confirmedOptions.length)).toEqual([
      1, 1,
    ]);
  else
    await expect(page.getByTestId("saved-plan")).toContainText(
      "new local comparison",
    );
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(saved);
});
