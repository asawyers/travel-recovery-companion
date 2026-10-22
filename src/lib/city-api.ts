import {
  CityRecoveryInputSchema,
  CityRecoveryResponseSchema,
} from "@domain/city-contracts";
import type {
  CityRecoveryResponse,
  CityTripRequest,
} from "@domain/city-contracts";
import type { ConversationContext } from "@domain/conversation";
import { PublicPlannerError, recoveryEndpoint } from "./api";

export function cityRecoveryEndpoint(value: string | undefined): string | null {
  const endpoint = recoveryEndpoint(value);
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/city`;
  return url.toString();
}
export async function compareCityPublic(
  endpoint: string,
  request: CityTripRequest,
  investigate: boolean,
  signal: AbortSignal,
  refinement?: string,
  conversation?: ConversationContext,
): Promise<CityRecoveryResponse> {
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
  }, 35_000);
  try {
    if (signal.aborted) {
      forwardAbort();
      return await interrupted;
    }
    const run = async () => {
      const envelope = CityRecoveryInputSchema.safeParse({
        request,
        investigate,
        ...(refinement?.trim() ? { refinement: refinement.trim() } : {}),
        ...(conversation ? { conversation } : {}),
      });
      if (!envelope.success)
        throw new PublicPlannerError(
          "Check your trip facts and retry. Your inputs are retained.",
        );
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit",
          body: JSON.stringify(envelope.data),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new PublicPlannerError(
          "Cannot reach the planner. Check your connection and retry. Your inputs are retained.",
        );
      }
      if (!response.ok)
        throw new PublicPlannerError(
          "The planner is unavailable or rejected these trip facts. Check your inputs and retry. Your inputs are retained.",
        );
      try {
        return CityRecoveryResponseSchema.parse(await response.json());
      } catch {
        throw new PublicPlannerError(
          "The planner returned invalid trip facts. Retry the comparison. Your inputs are retained.",
        );
      }
    };
    return await Promise.race([run(), interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
