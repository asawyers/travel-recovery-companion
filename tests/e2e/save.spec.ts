import { test, expect, type Page } from "@playwright/test";
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
test("invalid saved data stays stored until explicitly deleted", async ({
  page,
}) => {
  await page.addInitScript((k) => localStorage.setItem(k, "{invalid"), key);
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(/delete.*retry/i);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(
    "{invalid",
  );
  await page
    .getByRole("button", { name: "Delete saved plan", exact: true })
    .click();
  await expect(
    page.getByText("Saved plan deleted from this device.", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
});
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
