import { TravelSavedSelectionSchema } from "../travel/savedSelectionSchema";
import { CitySavedSelectionSchema } from "@domain/city-contracts";
import type {
  CityRecoveryResult,
  CitySavedSelection,
  CityTripRequest,
} from "@domain/city-contracts";
import {
  SavedSelectionSchema,
  SAVED_PLAN_KEY,
} from "../recovery/savedSelection";
import type {
  SavedSelection,
  SelectionStorage,
  StorageResult,
} from "../recovery/savedSelection";
import { GOOGLE_SAVE_MESSAGE } from "../recovery/providerRetention";

export type CityHistory = SavedSelection | CitySavedSelection;
const MAX = 2_000_000;
export function containsCityGoogle(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCityGoogle);
  if (value && typeof value === "object")
    return Object.values(value).some(containsCityGoogle);
  if (typeof value !== "string") return false;
  if (value === "Google Maps Routes API") return true;
  try {
    const url = new URL(value),
      host = url.hostname.toLowerCase();
    return (
      host === "routes.googleapis.com" ||
      host === "maps.googleapis.com" ||
      host === "maps.google.com" ||
      host.endsWith(".maps.google.com") ||
      ((host === "google.com" || host.endsWith(".google.com")) &&
        url.pathname.startsWith("/maps"))
    );
  } catch {
    return false;
  }
}
export function readCityHistory(
  storage: SelectionStorage,
): StorageResult<CityHistory | null> {
  try {
    const raw = storage.getItem(SAVED_PLAN_KEY);
    if (raw === null) return { ok: true, value: null };
    if (raw.length > MAX) throw Error();
    const data: unknown = JSON.parse(raw);
    if (TravelSavedSelectionSchema.safeParse(data).success) return { ok: true, value: null };
    const city = CitySavedSelectionSchema.safeParse(data);
    if (city.success) return { ok: true, value: city.data };
    const legacy = SavedSelectionSchema.safeParse(data);
    if (legacy.success) return { ok: true, value: legacy.data };
    return {
      ok: false,
      message:
        "The saved plan is invalid or uses an unsupported version. Delete it explicitly before saving a new selection.",
    };
  } catch {
    return {
      ok: false,
      message:
        "Cannot safely read the saved plan. Browser storage may be blocked or the record invalid. Delete it explicitly when storage is available before saving a new selection.",
    };
  }
}
export function citySnapshot(
  result: CityRecoveryResult,
  planId: string,
  selectedAt: string,
): StorageResult<CitySavedSelection> {
  const plan = result.plans.find((p) => p.id === planId);
  if (!plan?.selectable)
    return { ok: false, message: "Choose a current itinerary before saving." };
  if (containsCityGoogle(plan))
    return { ok: false, message: GOOGLE_SAVE_MESSAGE };
  const request = {
    ...result.request,
    confirmedOptions: result.request.confirmedOptions.filter(
      (option) => !containsCityGoogle(option),
    ),
  };
  const parsed = CitySavedSelectionSchema.safeParse({
    schemaVersion: 2,
    request,
    plan,
    origin: result.origin,
    destination: result.destination,
    generatedAt: result.generatedAt,
    selectedAt,
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        message:
          "Cannot save invalid or expired trip facts. Recheck the itinerary and select it again.",
      };
}
export function writeCitySelection(
  storage: SelectionStorage,
  value: CitySavedSelection,
): StorageResult<CitySavedSelection> {
  const parsed = CitySavedSelectionSchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      message: containsCityGoogle(value)
        ? GOOGLE_SAVE_MESSAGE
        : "Cannot save invalid or expired trip facts. Compare again.",
    };
  const existing = readCityHistory(storage);
  if (!existing.ok) return existing;
  try {
    const raw = JSON.stringify(parsed.data);
    if (raw.length > MAX) throw Error();
    storage.setItem(SAVED_PLAN_KEY, raw);
    return { ok: true, value: parsed.data };
  } catch {
    return {
      ok: false,
      message:
        "Cannot save to this device. Browser storage may be blocked or full. Your current trip is retained.",
    };
  }
}
/** Preserve every original manual check timestamp; refreshing never reconfirms it. */
export function refreshCityRequest(saved: CitySavedSelection): CityTripRequest {
  return structuredClone(saved.request);
}
