import { test, expect } from "@playwright/test";
import { daytimeFixture } from "../../supabase/functions/_shared/domain/fixtures";
import { planRecovery } from "../../supabase/functions/_shared/domain/planner";
import {
  ADAPTER_REVISION,
  RecoveryResponseSchema,
} from "../../supabase/functions/_shared/domain/api";
import type {
  ConfirmedOption,
  FlightStatusReport,
} from "../../supabase/functions/_shared/domain/schemas";
const endpoint = "**/functions/v1/recovery";
const key = "travel-recovery:selected:v1";
const flightStatus: FlightStatusReport = {
  ident: "ASA123",
  faFlightId: "fixture-opaque-flight-id",
  scheduledIn: "2026-11-18T07:50:00-05:00",
  estimatedIn: "2026-11-18T08:05:00-05:00",
  actualIn: "2026-11-18T08:06:00-05:00",
  actualOn: "2026-11-18T07:59:00-05:00",
  outcome: "gate_available",
};
function fixtureResponse(status = flightStatus) {
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
  const arrival = {
    arrivalAt: status.actualIn ?? "2026-11-18T08:00:00-05:00",
    arrivalBasis: status.actualIn
      ? ("actual_gate" as const)
      : ("estimated_gate" as const),
  };
  const request = {
    ...f.request,
    ...arrival,
    mode: "real" as const,
    flight: { ident: "ASA123", departureDate: "2026-11-18" },
    confirmedOptions: candidates,
  };
  const checkedAt = new Date().toISOString();
  return RecoveryResponseSchema.parse({
    result: {
      ...planRecovery(request, candidates, { now: checkedAt }),
      flightStatus: status,
    },
    facts: {
      candidates,
      arrival,
      arrivalEvidence:
        candidates[0].kind === "overnight"
          ? candidates[0].hotel.evidence
          : candidates[0].evidence,
      flightStatus: status,
      checkedAt,
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
      adapterRevision: ADAPTER_REVISION,
    },
  });
}
test("provider-shaped TEST FIXTURE shows separate flight times, Google attribution and transient retention through zero-POST reranking", async ({
  page,
}) => {
  let posts = 0;
  const body = fixtureResponse();
  await page.route(endpoint, async (route) => {
    posts++;
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page
    .getByLabel("Revised gate arrival", { exact: true })
    .fill("2026-11-18T08:00");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
  await page.getByLabel("Arrival time source").selectOption("flight-status");
  await page.getByLabel("Flight identifier", { exact: true }).fill("ASA123");
  await page.getByLabel("San Diego departure date").fill("2026-11-18");
  await page
    .getByRole("button", { name: "Compare recovery options", exact: true })
    .click();
  const status = page.getByTestId("flight-status");
  await expect(status).toContainText("fixture-opaque-flight-id");
  for (const label of [
    "Scheduled gate arrival",
    "Estimated gate arrival",
    "Actual gate arrival",
    "Runway arrival",
  ])
    await expect(status).toContainText(label);
  await expect(status).toContainText(flightStatus.actualIn!);
  const googleCard = page
    .getByTestId("option-card")
    .filter({ hasText: "intercity bus" });
  await expect(googleCard).toContainText("Google Maps");
  await expect(googleCard).not.toContainText("Traveler-entered sources");
  const attribution = googleCard.getByText("Google Maps", { exact: true });
  await expect(attribution).toHaveAttribute("translate", "no");
  await expect(attribution).toHaveCSS("white-space", "nowrap");
  await expect(attribution).toHaveCSS("font-weight", "400");
  await expect(attribution).toHaveCSS("font-size", "12px");
  await expect(attribution).toHaveCSS("color", "rgb(31, 31, 31)");
  await expect(
    googleCard.getByRole("link", { name: "Google Maps terms" }),
  ).toHaveAttribute("href", "https://www.google.com/help/terms_maps/");
  await page.getByRole("button", { name: "Cheapest", exact: true }).click();
  await expect(status).toContainText(flightStatus.actualIn!);
  expect(posts).toBe(1);
  await page
    .getByRole("button", {
      name: "Choose Fictional intercity train",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(page.getByTestId("saved-plan")).toBeVisible();
  const previous = await page.evaluate((key) => localStorage.getItem(key), key);
  expect(previous).not.toContain("Google Maps Routes API");
  const parsed = JSON.parse(previous!);
  expect(
    parsed.request.confirmedOptions.some(
      (c: { kind: string }) => c.kind === "bus",
    ),
  ).toBe(false);
  await page
    .getByRole("button", {
      name: "Choose Fictional intercity bus",
      exact: true,
    })
    .click();
  await expect(
    page.getByTestId("itinerary").getByText("Google Maps", { exact: true }),
  ).toHaveAttribute("translate", "no");
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Google Maps route content cannot be saved",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    previous,
  );
  await page.getByLabel("Flight identifier", { exact: true }).fill("ASA456");
  await page
    .getByRole("button", { name: "Compare recovery options", exact: true })
    .click();
  await expect.poll(() => posts).toBe(2);
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText(
    "Historical snapshot",
  );
  expect(posts).toBe(2);
});
for (const outcome of [
  "runway_only",
  "cancelled",
  "diverted",
  "position_only",
] as const) {
  test(`provider-shaped TEST FIXTURE describes ${outcome} without claiming gate arrival`, async ({
    page,
  }) => {
    const body = fixtureResponse({
      ...flightStatus,
      actualIn: null,
      estimatedIn: null,
      scheduledIn: null,
      outcome,
    });
    await page.route(endpoint, (route) => route.fulfill({ json: body }));
    await page.goto("/");
    await page
      .getByLabel("Revised gate arrival", { exact: true })
      .fill("2026-11-18T08:00");
    await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
    await page
      .getByLabel("Final destination deadline")
      .fill("2026-11-18T14:00");
    await page
      .getByRole("button", { name: "Compare recovery options", exact: true })
      .click();
    await expect(page.getByTestId("flight-status")).toContainText(
      "Gate arrival unavailable",
    );
    if (outcome === "cancelled") {
      await expect(page.getByTestId("flight-status")).toContainText(
        "FlightAware tracking is marked cancelled",
      );
      await expect(page.getByTestId("flight-status")).toContainText(
        "Confirm any airline cancellation directly with the airline",
      );
    }
  });
}
test("public terms and privacy pages explain current sharing and device retention", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Privacy", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("explicitly choose");
  await expect(page.getByRole("main")).toContainText("Google Maps");
  await page.goto("/terms");
  await expect(
    page.getByRole("heading", { name: "Terms", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("No booking");
  await expect(
    page.getByRole("link", { name: "Google Privacy Policy", exact: true }),
  ).toHaveAttribute("href", "https://policies.google.com/privacy");
});

test("provider-shaped TEST FIXTURE keeps manual arrival evidence separate from the FlightAware report", async ({
  page,
}) => {
  const body = fixtureResponse({
    ...flightStatus,
    actualIn: null,
    estimatedIn: null,
    scheduledIn: null,
    outcome: "runway_only",
  });
  body.result.request.arrivalBasis = "traveler_confirmed";
  body.facts.arrival.arrivalBasis = "traveler_confirmed";
  body.facts.arrivalEvidence = [
    {
      ...body.facts.arrivalEvidence[0],
      type: "traveler_confirmed",
      provider: "Traveler fixture arrival",
      checkedAt: "2026-10-20T01:23:45Z",
      providerUpdatedAt: null,
      expiresAt: null,
    },
  ];
  const response = RecoveryResponseSchema.parse(body);
  await page.route(endpoint, (route) => route.fulfill({ json: response }));
  await page.goto("/");
  await page
    .getByLabel("Revised gate arrival", { exact: true })
    .fill("2026-11-18T08:00");
  await page.getByLabel("Original onward departure").fill("2026-11-18T09:15");
  await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
  await page
    .getByRole("button", { name: "Compare recovery options", exact: true })
    .click();
  const report = page.getByTestId("flight-status");
  await expect(report).toContainText("fixture-opaque-flight-id");
  await expect(report).not.toContainText("Traveler fixture arrival");
  await expect(report).not.toContainText("2026-10-20T01:23:45Z");
  await expect(report).not.toContainText("checked");
  await expect(report).toContainText("FlightAware report");
  await page
    .getByRole("button", {
      name: "Choose Fictional intercity train",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("itinerary")).toContainText(
    "Traveler fixture arrival",
  );
  await expect(page.getByTestId("itinerary")).toContainText(
    "2026-10-20T01:23:45Z",
  );
});
