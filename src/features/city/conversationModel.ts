import { cityClarificationQuestion } from "@domain/city-contracts";
import type { CitySessionState } from "./session";
/** A failed or superseded turn never makes the prior response appear new. */
export function cityAnswer(state: CitySessionState): string | null {
  if (state.busy || state.dirty || state.error || !state.result) return null;
  const assistance = state.assistance;
  if (assistance?.clarification)
    return cityClarificationQuestion(assistance.clarification);
  return (
    assistance?.summary ??
    (state.result.plans.length
      ? `${state.result.plans.length} complete journey ${state.result.plans.length === 1 ? "option is" : "options are"} ready. Check the sources, transfer details and prices before choosing.`
      : "No complete selectable journey is available from the supplied facts. Add an option you checked, change your trip details or recheck the available sources.")
  );
}
