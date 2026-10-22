import { CitySavedSelectionSchema, type CitySavedSelection } from '@domain/city-contracts'
import { TravelRecoveryResponseSchema, type TravelRecoveryResponse, type TravelRequestBinding } from '@domain/travel-contracts'
import { SavedSelectionSchema, SAVED_PLAN_KEY, type SavedSelection, type SelectionStorage, type StorageResult } from '../recovery/savedSelection'
import { GOOGLE_SAVE_MESSAGE } from '../recovery/providerRetention'
import { containsTravelGoogleMaps, TravelSavedSelectionSchema, type TravelSavedSelection } from './savedSelectionSchema'
export { TravelSavedSelectionSchema, type TravelSavedSelection } from './savedSelectionSchema'
export type TravelHistory = SavedSelection | CitySavedSelection | TravelSavedSelection
const MAX = 2_000_000
const invalid = 'The saved plan is invalid or uses an unsupported version. Delete it explicitly before saving a new selection.'
export function readTravelHistory(storage: SelectionStorage): StorageResult<TravelHistory | null> {
  try {
    const raw = storage.getItem(SAVED_PLAN_KEY)
    if (raw === null) return { ok: true, value: null }
    if (raw.length > MAX) return { ok: false, message: invalid }
    const data: unknown = JSON.parse(raw)
    const travel = TravelSavedSelectionSchema.safeParse(data)
    if (travel.success) return { ok: true, value: travel.data }
    const city = CitySavedSelectionSchema.safeParse(data)
    if (city.success) return { ok: true, value: city.data }
    const legacy = SavedSelectionSchema.safeParse(data)
    if (legacy.success) return { ok: true, value: legacy.data }
    return { ok: false, message: invalid }
  } catch {
    return { ok: false, message: 'Cannot safely read the saved plan. Browser storage may be blocked or the record invalid. Delete it explicitly when storage is available before saving a new selection.' }
  }
}
export function travelSnapshot(response: TravelRecoveryResponse, selectedAt: string): StorageResult<TravelSavedSelection> {
  const valid = TravelRecoveryResponseSchema.safeParse(response)
  if (!valid.success || !valid.data.journey?.selectable || !valid.data.request.selection) return { ok: false, message: 'Choose a complete current journey after comparing your latest trip details before saving.' }
  const r = valid.data, selection = r.request.selection!
  const parsed = TravelSavedSelectionSchema.safeParse({
    schemaVersion: 3, request: r.request, origin: r.origin, destination: r.destination,
    generatedAt: r.generatedAt, expiresAt: r.expiresAt, selectedAt,
    selectedFlight: r.flightOffers.find(f => f.id === selection.flightOfferId),
    selectedHotel: selection.hotelOfferId === null ? null : r.hotelOffers.find(h => h.id === selection.hotelOfferId),
    journey: r.journey,
  })
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: containsTravelGoogleMaps(response) ? GOOGLE_SAVE_MESSAGE : 'Cannot save invalid or expired journey facts. Search again and recheck your selection.' }
}
export function writeTravelSelection(storage: SelectionStorage, value: TravelSavedSelection): StorageResult<TravelSavedSelection> {
  const parsed = TravelSavedSelectionSchema.safeParse(value)
  if (!parsed.success) return { ok: false, message: containsTravelGoogleMaps(value) ? GOOGLE_SAVE_MESSAGE : 'Cannot save invalid or expired journey facts. Compare again.' }
  const existing = readTravelHistory(storage)
  if (!existing.ok) return existing
  try {
    const raw = JSON.stringify(parsed.data)
    if (raw.length > MAX) throw Error('Snapshot too large')
    storage.setItem(SAVED_PLAN_KEY, raw)
    return { ok: true, value: parsed.data }
  } catch { return { ok: false, message: 'Cannot save to this device. Browser storage may be blocked or full. Your previous saved plan is retained.' } }
}
/** Explicit refresh keeps original dates and facts; the parent initiates the comparison. */
export function refreshTravelRequest(saved: TravelSavedSelection): TravelRequestBinding { return structuredClone(saved.request) }
