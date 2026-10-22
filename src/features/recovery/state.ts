import type { Assistance } from "@domain/assistance";
import type {
  TripRequest,
  HotelOption,
  RecoveryResult,
  SourceEvidence,
} from "@domain/schemas";
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
  arrivalEvidence: SourceEvidence[];
  assistance: Assistance | null;
  hotelOffers: HotelOption[];
  hotelOffersExpiresAt: string | null;
  hotelBookingOrigin?: string;
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
  | { type: "HOTEL_OFFERS_EXPIRED"; expiresAt: string }
  | { type: "INPUT_EDITED"; reason?: string }
  | { type: "REQUEST_STARTED"; request: TripRequest; sequence: number; preserveComparison?: boolean }
  | { type: "CLARIFICATION_RECEIVED"; sequence: number; assistance: Assistance }
  | {
      type: "RESULT_RECEIVED";
      sequence: number;
      result: RecoveryResult;
      arrivalEvidence?: SourceEvidence[];
      assistance?: Assistance;
      hotelOffers?: HotelOption[];
      factsExpiresAt?: string;
      hotelBookingOrigin?: string;
    }
  | { type: "REQUEST_FAILED"; sequence: number; message: string }
  | { type: "PLAN_SELECTED"; planId: string; now: string };
export const initialRecoveryState: RecoveryState = {
  status: "idle",
  stale: false,
  arrivalEvidence: [],
  assistance: null,
  hotelOffers: [],
  hotelOffersExpiresAt: null,
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
    case "HOTEL_OFFERS_EXPIRED":
      return action.expiresAt === state.hotelOffersExpiresAt
        ? { ...state, hotelOffers: [], hotelOffersExpiresAt: null, hotelBookingOrigin: undefined,
            error: state.stale ? "Source checks expired. Compare again before choosing or saving an itinerary." : state.error }
        : state;
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
        assistance: null,
        ...(action.reason ? { hotelOffers: [], hotelOffersExpiresAt: null, hotelBookingOrigin: undefined } : {}),
        stale: state.result !== null,
        selectedPlanId: null,
        persistence: "unsaved",
        error: action.reason ?? null,
        sequence: state.sequence + 1,
      };
    case "REQUEST_STARTED":
      if (action.sequence <= state.sequence) return state;
      return {
        ...state,
        status: "planning",
        assistance: null,
        stale: action.preserveComparison ? state.stale : state.result !== null,
        selectedPlanId: action.preserveComparison ? state.selectedPlanId : null,
        persistence: action.preserveComparison ? state.persistence : "unsaved",
        error: null,
        sequence: action.sequence,
        request: action.request,
      };
    case "CLARIFICATION_RECEIVED":
      if (action.sequence !== state.sequence || state.status !== "planning") return state;
      return { ...state, stale: false, assistance: action.assistance, request: state.result?.request ?? state.request,
        status: !state.result?.plans.length ? "no_feasible_plan" : state.result.plans.some(plan => !plan.priceComplete) ? "partial_results" : "results" };
    case "RESULT_RECEIVED":
      if (action.sequence !== state.sequence || state.status !== "planning")
        return state;
      return {
        ...state,
        stale: false,
        result: action.result,
        selectedPlanId: null,
        persistence: "unsaved",
        request: action.result.request,
        assistance: action.assistance ?? null,
        hotelOffers: action.hotelOffers ?? [],
        hotelOffersExpiresAt: action.hotelOffers?.length ? action.factsExpiresAt ?? null : null,
        hotelBookingOrigin: action.hotelBookingOrigin,
        arrivalEvidence: action.arrivalEvidence ?? [],
        status: !action.result.plans.length
          ? "no_feasible_plan"
          : action.result.plans.some((p) => !p.priceComplete)
            ? "partial_results"
            : "results",
      };
    case "REQUEST_FAILED":
      return action.sequence === state.sequence && state.status === "planning"
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
