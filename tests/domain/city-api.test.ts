import { afterEach, expect, it, vi } from "vitest";
import { cityFixture } from "@domain/city-fixtures";
import { planCityRecovery } from "@domain/city-planner";
import {
  compareCityPublic,
  cityRecoveryEndpoint,
} from "../../src/lib/city-api";
const f = cityFixture();
const response = () => ({
  version: 2,
  result: planCityRecovery(f.request, f.candidates, {
    now: f.now,
    origin: f.origin,
    destination: f.destination,
  }),
  facts: {
    candidates: f.candidates,
    checkedAt: f.now,
    expiresAt: "2026-11-18T08:00:00-05:00",
    adapterRevision: "public-city-v1",
  },
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("appends city to the validated endpoint pathname safely", () => {
  expect(cityRecoveryEndpoint(undefined)).toBeNull();
  expect(
    cityRecoveryEndpoint("https://example.com/functions/v1/recovery/"),
  ).toBe("https://example.com/functions/v1/recovery/city");
  for (const endpoint of [
    "relative",
    "https://x.test/?key=secret",
    "https://user:secret@x.test/",
    "javascript:bad",
  ])
    expect(() => cityRecoveryEndpoint(endpoint)).toThrow(/configuration/i);
});
it("posts the exact v2 envelope without credentials and parses the strict response", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(response())));
  vi.stubGlobal("fetch", fetcher);
  const conversation = { turnId: "turn-1", baseRevision: 2, history: [] };
  await compareCityPublic(
    "https://example.com/recovery/city",
    f.request,
    true,
    new AbortController().signal,
    "  less expensive  ",
    conversation,
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    credentials: "omit",
    method: "POST",
  });
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
    request: f.request,
    investigate: true,
    refinement: "less expensive",
    conversation,
  });
});
it("hides unsafe server and transport messages and rejects unsupported responses", async () => {
  for (const value of [
    new Response("SECRET", { status: 500 }),
    new Response(JSON.stringify({ ...response(), extra: "SECRET" })),
    new Response("{}"),
  ]) {
    vi.stubGlobal("fetch", async () => value);
    await expect(
      compareCityPublic(
        "https://x.test/city",
        f.request,
        true,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/retained|retry/i);
  }
  vi.stubGlobal("fetch", async () => {
    throw new Error("SECRET");
  });
  await expect(
    compareCityPublic(
      "https://x.test/city",
      f.request,
      true,
      new AbortController().signal,
    ),
  ).rejects.not.toThrow(/SECRET/);
});
for (const stage of ["headers", "body"])
  it(`bounds stalled ${stage}, including an ignored abort`, async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () =>
      stage === "headers"
        ? new Promise(() => {})
        : new Response(new ReadableStream({ start() {} })),
    );
    const pending = compareCityPublic(
      "https://x.test/city",
      f.request,
      true,
      new AbortController().signal,
    ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(35001);
    expect(await pending).toMatchObject({
      message: expect.stringMatching(/timed out.*retained/i),
    });
    expect(vi.getTimerCount()).toBe(0);
  });
it("caller cancellation settles ignored-abort requests", async () => {
  vi.stubGlobal("fetch", async () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = compareCityPublic(
    "https://x.test/city",
    f.request,
    true,
    controller.signal,
  ).catch((e) => e);
  controller.abort();
  expect(await pending).toBeInstanceOf(Error);
});
