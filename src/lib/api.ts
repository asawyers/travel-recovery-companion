import { RecoveryResponseSchema } from "@domain/api";
import type { RecoveryResponse } from "@domain/api";
import type { TripRequest } from "@domain/schemas";

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
      throw new Error();
    return url.toString();
  } catch {
    throw new Error(
      "Planner configuration is invalid. Set VITE_RECOVERY_API_URL to a public HTTP endpoint without credentials or query parameters. Your inputs are retained.",
    );
  }
}
export async function comparePublic(
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
    throw new Error(
      "Cannot reach the planner. Check your connection and retry. Your inputs are retained.",
    );
  }
  if (!response.ok)
    throw new Error(
      "The planner is unavailable or rejected these trip facts. Check your inputs and retry. Your inputs are retained.",
    );
  try {
    return RecoveryResponseSchema.parse(await response.json());
  } catch {
    throw new Error(
      "The planner returned invalid trip facts. Retry the comparison. Your inputs are retained.",
    );
  }
}
