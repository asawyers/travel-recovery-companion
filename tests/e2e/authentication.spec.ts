import { test, expect, type Page } from "@playwright/test";
import { AUTH_EMAIL, AUTH_STORAGE_KEY, AUTH_USER_ID, AUTH_SECOND_USER_ID, SAVED_PLAN_KEY, fakeSession } from "./auth-fixture";
import { demonstrate, reviewPlan, echoConversation } from "./helpers";
import { overnightFixture } from "../../supabase/functions/_shared/domain/fixtures";
import { planRecovery } from "../../supabase/functions/_shared/domain/planner";
import { ADAPTER_REVISION, RecoveryResponseSchema } from "../../supabase/functions/_shared/domain/api";

/** These tests exercise the production SDK and UI against explicitly intercepted test responses. */
async function authRoutes(page: Page, options: { failPassword?: boolean; confirmationRequired?: boolean } = {}) {
  const calls: { path: string; data: Record<string, unknown> | null }[] = [];
  let session = fakeSession();
  await page.route("**/auth/v1/**", async route => {
    const url = new URL(route.request().url());
    const data = route.request().postData() ? route.request().postDataJSON() : null;
    calls.push({ path: `${url.pathname}${url.search}`, data });
    if (url.pathname.endsWith("/user")) return route.fulfill({ json: session.user });
    if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith("/signup")) {
      session = fakeSession(AUTH_USER_ID, String(data.email));
      return route.fulfill({ json: options.confirmationRequired ? { user: session.user, session: null } : session });
    }
    if (url.pathname.endsWith("/token")) {
      if (options.failPassword) return route.fulfill({ status: 400, json: { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" } });
      session = fakeSession(String(data.email).startsWith("second") ? AUTH_SECOND_USER_ID : AUTH_USER_ID, String(data.email));
      return route.fulfill({ json: session });
    }
    return route.fulfill({ status: 400, json: { error: "Unexpected synthetic auth request" } });
  });
  return calls;
}
async function signIn(page: Page, email = AUTH_EMAIL) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("example-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
}
const signedOut = (page: Page) => page.getByRole("heading", { name: "Sign in to plan your trip", exact: true });

for (const path of ["/", "/legacy"]) {
  test(`signed-out ${path} gates trip planning without invoking recovery`, async ({ page }) => {
    await authRoutes(page);
    const requests: string[] = [];
    await page.route("**/functions/v1/recovery**", route => { requests.push(route.request().url()); return route.abort(); });
    await page.goto(path);
    await expect(signedOut(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Find my options", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Gate arrival", { exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}

test("sign-up submits email and password and explains email confirmation", async ({ page }) => {
  const calls = await authRoutes(page, { confirmationRequired: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create your account", exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("new-account@example.test");
  await page.getByLabel("Password", { exact: true }).fill("example-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Check your inbox to confirm your email, then sign in.", { exact: true })).toBeVisible();
  expect(calls.find(call => call.path.includes("/signup"))?.data).toMatchObject({ email: "new-account@example.test", password: "example-password-123" });
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
});

test("sign-up opens planning when the configured Auth response includes a session", async ({ page }) => {
  await authRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("new-account@example.test");
  await page.getByLabel("Password", { exact: true }).fill("example-password-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.getByText("new-account@example.test", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where are you trying to get to?", exact: true })).toBeVisible();
});

test("invalid credentials retain the form and show a readable error", async ({ page }) => {
  await authRoutes(page, { failPassword: true });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(AUTH_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/invalid|could not|unable/i);
  await expect(signedOut(page)).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(AUTH_EMAIL);
});

test("successful email sign-in persists across reload and sign-out clears the SDK session", async ({ page }) => {
  const calls = await authRoutes(page);
  await page.goto("/");
  await signIn(page);
  expect(calls.find(call => call.path.includes("grant_type=password"))?.data).toMatchObject({ email: AUTH_EMAIL, password: "example-password-123" });
  await expect(page.getByRole("heading", { name: "Where are you trying to get to?", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(signedOut(page)).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
  await page.reload();
  await expect(signedOut(page)).toBeVisible();
});

test("account A snapshot survives sign-out and stays isolated from account B", async ({ page }) => {
  await authRoutes(page);
  const fixture = overnightFixture();
  await page.clock.setFixedTime(new Date(fixture.now));
  const result = planRecovery(fixture.request, fixture.candidates, { now: fixture.now });
  const body = RecoveryResponseSchema.parse({
    result,
    facts: { candidates: fixture.candidates,
      arrival: { arrivalAt: fixture.request.arrivalAt, arrivalBasis: fixture.request.arrivalBasis },
      arrivalEvidence: result.plans.find(plan => plan.hotel)!.hotel!.evidence,
      checkedAt: fixture.now, expiresAt: new Date(Date.parse(fixture.now) + 240000).toISOString(), adapterRevision: ADAPTER_REVISION },
  });
  await page.route("**/functions/v1/recovery", route => route.fulfill({ json: echoConversation(route, body) }));
  await page.goto("/legacy");
  await signIn(page);
  await demonstrate(page, "Overnight fictional example");
  await reviewPlan(page, "View Fictional overnight hotel and morning bus");
  await page.getByRole("button", { name: "Save on this device", exact: true }).click();
  await expect(page.getByTestId("saved-plan")).toContainText("Fictional standard queen room");
  const snapshot = await page.evaluate(key => localStorage.getItem(key), SAVED_PLAN_KEY);
  expect(snapshot).not.toBeNull();
  await page.evaluate(value => localStorage.setItem("travel-recovery:selected:v1", value!), snapshot);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(signedOut(page)).toBeVisible();
  await expect(page.getByTestId("saved-plan")).toHaveCount(0);
  await signIn(page, "second-account@example.test");
  await expect(page.getByTestId("saved-plan")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), `travel-recovery:selected:v1:account:${AUTH_SECOND_USER_ID}`)).toBeNull();
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page);
  await expect(page.getByTestId("saved-plan")).toContainText("Fictional standard queen room");
  expect(await page.evaluate(key => localStorage.getItem(key), SAVED_PLAN_KEY)).toBe(snapshot);
  expect(await page.evaluate(() => localStorage.getItem("travel-recovery:selected:v1"))).toBe(snapshot);
});

test("a rejected recovery session returns to sign-in and makes no further recovery request", async ({ page }) => {
  await authRoutes(page);
  let requests = 0;
  await page.route("**/functions/v1/recovery", route => {
    requests++;
    expect(route.request().headers().authorization).toBe(`Bearer ${fakeSession().access_token}`);
    return route.fulfill({ status: 401, json: { error: "Authentication required" } });
  });
  await page.goto("/legacy");
  await signIn(page);
  await demonstrate(page, "Daytime fictional example");
  await expect(signedOut(page)).toBeVisible();
  await expect(page.getByTestId("option-card")).toHaveCount(0);
  expect(requests).toBe(1);
});
