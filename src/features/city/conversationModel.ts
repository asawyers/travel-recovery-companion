import { cityClarificationQuestion } from "@domain/city-contracts";
import type { CityPlan, CityRecoveryResult } from "@domain/city-contracts";
import type { CitySessionState } from "./session";

export function cityDrivingMinutes(plan: CityPlan): number {
  return plan.legs
    .filter((leg) => leg.mode === "drive")
    .reduce(
      (minutes, leg) =>
        minutes + (Date.parse(leg.endAt) - Date.parse(leg.startAt)) / 60_000,
      0,
    );
}
function informationalDrives(result: CityRecoveryResult): number {
  return result.rejected.filter((plan) => cityDrivingMinutes(plan) > 480).length;
}
export function cityResultCount(result: CityRecoveryResult): string {
  const count = result.plans.length,
    informational = informationalDrives(result);
  return `${count} selectable ${count === 1 ? "journey" : "journeys"}${informational ? ` · ${informational} informational driving ${informational === 1 ? "estimate" : "estimates"}` : ""}.`;
}
/** A failed or superseded turn never makes the prior response appear new. */
export function cityAnswer(state: CitySessionState): string | null {
  if (state.busy || state.dirty || state.error || !state.result) return null;
  const assistance = state.assistance;
  if (assistance?.clarification)
    return cityClarificationQuestion(assistance.clarification);
  if (!state.result.plans.length) {
    const count = informationalDrives(state.result);
    return `No complete ground itinerary could be validated from the available source facts. ${count ? `${count} informational driving ${count === 1 ? "estimate is" : "estimates are"} shown below; breaks, overnight stops and vehicle arrangements still need planning. ` : ""}This does not mean no travel options exist. Add an option you checked, change your trip details or recheck the available sources.`;
  }
  return (
    assistance?.summary ??
    `${state.result.plans.length} complete journey ${state.result.plans.length === 1 ? "option is" : "options are"} ready. Check the sources, transfer details and prices before choosing.`
  );
}
