import { openDisclosure, demonstrate, openPreferences, openManualOptions, compare, revealPlan, reviewPlan } from "./helpers";
import { test, expect } from "@playwright/test";
test("guest compares, refines, recovers and invalidates a selection", async ({
  page,
}) => {
  await page.goto("/legacy");
  await demonstrate(page, "Daytime fictional example");
  await expect(page.getByTestId("provenance-banner")).toContainText(
    "Synthetic / fictional",
  );
  await expect(page.getByTestId("option-card").first()).toContainText(
    "rental car",
  );
  await reviewPlan(page, "View Fictional one-way rental car");
  const carHandoff = page.locator(
    'a[href="https://www.kayak.com/Boston-Logan-Intl-Airport-Car-Rentals.BOS.cap.ksp"]',
  );
  await expect(carHandoff).toBeVisible();
  await expect(page.getByTestId("itinerary")).toContainText(
    "One-way rental: Boston Logan (BOS) pickup → Portland, Maine return",
  );
  await expect(page.getByTestId("itinerary")).toContainText("return window");
  await expect(page.getByTestId("itinerary")).toContainText(
    "This fictional itinerary is an example only",
  );
  await expect(page.getByTestId("itinerary")).toContainText(
    "Not booked or saved",
  );
  await openDisclosure(page, "Original connection assessment");
  await expect(
    page.getByText("15 minutes short", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await expect(page.getByTestId("option-card").first()).toContainText(
    "intercity bus",
  );
  await page.getByRole("button", { name: "No driving", exact: true }).click();
  await expect(page.getByTestId("option-card")).toHaveCount(2);
  await openPreferences(page);
  await page.getByLabel("Budget (USD)").fill("10");
  await page.getByLabel("Budget limit").selectOption("hard");
  await compare(page);
  await expect(
    page.getByRole("heading", { name: "No feasible plan" }),
  ).toBeVisible();
  await expect(
    page.getByText("Known journey charges exceed the hard budget.").first(),
  ).toBeVisible();
  await openPreferences(page);
  await page.getByLabel("Budget (USD)").fill("150");
  await compare(page);
  await reviewPlan(page, "View Fictional intercity bus");
  await expect(page.getByTestId("itinerary")).toContainText(
    "Selected for review",
  );
  await expect(page.getByTestId("itinerary")).toContainText(
    "Not booked or saved",
  );
  const busHandoff = page.locator(
    'a[href="https://concordcoachlines.com/book-your-trip/"]',
  );
  await expect(busHandoff).toBeVisible();
  await expect(busHandoff).toHaveAttribute("target", "_blank");
  await expect(busHandoff).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByTestId("itinerary")).not.toContainText(
    "Open Boston Logan to Portland, Maine corridor directions",
  );
  await openPreferences(page);
  await page.getByLabel("Budget (USD)").fill("140");
  await expect(page.getByTestId("itinerary")).toContainText(
    "No itinerary selected",
  );
  await demonstrate(page, "Use my own trip");
  await expect(page.getByRole("region", { name: "Start your recovery", exact: true })).toBeVisible();
  await expect(page.getByTestId("option-card")).toHaveCount(0);
});
test("overnight example shows the actual selected hotel metadata", async ({
  page,
}) => {
  await page.goto("/legacy");
  await demonstrate(page, "Overnight fictional example");
  await reviewPlan(page, "View Fictional overnight hotel and morning bus");
  await expect(page.getByTestId("itinerary")).toContainText(
    "Fictional standard queen room",
  );
  await expect(page.getByTestId("itinerary")).toContainText("Late check-in");
  await expect(page.getByTestId("itinerary")).toContainText(
    "Fictional airport-area address, Boston, MA",
  );
  await expect(
    page.locator('a[href="https://www.google.com/travel/hotels"]'),
  ).toBeVisible();
});
test("a traveler-entered bus uses actual inputs and retains them on invalid dates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/legacy");
  await openManualOptions(page);
  await page.getByLabel("Revised gate arrival").fill("2026-11-18T08:00:30");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
  await page.getByText("Add a confirmed train or bus", { exact: true }).click();
  await page.getByLabel("Include this transit option").check();
  await page.getByLabel("Operator / service name").fill("My confirmed bus");
  await page
    .getByLabel("Transit departure", { exact: true })
    .fill("2026-11-18T10:00");
  await page
    .getByLabel("Transit arrival", { exact: true })
    .fill("2026-11-18T12:00");
  await page.getByLabel("Departure terminal").fill("Boston bus terminal");
  await page.getByLabel("Arrival terminal").fill("Portland bus terminal");
  await page.getByLabel("Access minutes", { exact: true }).fill("15");
  await page.getByLabel("Final transfer minutes").fill("20");
  await page.getByLabel("Fare (USD)").fill("35");
  await page.getByLabel("Access cost (USD)").fill("0");
  await page.getByLabel("Final transfer cost (USD)").fill("12");
  const comparisonRequest = page.waitForRequest(request =>
    request.url().includes("/functions/v1/recovery") && request.method() === "POST",
  );
  await compare(page);
  expect((await comparisonRequest).postDataJSON().investigate).toBe(true);
  const manualCard = page.getByTestId("option-card").filter({
    has: page.getByRole("heading", { name: "My confirmed bus", exact: true, includeHidden: true }),
  });
  await expect(manualCard).toContainText("$47.00");
  await (await revealPlan(page, "View My confirmed bus")).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("itinerary")).toContainText(
    "Traveler confirmed",
  );
  await expect(page.getByTestId("itinerary")).toContainText("259.5 minutes");
  await openManualOptions(page);
  await page.getByLabel("Revised gate arrival").fill("2026-11-01T01:30");
  await compare(page);
  await expect(page.getByText(/ambiguous or nonexistent/)).toBeVisible();
  await expect(page.getByLabel("Operator / service name")).toHaveValue(
    "My confirmed bus",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

for (const width of [390, 320]) {
  test(`overnight plan selection fits a ${width}px viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/legacy");
    await demonstrate(page, "Overnight fictional example");
    const choose = await revealPlan(page, "View Fictional overnight hotel and morning bus");
    await expect(choose).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await choose.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("itinerary")).toContainText(
      "Fictional standard queen room",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("unexpected planner failures hide validation internals and retain entered trip facts", async ({
  page,
}) => {
  await page.route("**/functions/v1/recovery", route => route.fulfill({
    status: 500,
    json: { error: 'ZodError originalConnection too_big "code"' },
  }));
  await page.goto("/legacy");
  await openManualOptions(page);
  await page.getByLabel("Revised gate arrival").fill("2026-11-18T08:00");
  await page.getByLabel("Original onward departure").fill("2025-01-01T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
  await compare(page);
  await expect(page.getByRole("alert")).toContainText(
    "Your inputs are retained",
  );
  await expect(page.getByRole("alert")).not.toContainText(
    /originalConnection|too_big|ZodError|"code"/,
  );
  await expect(page.getByLabel("Original onward departure")).toHaveValue(
    "2025-01-01T09:15",
  );
  await expect(
    page.getByRole("button", { name: "Save on this device", exact: true }),
  ).toBeDisabled();
});
