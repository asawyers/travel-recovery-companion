import { test as base, expect, type BrowserContext, type Page, type Route } from "@playwright/test";

import { AUTH_STORAGE_KEY, fakeSession } from "../support/auth-fixture-data";
export { AUTH_USER_ID, AUTH_SECOND_USER_ID, AUTH_EMAIL, AUTH_STORAGE_KEY, SAVED_PLAN_KEY, fakeSession, AUTH_ACCESS_TOKEN } from "../support/auth-fixture-data";

/** Browser routing targets this loopback test server; the app retains its normal endpoint. */
export const RECOVERY_HTTP_URL = process.env.PLAYWRIGHT_RECOVERY_HTTP_URL || "http://127.0.0.1:37425/functions/v1/recovery";

/** Deterministic PostgREST stand-in. It tests browser behavior, not hosted RLS. */
export type ConversationRow = {
  id: string; user_id: string; title: string;
  messages: { id: string; role: "user" | "assistant"; content: string; revision: number }[];
  trip: Record<string, unknown> | null; revision: number; created_at: string; updated_at: string;
};
export function createConversationDatabase() {
  return {
    rows: new Map<string, ConversationRow>(),
    requests: [] as { method: string; url: string; userId: string; body: unknown }[],
    failNextWrite: false,
  };
}
export type ConversationDatabase = ReturnType<typeof createConversationDatabase>;
export async function installConversationDatabase(target: Page | BrowserContext, database: ConversationDatabase) {
  await target.route("**/rest/v1/recovery_conversations**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    // Synthetic token decoding is confined to this test fixture; this is not JWT verification.
    let userId = "";
    try { userId = JSON.parse(Buffer.from(request.headers().authorization?.split(".")[1] ?? "", "base64url").toString()).sub; } catch { /* rejected below */ }
    const body = request.postData() ? request.postDataJSON() : null;
    database.requests.push({ method, url: request.url(), userId, body });
    if (!userId) return route.fulfill({ status: 401, json: { message: "Fixture authentication required" } });
    if (method !== "GET" && database.failNextWrite) {
      database.failNextWrite = false;
      return route.fulfill({ status: 503, json: { message: "Fixture chat storage unavailable" } });
    }
    const matches = (row: ConversationRow) => row.user_id === userId &&
      ["id", "user_id", "revision"].every(key => {
        const filter = url.searchParams.get(key);
        return !filter || filter === `eq.${row[key as "id" | "user_id" | "revision"]}`;
      });
    const reply = (rows: ConversationRow[], status = 200) => {
      const select = url.searchParams.get("select");
      const data = select && select !== "*" ? rows.map(row => Object.fromEntries(select.split(",").map(column => [column, row[column as keyof ConversationRow]]))) : rows;
      return route.fulfill({ status, json: request.headers().accept?.includes("vnd.pgrst.object+json") ? data[0] ?? null : data });
    };
    if (method === "GET") {
      if (url.searchParams.get("user_id") !== `eq.${userId}`) return route.fulfill({ status: 400, json: { message: "Fixture reads require the signed-in owner filter" } });
      const rows = [...database.rows.values()].filter(matches).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return reply(rows.slice(0, Number(url.searchParams.get("limit") ?? rows.length)));
    }
    if (method === "POST") {
      if (body.user_id !== userId) return route.fulfill({ status: 403, json: { message: "Fixture owner mismatch" } });
      const timestamp = new Date().toISOString();
      const row: ConversationRow = { id: crypto.randomUUID(), revision: 0, created_at: timestamp, updated_at: timestamp, ...body };
      if (database.rows.has(row.id)) return route.fulfill({ status: 409, json: { message: "Fixture duplicate chat" } });
      database.rows.set(row.id, structuredClone(row));
      return reply([row], 201);
    }
    if (method === "PATCH") {
      if (!url.searchParams.has("user_id") || !url.searchParams.has("id") || !url.searchParams.has("revision"))
        return route.fulfill({ status: 400, json: { message: "Fixture updates require owner, ID and revision filters" } });
      const rows = [...database.rows.values()].filter(matches);
      if (body.user_id && body.user_id !== userId) return route.fulfill({ status: 403, json: { message: "Fixture owner mismatch" } });
      if (rows.some(row => body.revision !== row.revision + 1)) return route.fulfill({ status: 409, json: { message: "Fixture revision must increment" } });
      const updated = rows.map(row => ({ ...row, ...body, updated_at: new Date().toISOString() }));
      for (const row of updated) database.rows.set(row.id, structuredClone(row));
      return reply(updated);
    }
    if (method === "DELETE") {
      if (!url.searchParams.has("user_id") || !url.searchParams.has("id"))
        return route.fulfill({ status: 400, json: { message: "Fixture deletes require owner and ID filters" } });
      const rows = [...database.rows.values()].filter(matches);
      for (const row of rows) database.rows.delete(row.id);
      return reply(rows);
    }
    return route.fulfill({ status: 405, json: { message: "Unexpected fixture method" } });
  });
}

export async function interceptAuth(page: Page, session = fakeSession()) {
  await page.route("**/auth/v1/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/user")) return route.fulfill({ json: session.user });
    if (path.endsWith("/token")) return route.fulfill({ json: session });
    if (path.endsWith("/logout")) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 400, json: { error: "Unexpected synthetic auth request" } });
  });
}

export const test = base.extend<{ authenticatedSession: void; conversationDatabase: ConversationDatabase }>({
  conversationDatabase: async ({}, use) => { await use(createConversationDatabase()); },
  authenticatedSession: [async ({ page, conversationDatabase }, use) => {
    await installConversationDatabase(page, conversationDatabase);
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
