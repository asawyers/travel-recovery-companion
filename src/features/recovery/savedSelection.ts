import { z } from "zod";
import {
  RecoveryPlanSchema,
  TripRequestSchema,
  RecoveryResultSchema,
} from "@domain/schemas";
import type { TripRequest } from "@domain/schemas";
import { toInstantMillis } from "@domain/time";
import type { RecoveryState } from "./state";

export const SAVED_PLAN_KEY = "travel-recovery:selected:v1";
const MAX_SNAPSHOT_LENGTH = 2_000_000;
export const SavedSelectionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    request: TripRequestSchema,
    plan: RecoveryPlanSchema,
    generatedAt: RecoveryResultSchema.shape.generatedAt,
    selectedAt: RecoveryResultSchema.shape.generatedAt,
  })
  .superRefine((value, ctx) => {
    const evidence = [
      ...value.plan.legs.flatMap((leg) => leg.evidence),
      ...(value.plan.hotel?.evidence ?? []),
    ];
    if (
      evidence.some((e) =>
        value.request.mode === "real"
          ? e.environment !== "production" || e.type === "synthetic"
          : e.environment === "production",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["plan"],
        message: "Saved evidence must match the request mode.",
      });
    }
  });
export type SavedSelection = z.infer<typeof SavedSelectionSchema>;
export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };
export type SelectionStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
const invalid =
  "The saved plan is invalid or uses an unsupported version. Delete the saved plan, then retry saving your current selection.";
export function readSavedSelection(
  storage: SelectionStorage,
): StorageResult<SavedSelection | null> {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_PLAN_KEY);
  } catch {
    return {
      ok: false,
      message:
        "Cannot read this device's storage. Allow browser storage and retry, or delete the saved plan when storage is available.",
    };
  }
  if (raw === null) return { ok: true, value: null };
  try {
    if (raw.length > MAX_SNAPSHOT_LENGTH)
      return { ok: false, message: invalid };
    const parsed = SavedSelectionSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, message: invalid };
  } catch {
    return { ok: false, message: invalid };
  }
}
export function writeSavedSelection(
  storage: SelectionStorage,
  value: SavedSelection,
): StorageResult<SavedSelection> {
  const parsed = SavedSelectionSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Cannot save this selection because its trip or itinerary is invalid. Compare again and retry.",
    };
  try {
    const raw = JSON.stringify(parsed.data);
    if (raw.length > MAX_SNAPSHOT_LENGTH)
      return {
        ok: false,
        message:
          "Cannot save this itinerary: it is too large for device storage. Your current trip is retained.",
      };
    storage.setItem(SAVED_PLAN_KEY, raw);
    return { ok: true, value: parsed.data };
  } catch {
    return {
      ok: false,
      message:
        "Cannot save to this device's storage. Storage may be blocked or full. Allow storage or free space, then retry; your current trip is retained.",
    };
  }
}
export function clearSavedSelection(
  storage: SelectionStorage,
): StorageResult<null> {
  try {
    storage.removeItem(SAVED_PLAN_KEY);
    return { ok: true, value: null };
  } catch {
    return {
      ok: false,
      message:
        "Cannot delete the saved plan from device storage. Allow browser storage and retry. The saved plan has not been deleted.",
    };
  }
}
export function selectionSnapshot(
  state: RecoveryState,
  now: string,
  selectedAt: string,
): StorageResult<SavedSelection> {
  const plan = state.result?.plans.find((p) => p.id === state.selectedPlanId);
  if (
    !state.result ||
    !state.request ||
    state.stale ||
    !["results", "partial_results"].includes(state.status) ||
    !plan?.selectable
  ) {
    return {
      ok: false,
      message:
        "Choose a current itinerary after comparing your latest trip details before saving.",
    };
  }
  const parsed = SavedSelectionSchema.safeParse({
    schemaVersion: 1,
    request: state.result.request,
    plan,
    generatedAt: state.result.generatedAt,
    selectedAt,
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Cannot save invalid trip facts. Compare again before saving.",
    };
  const expiries = [
    plan.evidenceExpiresAt,
    plan.hotel?.quoteExpiresAt,
    ...plan.legs.flatMap((leg) => leg.evidence.map((e) => e.expiresAt)),
    ...(plan.hotel?.evidence.map((e) => e.expiresAt) ?? []),
  ];
  try {
    if (
      expiries.some(
        (expiry) => expiry && toInstantMillis(expiry) <= toInstantMillis(now),
      )
    ) {
      return {
        ok: false,
        message:
          "This itinerary's evidence expired. Refresh and recheck the facts before saving a new selection.",
      };
    }
  } catch {
    return {
      ok: false,
      message: "Cannot verify evidence times. Compare again before saving.",
    };
  }
  return { ok: true, value: parsed.data };
}
/** A new comparison must not turn an old provider check into a fresh claim. */
export function refreshRequest(saved: SavedSelection): TripRequest {
  const request = structuredClone(saved.request);
  function invalidateProviderFacts(value: unknown): void {
    if (Array.isArray(value)) value.forEach(invalidateProviderFacts);
    else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === "live" || record.type === "schedule") {
        const expiry = record.expiresAt;
        if (
          typeof expiry !== "string" ||
          toInstantMillis(expiry) > toInstantMillis(saved.generatedAt)
        )
          record.expiresAt = saved.generatedAt;
      }
      Object.values(record).forEach(invalidateProviderFacts);
    }
  }
  if (request.mode === "real")
    invalidateProviderFacts(request.confirmedOptions);
  return request;
}
