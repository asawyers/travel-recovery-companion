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
export function cityResultCount(result: CityRecoveryResult): string {
  const count = result.plans.filter((plan) => plan.kind !== "driving_estimate").length;
  return `${count} selectable ${count === 1 ? "journey" : "journeys"}.`;
}
/** A failed or superseded turn never makes the prior response appear new. */
export function cityAnswer(state: CitySessionState): string | null {
  if (state.busy || state.dirty || state.error || !state.result) return null;
  const assistance = state.assistance;
  if (assistance?.clarification)
    return cityClarificationQuestion(assistance.clarification);
  const visiblePlans = state.result.plans.filter((plan) => plan.kind !== "driving_estimate");
  if (!visiblePlans.length) {
    return "No complete ground itinerary could be validated from the available source facts. This does not mean no travel options exist. Add an option you checked, change your trip details or recheck the available sources.";
  }
  // Older responses can still contain standalone driving estimates. Their
  // assessment may describe hidden options, so use the visible comparison.
  const hasHiddenDriving = [...state.result.plans, ...state.result.rejected].some(
    (plan) => plan.kind === "driving_estimate",
  );
  const drivingEnabled = state.result.request.drivingAllowed || assistance?.appliedPreferences.drivingAllowed === true;
  return (
    (!hasHiddenDriving && !drivingEnabled ? assistance?.summary : null) ??
    `${visiblePlans.length} complete journey ${visiblePlans.length === 1 ? "option is" : "options are"} ready. Check the sources, transfer details and prices before choosing.`
  );
}
