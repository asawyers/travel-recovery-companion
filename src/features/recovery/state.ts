import type { TripRequest, RecoveryResult } from "@domain/schemas";
import { toInstantMillis } from "@domain/time";
export type RecoveryStatus =
  | "idle"
  | "validating"
  | "planning"
  | "results"
  | "no_feasible_plan"
  | "partial_results"
  | "error";
export type RecoveryState = {
  status: RecoveryStatus;
  stale: boolean;
  request: TripRequest | null;
  sequence: number;
  result: RecoveryResult | null;
  selectedPlanId: string | null;
  persistence: "unsaved" | "saved";
  error: string | null;
};
export type RecoveryAction =
  | { type: "PLAN_SAVED"; sequence: number; planId: string }
  | { type: "SAVED_PLAN_DELETED" }
  | { type: "RESET" }
  | { type: "INPUT_EDITED" }
  | { type: "REQUEST_STARTED"; request: TripRequest; sequence: number }
  | { type: "RESULT_RECEIVED"; sequence: number; result: RecoveryResult }
  | { type: "REQUEST_FAILED"; sequence: number; message: string }
  | { type: "PLAN_SELECTED"; planId: string; now: string };
export const initialRecoveryState: RecoveryState = {
  status: "idle",
  stale: false,
  request: null,
  sequence: 0,
  result: null,
  selectedPlanId: null,
  persistence: "unsaved",
  error: null,
};
export function recoveryReducer(
  state: RecoveryState,
  action: RecoveryAction,
): RecoveryState {
  switch (action.type) {
    case "PLAN_SAVED":
      return action.sequence === state.sequence &&
        action.planId === state.selectedPlanId &&
        !state.stale &&
        ["results", "partial_results"].includes(state.status)
        ? { ...state, persistence: "saved" }
        : state;
    case "SAVED_PLAN_DELETED":
      return { ...state, persistence: "unsaved" };
    case "RESET":
      return { ...initialRecoveryState, sequence: state.sequence + 1 };
    case "INPUT_EDITED":
      return {
        ...state,
        status: "idle",
        stale: state.result !== null,
        selectedPlanId: null,
        persistence: "unsaved",
        error: null,
        sequence: state.sequence + 1,
      };
    case "REQUEST_STARTED":
      if (action.sequence <= state.sequence) return state;
      return {
        ...state,
        status: "planning",
        stale: state.result !== null,
        selectedPlanId: null,
        persistence: "unsaved",
        error: null,
        sequence: action.sequence,
        request: action.request,
      };
    case "RESULT_RECEIVED":
      if (action.sequence !== state.sequence || state.status !== "planning")
        return state;
      return {
        ...state,
        stale: false,
        result: action.result,
        status: !action.result.plans.length
          ? "no_feasible_plan"
          : action.result.plans.some((p) => !p.priceComplete)
            ? "partial_results"
            : "results",
      };
    case "REQUEST_FAILED":
      return action.sequence === state.sequence
        ? { ...state, status: "error", error: action.message }
        : state;
    case "PLAN_SELECTED": {
      const plan = state.result?.plans.find((p) => p.id === action.planId);
      if (
        state.stale ||
        !["results", "partial_results"].includes(state.status) ||
        !plan?.selectable ||
        (plan.evidenceExpiresAt &&
          toInstantMillis(plan.evidenceExpiresAt) <=
            toInstantMillis(action.now))
      )
        return state;
      return { ...state, selectedPlanId: plan.id, persistence: "unsaved" };
    }
  }
}
