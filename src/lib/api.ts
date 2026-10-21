import { RecoveryResponseSchema } from "@domain/api";
import type { RecoveryResponse } from "@domain/api";
import type { TripRequest } from "@domain/schemas";

/** Only these controlled boundary messages may be displayed by the UI. */
export class PublicPlannerError extends Error {}
const REQUEST_TIMEOUT_MS = 35_000;

export function recoveryEndpoint(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw new PublicPlannerError();
    return url.toString();
  } catch {
    throw new PublicPlannerError(
      "Planner configuration is invalid. Set VITE_RECOVERY_API_URL to a public HTTP endpoint without credentials or query parameters. Your inputs are retained.",
    );
  }
}
async function requestRecovery(
  endpoint: string,
  request: TripRequest,
  investigate: boolean,
  signal: AbortSignal,
): Promise<RecoveryResponse> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ request, investigate }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PublicPlannerError(
      "Cannot reach the planner. Check your connection and retry. Your inputs are retained.",
    );
  }
  if (!response.ok)
    throw new PublicPlannerError(
      "The planner is unavailable or rejected these trip facts. Check your inputs and retry. Your inputs are retained.",
    );
  try {
    return RecoveryResponseSchema.parse(await response.json());
  } catch {
    throw new PublicPlannerError(
      "The planner returned invalid trip facts. Retry the comparison. Your inputs are retained.",
    );
  }
}

/** One total deadline covers both response headers and JSON, including ignored aborts. */
export async function comparePublic(
  endpoint: string,
  request: TripRequest,
  investigate: boolean,
  signal: AbortSignal,
): Promise<RecoveryResponse> {
  const controller = new AbortController();
  let timedOut = false;
  let onAbort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        timedOut
          ? new PublicPlannerError(
              "The planner timed out. Retry the comparison. Your inputs are retained.",
            )
          : controller.signal.reason,
      );
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  const forwardAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    if (signal.aborted) {
      forwardAbort();
      return await interrupted;
    }
    return await Promise.race([
      requestRecovery(endpoint, request, investigate, controller.signal),
      interrupted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
