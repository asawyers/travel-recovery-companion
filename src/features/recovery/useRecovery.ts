import { useEffect, useReducer, useRef, useState } from "react";
import { planRecovery } from "@domain/planner";
import { toInstantMillis } from "@domain/time";
import { ADAPTER_REVISION } from "@domain/api";
import { comparePublic, PublicPlannerError, recoveryEndpoint } from "@/lib/api";
import { buildReuseKey, canReuseFacts } from "./refinement";
import type { TabFactsCache } from "./refinement";
import type { TripRequest } from "@domain/schemas";
import {
  clearSavedSelection,
  readSavedSelection,
  selectionSnapshot,
  writeSavedSelection,
} from "./savedSelection";
import type { SelectionStorage, StorageResult } from "./savedSelection";
import { initialRecoveryState, recoveryReducer } from "./state";
function deviceStorage<T>(
  operation: (storage: SelectionStorage) => StorageResult<T>,
  action: "read" | "save" | "delete",
): StorageResult<T> {
  try {
    return operation(window.localStorage);
  } catch {
    return {
      ok: false,
      message: `Cannot ${action} the saved plan: browser storage is unavailable. Allow storage and retry. Your current trip is retained.`,
    };
  }
}
export function useRecovery() {
  const [state, dispatch] = useReducer(recoveryReducer, initialRecoveryState);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const cache = useRef<TabFactsCache | null>(null);
  const acceptedInput = useRef<TripRequest | null>(null);
  const cachedWarnings = useRef<string[]>([]);
  const configured = !!import.meta.env.VITE_RECOVERY_API_URL?.trim();
  useEffect(
    () => () => {
      sequence.current++;
      pending.current?.abort();
      cache.current = null;
    },
    [],
  );
  const [savedRecord, setSavedRecord] = useState(() =>
    deviceStorage(readSavedSelection, "read"),
  );
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(() =>
    savedRecord.ok ? null : savedRecord.message,
  );
  function invalidate(priorityOnly = false) {
    sequence.current++;
    pending.current?.abort();
    pending.current = null;
    if (!priorityOnly) {
      cache.current = null;
      acceptedInput.current = null;
      cachedWarnings.current = [];
    }
  }
  useEffect(() => {
    const accepted = cache.current;
    if (
      !accepted ||
      state.stale ||
      !["results", "partial_results", "no_feasible_plan"].includes(state.status)
    )
      return;
    const current = sequence.current;
    const timer = window.setTimeout(
      () => {
        if (sequence.current !== current) return;
        invalidate();
        setStorageMessage(null);
        dispatch({
          type: "INPUT_EDITED",
          reason:
            "Source checks expired. Compare again before choosing or saving an itinerary.",
        });
      },
      Math.max(0, toInstantMillis(accepted.facts.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [state.result, state.status, state.stale]);
  // Offer expiry survives draft edits, which intentionally discard comparison reuse.
  useEffect(() => {
    const expiresAt = state.hotelOffersExpiresAt;
    if (!expiresAt) return;
    const timer = window.setTimeout(() => dispatch({ type: "HOTEL_OFFERS_EXPIRED", expiresAt }), Math.max(0, toInstantMillis(expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state.hotelOffersExpiresAt]);
  function expireFacts() {
    invalidate();
    setStorageMessage(null);
    dispatch({
      type: "INPUT_EDITED",
      reason:
        "Source checks expired. Compare again before choosing or saving an itinerary.",
    });
  }
  function currentFactsExpired() {
    return (
      cache.current !== null &&
      (!acceptedInput.current ||
        !canReuseFacts(
          cache.current,
          acceptedInput.current,
          Date.now(),
          ADAPTER_REVISION,
        ))
    );
  }
  function edit(priorityOnly = false) {
    setStorageMessage(null);
    invalidate(priorityOnly);
    dispatch({ type: "INPUT_EDITED" });
  }
  async function compare(
    request: TripRequest,
    now: string,
    investigate = false,
    refinement?: string,
  ) {
    setStorageMessage(null);
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = ++sequence.current;
    const isCurrent = () =>
      current === sequence.current && !controller.signal.aborted;
    dispatch({ type: "REQUEST_STARTED", request, sequence: current });
    try {
      const endpoint = recoveryEndpoint(import.meta.env.VITE_RECOVERY_API_URL);
      if (
        endpoint &&
        !investigate &&
        !refinement?.trim() &&
        canReuseFacts(cache.current, request, Date.now(), ADAPTER_REVISION)
      ) {
        const facts = cache.current!.facts;
        const result = planRecovery(
          { ...request, ...facts.arrival, confirmedOptions: facts.candidates },
          facts.candidates,
          { now },
        );
        result.warnings = [
          ...new Set([...result.warnings, ...cachedWarnings.current]),
        ];
        if (isCurrent())
          dispatch({
            type: "RESULT_RECEIVED",
            sequence: current,
            result,
            arrivalEvidence: facts.arrivalEvidence,
            hotelOffers: facts.hotelOffers,
            factsExpiresAt: facts.expiresAt,
            hotelBookingOrigin: facts.hotelBookingOrigin,
          });
      } else if (endpoint) {
        cache.current = null;
        const response = await comparePublic(
          endpoint,
          request,
          investigate,
          controller.signal,
          refinement,
        );
        if (!isCurrent()) return;
        // Preserve manual/source input identity; provider candidates belong only to normalized facts.
        acceptedInput.current = { ...request, priority: response.result.request.priority, drivingAllowed: response.result.request.drivingAllowed };
        cache.current = {
          inputKey: buildReuseKey(acceptedInput.current, ADAPTER_REVISION),
          facts: response.facts,
        };
        cachedWarnings.current = response.result.warnings;
        dispatch({
          type: "RESULT_RECEIVED",
          sequence: current,
          result: response.result,
          arrivalEvidence: response.facts.arrivalEvidence,
          assistance: response.assistance,
          hotelOffers: response.facts.hotelOffers,
          factsExpiresAt: response.facts.expiresAt,
          hotelBookingOrigin: response.facts.hotelBookingOrigin,
        });
      } else {
        const result = await Promise.resolve().then(() =>
          planRecovery(request, request.confirmedOptions, { now }),
        );
        if (request.hotelDataMode === "sandbox") result.warnings.push("Hotel sandbox unavailable: the public planner is not configured. No hotel rates or live availability were checked. Fictional supplied inputs were compared locally.");
        if (isCurrent())
          dispatch({ type: "RESULT_RECEIVED", sequence: current, result,
            ...(refinement?.trim() ? { assistance: { status: "unavailable", summary: "Assisted refinement is unavailable because the public planner is not configured. Use the priority and driving controls to refine supplied facts.", appliedPreferences: {}, selectedPlanId: null, activity: [] } as const } : {}),
          });
      }
    } catch (error) {
      if (!isCurrent()) return;
      cache.current = null;
      dispatch({
        type: "REQUEST_FAILED",
        sequence: current,
        message:
          error instanceof PublicPlannerError
            ? error.message
            : "Comparison failed. Your inputs are retained; check the supplied facts and retry.",
      });
    } finally {
      if (isCurrent()) pending.current = null;
    }
  }
  function save(now: string) {
    if (sequence.current !== state.sequence) {
      setStorageMessage(null);
      return;
    }
    if (currentFactsExpired()) {
      expireFacts();
      return;
    }
    const snapshot = selectionSnapshot(state, now, new Date().toISOString());
    const stored = snapshot.ok
      ? deviceStorage(
          (storage) => writeSavedSelection(storage, snapshot.value),
          "save",
        )
      : snapshot;
    setStorageMessage(null);
    if (!stored.ok) {
      setStorageError(stored.message);
      return;
    }
    setSavedRecord(stored);
    setStorageError(null);
    setStorageMessage(
      "Saved on this device. No tickets or reservations have been purchased.",
    );
    dispatch({
      type: "PLAN_SAVED",
      sequence: state.sequence,
      planId: stored.value.plan.id,
    });
  }
  function deleteSaved() {
    const cleared = deviceStorage(clearSavedSelection, "delete");
    setStorageMessage(null);
    if (!cleared.ok) {
      setStorageError(cleared.message);
      return;
    }
    setSavedRecord(cleared);
    setStorageError(null);
    setStorageMessage("Saved plan deleted from this device.");
    dispatch({ type: "SAVED_PLAN_DELETED" });
  }
  return {
    state,
    configured,
    saved: savedRecord.ok ? savedRecord.value : null,
    storageError,
    storageMessage,
    save,
    deleteSaved,
    edit,
    compare,
    expireOffers: () => {
      if (state.hotelOffersExpiresAt) dispatch({ type: "HOTEL_OFFERS_EXPIRED", expiresAt: state.hotelOffersExpiresAt });
    },
    reset: () => {
      setStorageMessage(null);
      invalidate();
      dispatch({ type: "RESET" });
    },
    select: (planId: string, now: string) => {
      if (currentFactsExpired()) {
        expireFacts();
        return;
      }
      setStorageMessage(null);
      dispatch({ type: "PLAN_SELECTED", planId, now });
    },
  };
}
