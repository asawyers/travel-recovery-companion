import { afterEach, expect, it, vi } from "vitest";
import { daytimeFixture } from "@domain/fixtures";
import { createRecoveryHandler } from "../../supabase/functions/_shared/server/handlers";
import { comparePublic, recoveryEndpoint } from "../../src/lib/api";
const f = daytimeFixture();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
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
    signal: expect.any(AbortSignal),
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

for (const stage of ["fetch", "body"]) {
  it(`bounds a stalled ${stage} with a controlled deadline and cleans up its timer`, async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      if (stage === "fetch") return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start() {} }));
    });
    let outcome: unknown;
    const settled = comparePublic(
      "https://example.com/recovery",
      f.request,
      false,
      new AbortController().signal,
    ).catch((error) => {
      outcome = error;
    });
    await vi.advanceTimersByTimeAsync(35_001);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/timed out.*retry.*retained/i);
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await settled;
  });
}

it("caller cancellation settles ignored-abort transport and clears the deadline timer", async () => {
  vi.useFakeTimers();
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requestSignal = init.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const controller = new AbortController();
  let outcome: unknown;
  const settled = comparePublic(
    "https://example.com/recovery",
    f.request,
    false,
    controller.signal,
  ).catch((error) => {
    outcome = error;
  });
  // Let asynchronous session headers settle so this case still cancels an active transport.
  await vi.advanceTimersByTimeAsync(0);
  expect(requestSignal).toBeDefined();
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome).toBeInstanceOf(Error);
  expect(requestSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await settled;
});


it("posts a trimmed refinement separately from the unchanged canonical trip envelope", async () => {
  let body: unknown;
  const handler = createRecoveryHandler({ now: () => "2026-10-21T12:00:00Z", providers: { gatherPermittedFacts: async () => ({ candidates: [], warnings: [] }) } });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return handler(new Request(url, init)); });
  await comparePublic("https://example.com/recovery", f.request, false, new AbortController().signal, "  avoid driving  ");
  expect(body).toEqual({ request: f.request, investigate: false, refinement: "avoid driving" });
});


it("forwards bounded conversation separately and accepts the exact public echo", async () => {
  let body: any;
  const handler = createRecoveryHandler({ now: () => "2026-10-21T12:00:00Z", providers: { gatherPermittedFacts: async () => ({ candidates: [], warnings: [] }) } });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return handler(new Request(url, init)); });
  const conversation = { turnId:"turn-2", baseRevision:3, history:[{ role:"assistant" as const, content:"Your current comparison is ready." }] };
  const response = await comparePublic("https://example.com/recovery", f.request, true, new AbortController().signal, "What about tomorrow?", conversation);
  expect(body).toEqual({ request:f.request, investigate:true, refinement:"What about tomorrow?", conversation });
  expect(response.conversation).toEqual({turnId:"turn-2",baseRevision:3});
});
