import { afterEach, expect, it, vi } from "vitest";
import { daytimeFixture } from "@domain/fixtures";
import { createRecoveryHandler } from "../../supabase/functions/_shared/server/handlers";
import { comparePublic, recoveryEndpoint } from "../../src/lib/api";
const f = daytimeFixture();
afterEach(() => vi.unstubAllGlobals());
it("accepts only absolute public HTTP endpoints without credentials or fragments", () => {
  expect(recoveryEndpoint(undefined)).toBeNull();
  expect(
    recoveryEndpoint("http://127.0.0.1:54321/functions/v1/recovery"),
  ).toContain("recovery");
  for (const value of [
    "relative",
    "file:///x",
    "https://user:password@example.com",
    "https://example.com/#secret",
  ])
    expect(() => recoveryEndpoint(value)).toThrow(/configuration/i);
});
it("posts the exact public envelope without credentials and validates the real handler response", async () => {
  const handler = createRecoveryHandler({
    now: () => "2026-10-21T12:00:00Z",
    allowedOrigins: [],
    providers: {
      gatherPermittedFacts: async () => ({ candidates: [], warnings: [] }),
    },
  });
  const fetcher = vi.fn(async (url: string, init: RequestInit) =>
    handler(new Request(url, init)),
  );
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  const response = await comparePublic(
    "https://example.com/recovery",
    f.request,
    true,
    controller.signal,
  );
  expect(response.facts.candidates).toEqual(
    response.result.request.confirmedOptions,
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    signal: controller.signal,
  });
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({
    request: f.request,
    investigate: true,
  });
});
it("provides safe actionable errors for invalid responses, network failures and server failures", async () => {
  for (const response of [
    new Response(JSON.stringify({ result: {}, facts: {}, extra: true })),
    new Response("private backend detail", { status: 500 }),
  ]) {
    vi.stubGlobal("fetch", async () => response);
    await expect(
      comparePublic(
        "https://example.com/recovery",
        f.request,
        false,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/retained|retry/i);
  }
  vi.stubGlobal("fetch", async () => {
    throw new Error("private transport detail");
  });
  await expect(
    comparePublic(
      "https://example.com/recovery",
      f.request,
      false,
      new AbortController().signal,
    ),
  ).rejects.toThrow(/connection.*retained/i);
});
