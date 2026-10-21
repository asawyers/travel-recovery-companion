import { useReducer, useRef } from "react";
import { planRecovery } from "@domain/planner";
import type { TripRequest } from "@domain/schemas";
import { initialRecoveryState, recoveryReducer } from "./state";
export function useRecovery() {
  const [state, dispatch] = useReducer(recoveryReducer, initialRecoveryState);
  const sequence = useRef(0);
  function edit() {
    sequence.current++;
    dispatch({ type: "INPUT_EDITED" });
  }
  async function compare(request: TripRequest, now: string) {
    const current = ++sequence.current;
    dispatch({ type: "REQUEST_STARTED", request, sequence: current });
    try {
      // One boundary for the future Edge planner; domain arithmetic remains shared.
      const result = await Promise.resolve().then(() =>
        planRecovery(request, request.confirmedOptions, { now }),
      );
      dispatch({ type: "RESULT_RECEIVED", sequence: current, result });
    } catch {
      dispatch({
        type: "REQUEST_FAILED",
        sequence: current,
        message:
          "Comparison failed. Your inputs are retained; check the supplied facts and try again.",
      });
    }
  }
  return {
    state,
    edit,
    compare,
    reset: () => {
      sequence.current++;
      dispatch({ type: "RESET" });
    },
    select: (planId: string, now: string) =>
      dispatch({ type: "PLAN_SELECTED", planId, now }),
  };
}
