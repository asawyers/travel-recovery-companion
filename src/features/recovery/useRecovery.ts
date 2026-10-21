import { useReducer, useRef, useState } from "react";
import { planRecovery } from "@domain/planner";
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
  const [savedRecord, setSavedRecord] = useState(() =>
    deviceStorage(readSavedSelection, "read"),
  );
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(() =>
    savedRecord.ok ? null : savedRecord.message,
  );
  function edit() {
    setStorageMessage(null);
    sequence.current++;
    dispatch({ type: "INPUT_EDITED" });
  }
  async function compare(request: TripRequest, now: string) {
    setStorageMessage(null);
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
  function save(now: string) {
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
    saved: savedRecord.ok ? savedRecord.value : null,
    storageError,
    storageMessage,
    save,
    deleteSaved,
    edit,
    compare,
    reset: () => {
      setStorageMessage(null);
      sequence.current++;
      dispatch({ type: "RESET" });
    },
    select: (planId: string, now: string) => {
      setStorageMessage(null);
      dispatch({ type: "PLAN_SELECTED", planId, now });
    },
  };
}
