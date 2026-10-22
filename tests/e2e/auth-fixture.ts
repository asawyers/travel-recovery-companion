import { test as base, expect, type Page, type Route } from "@playwright/test";

import { AUTH_STORAGE_KEY, fakeSession } from "../support/auth-fixture-data";
export { AUTH_USER_ID, AUTH_SECOND_USER_ID, AUTH_EMAIL, AUTH_STORAGE_KEY, SAVED_PLAN_KEY, fakeSession, AUTH_ACCESS_TOKEN } from "../support/auth-fixture-data";

/** Browser routing targets this loopback test server; the app retains its normal endpoint. */
export const RECOVERY_HTTP_URL = process.env.PLAYWRIGHT_RECOVERY_HTTP_URL || "http://127.0.0.1:37425/functions/v1/recovery";

export async function interceptAuth(page: Page, session = fakeSession()) {
  await page.route("**/auth/v1/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/user")) return route.fulfill({ json: session.user });
    if (path.endsWith("/token")) return route.fulfill({ json: session });
    if (path.endsWith("/logout")) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 400, json: { error: "Unexpected synthetic auth request" } });
  });
}

export const test = base.extend<{ authenticatedSession: void }>({
  authenticatedSession: [async ({ page }, use) => {
    await interceptAuth(page);
    // A distinct matcher survives a test removing its own temporary glob override.
    await page.route(url => url.pathname === "/functions/v1/recovery", async route => {
      const response = await route.fetch({ url: RECOVERY_HTTP_URL });
      await route.fulfill({ response });
    });
    await page.addInitScript(({ key, session }) => {
      localStorage.setItem(key, JSON.stringify(session));
    }, { key: AUTH_STORAGE_KEY, session: fakeSession() });
    await use();
  }, { auto: true }],
});
export { expect };
export type { Page, Route, Locator } from "@playwright/test";
