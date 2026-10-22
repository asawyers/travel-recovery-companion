import { expect, type Page, test } from "@playwright/test";
import { travelFixture } from "../../supabase/functions/_shared/domain/travel-fixtures";
import {
  flightOfferFingerprint,
  flightOfferId,
  hotelOfferFingerprint,
  hotelOfferId,
  type TravelRecoveryInput,
  TravelRecoveryResponseSchema,
  travelRequestBinding,
} from "../../supabase/functions/_shared/domain/travel-contracts";
import { assessTravelSelection } from "../../supabase/functions/_shared/domain/travel-planner";
import { findCity } from "../../supabase/functions/_shared/domain/city-catalog";
import { planCityRecovery } from "../../supabase/functions/_shared/domain/city-planner";
const now = "2026-11-18T14:00:00Z",
  expiry = "2026-11-18T14:05:00Z",
  key = "travel-recovery:selected:v1";
function quotes(input: TravelRecoveryInput, changed = false) {
  const f = travelFixture(),
    connecting = structuredClone(f.flight);
  connecting.departureDate = input.departureDate;
  connecting.handoffUrl = "https://www.google.com/travel/flights?q=SAN";
  for (const segment of connecting.segments) {
    segment.departureAt = segment.departureAt.replace(
      "2026-11-19",
      input.departureDate,
    );
    segment.arrivalAt = segment.arrivalAt.replace(
      "2026-11-19",
      input.departureDate,
    );
  }
  connecting.id = flightOfferId(connecting);
  connecting.fingerprint = flightOfferFingerprint(connecting);
  const direct = structuredClone(connecting);
  direct.segments = [
    {
      ...direct.segments[0],
      id: "direct",
      boardingId: "direct-flight",
      destinationAirport: f.flight.segments[1].destinationAirport,
      arrivalAt: `${input.departureDate}T17:00:00-05:00`,
      durationMinutes: 300,
      flightNumber: "DIRECT1",
    },
  ];
  if (changed) direct.costs[0].cents = 99999;
  direct.id = flightOfferId(direct);
  direct.fingerprint = flightOfferFingerprint(direct);
  const hotel = structuredClone(f.hotel);
  if (input.overnight) {
    hotel.checkin = input.overnight.checkin;
    hotel.checkout = input.overnight.checkout;
    hotel.id = hotelOfferId(hotel);
    hotel.fingerprint = hotelOfferFingerprint(hotel);
  }
  return {
    flightOffers: [direct, connecting],
    hotelOffers: input.overnight ? [hotel] : [],
  };
}
async function setup(
  page: Page,
  options: {
    changed?: boolean;
    unavailable?: boolean;
    groundDown?: boolean;
    initialTravelDown?: boolean;
    refreshDown?: boolean;
    installClock?: boolean;
    cityPatch?: boolean;
    travelPatch?: boolean;
    recommendConfirmed?: boolean;
  } = {},
) {
  const posts: TravelRecoveryInput[] = [],
    ground: unknown[] = [];
  if (options.installClock) await page.clock.install({ time: new Date(now) });
  else await page.clock.setFixedTime(new Date(now));
  await page.route("**/functions/v1/recovery/city", async (route) => {
    const input = route.request().postDataJSON();
    ground.push(input);
    if (options.groundDown) {
      await route.fulfill({
        status: 503,
        json: { error: "Unavailable fixture" },
      });
      return;
    }
    const origin = findCity(input.request.originCityId)!,
      destination = findCity(input.request.destinationCityId)!;
    const patch =
      options.cityPatch && input.refinement
        ? { priority: "cheapest" as const, drivingAllowed: true }
        : {};
    await route.fulfill({
      json: {
        version: 2,
        ...(input.conversation
          ? {
              conversation: {
                turnId: input.conversation.turnId,
                baseRevision: input.conversation.baseRevision,
              },
            }
          : {}),
        ...(Object.keys(patch).length
          ? {
              assistance: {
                status: "completed",
                summary: "Using your requested lower-price priority.",
                appliedPreferences: patch,
                selectedPlanId: null,
                activity: [],
              },
            }
          : {}),
        result: planCityRecovery({ ...input.request, ...patch }, [], {
          origin,
          destination,
          now,
        }),
        facts: {
          candidates: [],
          checkedAt: now,
          expiresAt: expiry,
          adapterRevision: "public-city-v1",
        },
      },
    });
  });
  await page.route("**/functions/v1/recovery/travel", async (route) => {
    const input = route.request().postDataJSON() as TravelRecoveryInput;
    // This suite exercises the primary SAN–PWM flow. The automatic alternate
    // search receives an honest empty response and is tested in nearby-airport.spec.
    if (input.originAirportIata !== "SAN" || input.destinationAirportIata !== "PWM") {
      const origin = findCity(input.trip.originCityId)!, destination = findCity(input.trip.destinationCityId)!;
      await route.fulfill({ json: TravelRecoveryResponseSchema.parse({
        version: 3, request: travelRequestBinding(input), origin, destination,
        generatedAt: now, expiresAt: expiry, flightOffers: [], hotelOffers: [], journey: null, selectionIssue: null,
        sourceStatuses: [{ source: "flights", status: "empty", message: "No quotes from this airport pair in the scoped fixture.", checkedAt: now, expiresAt: expiry }],
        warnings: ["Deterministic empty alternate response; no live inventory requested."],
        ...(input.conversation ? { conversation: { turnId: input.conversation.turnId, baseRevision: input.conversation.baseRevision } } : {}),
      }) });
      return;
    }

    posts.push(input);
    if ((options.initialTravelDown && posts.length === 1) || (options.refreshDown && posts.length > 1)) {
      await route.fulfill({
        status: 503,
        json: { error: "Travel source unavailable fixture" },
      });
      return;
    }
    const f = travelFixture(),
      offers = options.unavailable
        ? { flightOffers: [], hotelOffers: [] }
        : quotes(input, !!options.changed && posts.length > 1);
    const assessment = assessTravelSelection(input, {
      ...offers,
      origin: f.origin,
      destination: f.destination,
      now,
    });
    const patchTravel =
      options.travelPatch && input.refinement?.includes("cheapest");
    const response = TravelRecoveryResponseSchema.parse({
      version: 3,
      request: {
        ...travelRequestBinding(input),
        trip: {
          ...input.trip,
          ...(patchTravel ? { priority: "cheapest", drivingAllowed: true } : {}),
        },
      },
      origin: f.origin,
      destination: f.destination,
      generatedAt: now,
      expiresAt: expiry,
      ...offers,
      ...assessment,
      sourceStatuses: [
        {
          source: "flights",
          status: options.unavailable ? "unavailable" : "available",
          message: options.unavailable
            ? "Flight source unavailable in this fixture."
            : "Fixture flight quotes checked.",
          checkedAt: now,
          expiresAt: expiry,
        },
      ],
      warnings: ["Test fixture only; no live inventory was requested."],
      ...(input.conversation
        ? {
            conversation: {
              turnId: input.conversation.turnId,
              baseRevision: input.conversation.baseRevision,
            },
            assistance: patchTravel
              ? {
                  status: "completed",
                  summary: "Using your requested lower-price priority.",
                  appliedPreferences: { priority: "cheapest", drivingAllowed: true },
                  selectedPlanId: assessment.journey!.id,
                  activity: [],
                }
              : options.recommendConfirmed &&
                  input.selection &&
                  assessment.journey?.selectable
                ? {
                    status: "completed",
                    summary:
                      "This confirmed flight journey is recommended by the fixture assistant.",
                    appliedPreferences: {},
                    selectedPlanId: assessment.journey.id,
                    activity: [],
                  }
                : {
                    status: "limited",
                    summary:
                      "Choose a flight and confirm the remaining transfer facts.",
                    appliedPreferences: {},
                    selectedPlanId: null,
                    activity: [],
                    clarification: {
                      field: input.refinement?.includes("transfer")
                        ? "transfer"
                        : "flight",
                      reason: "required",
                    },
                  },
          }
        : {}),
    });
    await route.fulfill({ json: response });
  });
  return { posts, ground };
}
async function start(page: Page) {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "From city", exact: true })
    .fill("San Diego CA");
  await page.getByRole("option", { name: /^San Diego, CA/ }).click();
  await page
    .getByRole("combobox", { name: "To city", exact: true })
    .fill("Portland ME");
  await page.getByRole("option", { name: /^Portland, ME/ }).click();
  await expect(
    page.getByRole("region", { name: "Airports for flight search" }),
  ).toContainText("San Diego International Airport (SAN)");
  await expect(
    page.getByRole("region", { name: "Airports for flight search" }),
  ).toContainText("Portland International Jetport (PWM)");
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
}
async function step(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", { name: "Confirm and continue", exact: true })
    .click();
}
async function directFacts(page: Page) {
  await step(page, "Origin transfer minutes", "30");
  await step(page, "Airport processing allowance minutes", "120");
  await step(page, "Arrival processing allowance minutes", "30");
  await step(page, "Destination transfer minutes", "20");
  await page
    .getByRole("button", { name: "Confirm facts and check journey" })
    .click();
}
test("initial search checks both sources, discloses airports and confirms, selects, saves and reloads with zero posts", async ({
  page,
}) => {
  const { posts, ground } = await setup(page);
  await start(page);
  await expect(
    page.getByRole("button", { name: "Plan this flight" }),
  ).toHaveCount(2);
  expect(ground).toHaveLength(1);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    originAirportIata: "SAN",
    destinationAirportIata: "PWM",
    departureDate: "2026-11-18",
    overnight: null,
    selection: null,
  });
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await expect(
    page.getByRole("button", { name: "Choose this journey", exact: true }),
  ).toBeEnabled();
  expect(posts).toHaveLength(1); // Confirmation composes accepted quotes locally.
  await page
    .getByRole("button", { name: "Choose this journey", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  await expect(page.getByTestId("saved-plan")).toContainText(
    "Saved planning estimate.",
  );
  const saved = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText(
    "Flight departure date: 2026-11-18",
  );
  expect(posts).toHaveLength(1);
  expect(ground).toHaveLength(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
  await page
    .getByRole("button", { name: "Refresh this plan", exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toEqual(JSON.parse(saved!).request);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    saved,
  );
});
test("explicit overnight uses origin night and next day flight, then progresses through stay facts", async ({
  page,
}) => {
  const { posts } = await setup(page, { recommendConfirmed: true });
  await start(page);
  await page
    .getByRole("button", { name: "Explore overnight", exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({
    departureDate: "2026-11-19",
    overnight: { checkin: "2026-11-18", checkout: "2026-11-19" },
  });
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await page.getByRole("button", { name: "Plan this overnight" }).click();
  await step(page, "Origin transfer minutes", "30");
  await step(
    page,
    "Hotel arrival local date and time (America/Los_Angeles, estimated)",
    "2026-11-18T16:00",
  );
  await step(
    page,
    "Hotel departure local date and time (America/Los_Angeles, estimated)",
    "2026-11-19T06:30",
  );
  await step(page, "Hotel check-in allowance minutes", "15");
  await step(page, "Hotel to airport transfer minutes", "30");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm and continue", exact: true })
    .click();
  await step(page, "Airport processing allowance minutes", "120");
  await step(page, "Arrival processing allowance minutes", "30");
  await step(page, "Destination transfer minutes", "20");
  await page
    .getByRole("button", { name: "Confirm facts and check journey" })
    .click();
  await expect(
    page.getByRole("button", { name: "Choose this journey", exact: true }),
  ).toBeEnabled();
  expect(posts).toHaveLength(2); // Hotel facts also compose without reacquiring quotes.
  await page
    .getByRole("textbox", { name: "Message about your trip", exact: true })
    .fill("Recommend this flight journey");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2].selection?.facts.stay).toMatchObject({
    arrangementsConfirmed: true,
    hotelArrivalAt: "2026-11-18T16:00:00-08:00",
    hotelDepartureAt: "2026-11-19T06:30:00-08:00",
  });
  expect(posts[2].overnight).toEqual(posts[1].overnight);
  await expect(page.getByRole("log")).toContainText(
    "This confirmed flight journey is recommended by the fixture assistant.",
  );
});
test("reranks fresh quotes locally and cancel, dirty edits, city switches invalidate planning", async ({
  page,
}) => {
  const { posts, ground } = await setup(page);
  await start(page);
  await page.getByRole("button", { name: "Cheaper", exact: true }).click();
  await page
    .getByRole("button", { name: "Fewer changes", exact: true })
    .click();
  expect(posts).toHaveLength(1);
  expect(ground).toHaveLength(1);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("form", { name: "Complete journey facts" }),
  ).toHaveCount(0);
  await page.getByText("Edit trip", { exact: true }).click();
  await page.getByLabel("By a date and time", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Plan this flight" }).first(),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "From city", exact: true })
    .fill("Boston MA");
  await page.getByRole("option", { name: /^Boston, MA/ }).click();
  await expect(
    page.getByRole("button", { name: "Plan this flight" }),
  ).toHaveCount(0);
  expect(posts).toHaveLength(1);
});
test("older quotes remain usable for local confirmation, selection, saving and handoffs without requests", async ({ page }) => {
  const { posts } = await setup(page);
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await page.clock.setFixedTime(new Date("2026-11-18T14:30:00Z"));
  await directFacts(page);
  const choose = page.getByRole("button", { name: "Choose this journey", exact: true });
  await expect(choose).toBeEnabled();
  await expect(page.getByRole("button", { name: "Cheaper", exact: true })).toBeEnabled();
  await choose.click();
  await page.getByRole("button", { name: "Save on this device", exact: true }).click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.generatedAt).toBe(now);
  expect(saved.expiresAt).toBe(expiry);
  expect(saved.selectedAt).toBe("2026-11-18T14:30:00.000Z");
  expect(Date.parse(saved.selectedFlight.evidence[0].checkedAt)).toBe(Date.parse(now));
  await page.context().route("https://www.google.com/travel/flights?q=SAN", route => route.fulfill({ body: "Fixture booking search; no purchase", contentType: "text/html" }));
  const handoff = page.getByRole("link", { name: "Check current flight options on Google Travel" }).first();
  const popupPromise = page.waitForEvent("popup");
  await handoff.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/google.com\/travel\/flights/);
  await popup.close();
  await page.screenshot({ path: test.info().outputPath("older-quotes-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("older-quotes-mobile.png"), fullPage: true });
  expect(posts).toHaveLength(1);
});
test("the automatic source-age timer preserves an open form and a chosen journey", async ({ page }) => {
  const { posts } = await setup(page, { installClock: true });
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await page.getByLabel("Origin transfer minutes", { exact: true }).fill("30");
  await page.clock.fastForward(6 * 60 * 1000);
  await expect(page.getByRole("form", { name: "Complete journey facts", exact: true })).toBeVisible();
  await expect(page.getByLabel("Origin transfer minutes", { exact: true })).toHaveValue("30");
  await directFacts(page);
  await page.getByRole("button", { name: "Choose this journey", exact: true }).click();
  await page.clock.fastForward(14 * 60 * 1000);
  await expect(page.getByRole("button", { name: "Chosen journey", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save on this device", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Cheaper", exact: true })).toBeEnabled();
  expect(posts).toHaveLength(1);
});
test("an explicit refresh replaces changed quotes and clears the previous selection", async ({ page }) => {
  const { posts } = await setup(page, { changed: true });
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await page.getByRole("button", { name: "Choose this journey", exact: true }).click();
  await page.getByRole("button", { name: "Recheck available sources", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(page.getByRole("button", { name: "Save on this device", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Chosen journey", exact: true })).toHaveCount(0);
  await expect(page.getByText("$999.99", { exact: true })).toBeVisible();
});
test("a failed optional refresh keeps the accepted flight journey available", async ({ page }) => {
  const { posts } = await setup(page, { refreshDown: true });
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await page.getByRole("button", { name: "Choose this journey", exact: true }).click();
  await page.clock.setFixedTime(new Date("2026-11-18T14:30:00Z"));
  await page.getByRole("button", { name: "Recheck available sources", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(page.getByText(/Could not refresh sources/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Chosen journey", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save on this device", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Cheaper", exact: true })).toBeEnabled();
});
test("travel source outage stays visible without fake quotes and ground outage does not hide flight planning", async ({
  page,
}) => {
  await setup(page, { unavailable: true });
  await start(page);
  await expect(
    page.getByText("flights: Flight source unavailable in this fixture."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Plan this flight" }),
  ).toHaveCount(0);
});
test("flight planning remains usable when ground discovery fails", async ({
  page,
}) => {
  await setup(page, { groundDown: true });
  await start(page);
  await expect(
    page.getByRole("button", { name: "Plan this flight" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await expect(
    page.getByRole("button", { name: "Choose this journey", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Explore overnight", exact: true }),
  ).toBeEnabled();
});
test("hard budget with unconfirmed costs prevents choosing a flight journey", async ({
  page,
}) => {
  await setup(page);
  await start(page);
  await page.getByText("Edit trip", { exact: true }).click();
  await page
    .getByText("Budget and travel preferences", { exact: false })
    .click();
  await page
    .getByLabel("Budget (USD, optional)", { exact: true })
    .fill("10000");
  await page
    .getByLabel("Budget flexibility", { exact: true })
    .selectOption("hard");
  await page
    .getByRole("button", {
      name: "Confirm trip facts and update options",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await expect(
    page.getByRole("button", { name: "Choose this journey", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Flight and overnight planning" }),
  ).toContainText(/unknown|incomplete/i);
});
test("connecting quote requires explicit connection allowance before confirming", async ({
  page,
}) => {
  const { posts } = await setup(page);
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).nth(1).click();
  await step(page, "Origin transfer minutes", "30");
  await step(page, "Airport processing allowance minutes", "120");
  await expect(
    page.getByRole("form", { name: "Complete journey facts" }),
  ).toContainText("ORD");
  await page
    .getByRole("button", { name: "Confirm and continue", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /Connection allowance/ }),
  ).toBeVisible();
  await step(page, "Connection processing allowance minutes", "45");
  await step(page, "Arrival processing allowance minutes", "30");
  await step(page, "Destination transfer minutes", "20");
  await page
    .getByRole("button", { name: "Confirm facts and check journey" })
    .click();
  await expect(
    page.getByRole("button", { name: "Choose this journey", exact: true }),
  ).toBeEnabled();
  expect(posts).toHaveLength(1);
  await page.getByRole("textbox", { name: "Message about your trip", exact: true }).fill("Recommend this flight journey");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].selection?.facts.connections).toEqual([
    {
      afterSegmentId: "segment-1",
      allowanceMinutes: 45,
      airportTransfer: null,
    },
  ]);
});
test("one conversation routes hotel intent to travel assistance with bounded context and keeps new overnight quotes", async ({
  page,
}) => {
  const { posts, ground } = await setup(page);
  await start(page);
  await page
    .getByRole("textbox", {
      name: "Message about your trip",
      exact: true,
    })
    .fill("Find an overnight hotel and flight");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(ground).toHaveLength(1);
  expect(posts[1].refinement).toBe("Find an overnight hotel and flight");
  expect(posts[1].conversation?.history.length).toBeGreaterThan(0);
  expect(posts[1].overnight).toEqual({
    checkin: "2026-11-18",
    checkout: "2026-11-19",
  });
  await expect(
    page.getByRole("region", { name: "Flight and overnight planning" }),
  ).toContainText("Origin overnight 2026-11-18 to 2026-11-19");
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await expect(
    page.getByRole("button", { name: "Plan this overnight" }),
  ).toBeVisible();
});
test("flight chat retries travel after its source fails and never asks the ground agent for flight inventory", async ({
  page,
}) => {
  const { posts, ground } = await setup(page, { initialTravelDown: true });
  await start(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Flight and hotel search" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message about your trip", exact: true })
    .fill("Find flights");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(ground).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Plan this flight" }),
  ).toHaveCount(2);
});
test("transfer clarification opens confirmed facts progressively and clears active journey choice", async ({
  page,
}) => {
  await setup(page);
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await page
    .getByRole("button", { name: "Choose this journey", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message about your trip", exact: true })
    .fill("Check my transfer facts");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("form", { name: "Complete journey facts" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Origin transfer minutes", { exact: true }),
  ).toHaveValue("30");
  await expect(
    page.getByRole("button", { name: "Save on this device", exact: true }),
  ).toBeDisabled();
});
test("accepted city-agent preferences recompose travel locally, clear old choice and save the shared binding", async ({
  page,
}) => {
  const { posts, ground } = await setup(page, { cityPatch: true });
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await page
    .getByRole("button", { name: "Choose this journey", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message about your trip", exact: true })
    .fill("Please use the cheapest option and allow driving");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => ground.length).toBe(2);
  await expect(
    page.getByRole("button", { name: "Save on this device", exact: true }),
  ).toBeDisabled();
  expect(posts).toHaveLength(1);
  expect(ground).toHaveLength(2);
  await page
    .getByRole("button", { name: "Choose this journey", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save on this device", exact: true })
    .click();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(saved.request.trip.priority).toBe("cheapest");
  expect(saved.request.trip.readyAt).toBe(posts[0].trip.readyAt);
  expect(saved.request.trip.drivingAllowed).toBe(false);
  for (const priority of ["Fewer changes", "Cheaper"]) {
    await page.getByRole("button", { name: priority, exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(posts).toHaveLength(1);
    expect(ground).toHaveLength(2);
  }
  await page
    .getByRole("textbox", { name: "Message about your trip", exact: true })
    .fill("Check flight options");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].trip.priority).toBe("cheapest");
  expect(posts.every(input => input.trip.drivingAllowed === false)).toBe(true);
});
test("accepted travel-agent preferences update draft and ground locally without another request", async ({
  page,
}) => {
  const { posts, ground } = await setup(page, { travelPatch: true });
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await expect(
    page.getByRole("button", { name: "Choose this journey", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Message about your trip", exact: true })
    .fill("Find cheapest flights and allow driving");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(page.getByRole("log")).not.toContainText(/driving (?:is now |has been )?allowed|enabled driving/i);
  await page.getByText("Edit trip", { exact: true }).click();
  await page
    .getByText("Budget and travel preferences", { exact: true })
    .click();
  await expect(page.getByLabel("Prioritize", { exact: true })).toHaveValue(
    "cheapest",
  );
  expect(posts).toHaveLength(2);
  expect(posts[1].selection).not.toBeNull();
  expect(ground).toHaveLength(1);
  await page
    .getByRole("button", { name: "Fewer changes", exact: true })
    .click();
  expect(posts).toHaveLength(2);
  expect(ground).toHaveLength(1);
  await page.getByRole("button", { name: "Plan this flight", exact: true }).first().click();
  await directFacts(page);
  expect(posts).toHaveLength(2);
  expect(posts.every(input => input.trip.drivingAllowed === false)).toBe(true);
  await expect(page.getByLabel("Driving allowed", { exact: true })).toHaveCount(0);
});
test("negated and ambiguous overnight mentions preserve flight date and do not request hotel inventory", async ({
  page,
}) => {
  const { posts } = await setup(page);
  await start(page);
  for (const message of [
    "No overnight hotel, find a flight today.",
    "Do I need an overnight hotel?",
    "Find flights today; my hotel is already booked.",
    "I want to stay under $200",
  ]) {
    await page
      .getByRole("textbox", { name: "Message about your trip", exact: true })
      .fill(message);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect.poll(() => posts.at(-1)?.refinement).toBe(message);
    expect(posts.at(-1)?.overnight).toBeNull();
    expect(posts.at(-1)?.departureDate).toBe("2026-11-18");
  }
});
for (const action of ["Recheck available sources", "Confirm trip facts and update options"]) {
  test(`${action} preserves accepted overnight dates until an explicit same-day search`, async ({
    page,
  }) => {
    const { posts } = await setup(page);
    await start(page);
    await page
      .getByRole("button", { name: "Explore overnight", exact: true })
      .click();
    await expect.poll(() => posts.length).toBe(2);
    await expect(
      page.getByRole("region", { name: "Flight and overnight planning" }),
    ).toContainText("Origin overnight 2026-11-18 to 2026-11-19");
    const accepted = posts[1];
    if (action === "Confirm trip facts and update options") {
      await page.getByText("Edit trip", { exact: true }).click();
    }
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2].departureDate).toBe(accepted.departureDate);
    expect(posts[2].overnight).toEqual(accepted.overnight);
    expect(posts[2].trip.readyAt).toBe(accepted.trip.readyAt);
    expect(posts[2].originAirportIata).toBe(accepted.originAirportIata);
    expect(posts[2].destinationAirportIata).toBe(
      accepted.destinationAirportIata,
    );
    expect(posts[2].trip.drivingAllowed).toBe(false);
    await page
      .getByRole("button", { name: "Search same-day flights", exact: true })
      .click();
    await expect.poll(() => posts.length).toBe(4);
    expect(posts[3].departureDate).toBe("2026-11-18");
    expect(posts[3].overnight).toBeNull();
    expect(posts[3].trip.readyAt).toBe(accepted.trip.readyAt);
    expect(posts[3].trip.drivingAllowed).toBe(false);
    await expect(
      page.getByRole("button", {
        name: "Search same-day flights",
        exact: true,
      }),
    ).toHaveCount(0);
  });
}

test("travel chat retains older confirmed flight selection for assistance", async ({
  page,
}) => {
  const { posts } = await setup(page, { recommendConfirmed: true });
  await start(page);
  await page.getByRole("button", { name: "Plan this flight" }).first().click();
  await directFacts(page);
  await expect(
    page.getByRole("button", { name: "Choose this journey", exact: true }),
  ).toBeEnabled();
  expect(posts).toHaveLength(1);
  await page.clock.setFixedTime(new Date("2026-11-18T14:30:00Z"));
  await page
    .getByRole("textbox", { name: "Message about your trip", exact: true })
    .fill("Recommend this flight journey");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].selection?.flightOfferId).toBeTruthy();
  expect(posts[1].selection?.facts.originTransfer.minutes).toBe(30);
  await expect(page.getByRole("log")).toContainText(
    "This confirmed flight journey is recommended by the fixture assistant.",
  );
});
for (const invalidation of [
  "editing",
  "canceled",
  "new overnight",
]) {
  test(`travel chat does not resurrect ${invalidation} confirmed facts`, async ({
    page,
  }) => {
    const { posts } = await setup(page);
    await start(page);
    await page
      .getByRole("button", { name: "Plan this flight" })
      .first()
      .click();
    await directFacts(page);
    await expect(
      page.getByRole("button", { name: "Choose this journey", exact: true }),
    ).toBeEnabled();
    if (invalidation === "editing" || invalidation === "canceled") {
      await page
        .getByRole("textbox", { name: "Message about your trip", exact: true })
        .fill("Check my transfer facts");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByRole("form", { name: "Complete journey facts" }),
      ).toBeVisible();
      if (invalidation === "canceled")
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
      else
        await page
          .getByLabel("Origin transfer minutes", { exact: true })
          .fill("45");
    }
    const before = posts.length;
    const message =
      invalidation === "new overnight"
        ? "Find an overnight hotel and flight"
        : "Recommend this flight journey";
    await page
      .getByRole("textbox", { name: "Message about your trip", exact: true })
      .fill(message);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect.poll(() => posts.length).toBe(before + 1);
    expect(posts.at(-1)?.selection).toBeNull();
    if (invalidation === "new overnight")
      expect(posts.at(-1)?.overnight).toEqual({
        checkin: "2026-11-18",
        checkout: "2026-11-19",
      });
  });
}
