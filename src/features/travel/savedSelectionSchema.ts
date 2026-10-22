import { z } from 'zod'
import { CitySchema } from '@domain/city-contracts'
import { FlightOfferSchema, NationalHotelOfferSchema, TravelJourneySchema, TravelRecoveryResponseSchema, TravelRequestBindingSchema } from '@domain/travel-contracts'
import { composeTravelJourney } from '@domain/travel-planner'
import { toInstantMillis } from '@domain/time'
import { GOOGLE_SAVE_MESSAGE } from '../recovery/providerRetention'

/** Google Travel inventory is distinct from Google Maps route content. */
export function containsTravelGoogleMaps(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsTravelGoogleMaps)
  if (value && typeof value === 'object') return Object.values(value).some(containsTravelGoogleMaps)
  if (typeof value !== 'string') return false
  if (value === 'Google Maps Routes API') return true
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '')
    const googleHost = /(?:^|\.)google\.(?:[a-z]{2,}|(?:co|com)\.[a-z]{2})$/.test(host)
    const mapsPath = /^\/maps(?:\/|$)/.test(url.pathname)
    return host === 'routes.googleapis.com' || host === 'maps.googleapis.com' ||
      host === 'maps.app.goo.gl' || (host === 'goo.gl' && mapsPath) ||
      (googleHost && (/(?:^|\.)maps\.google\./.test(host) || mapsPath))
  } catch { return false }
}

/** Validity is evaluated at the original selection time, so expired history stays readable. */
export const TravelSavedSelectionSchema = z.strictObject({
  schemaVersion: z.literal(3),
  request: TravelRequestBindingSchema,
  origin: CitySchema,
  destination: CitySchema,
  generatedAt: TravelRecoveryResponseSchema.shape.generatedAt,
  expiresAt: TravelRecoveryResponseSchema.shape.expiresAt,
  selectedAt: TravelRecoveryResponseSchema.shape.generatedAt,
  selectedFlight: FlightOfferSchema,
  selectedHotel: NationalHotelOfferSchema.nullable(),
  journey: TravelJourneySchema,
}).superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (containsTravelGoogleMaps(value)) issue(GOOGLE_SAVE_MESSAGE)
  const response = TravelRecoveryResponseSchema.safeParse({
    version: 3, request: value.request, origin: value.origin, destination: value.destination,
    generatedAt: value.generatedAt, expiresAt: value.expiresAt,
    flightOffers: [value.selectedFlight], hotelOffers: value.selectedHotel ? [value.selectedHotel] : [],
    sourceStatuses: [], journey: value.journey, selectionIssue: null, warnings: [],
  })
  if (!response.success) issue('Saved journey must preserve the selected source quotes and exact request binding.')
  if (!value.journey.selectable || !value.request.selection) issue('Only a complete eligible selected journey can be saved.')
  try {
    const selected = toInstantMillis(value.selectedAt)
    if (selected < toInstantMillis(value.generatedAt)) issue('Selection cannot precede the original comparison.')
    if (response.success && value.request.selection) {
      const expected = composeTravelJourney(value.request, value.selectedFlight, value.selectedHotel, { origin: value.origin, destination: value.destination, now: value.selectedAt })
      if (!expected.selectable || JSON.stringify(expected) !== JSON.stringify(value.journey)) issue('Saved journey must preserve the complete original assessment and remain feasible at selection.')
    }
  } catch { issue('Cannot validate the original selection times and journey facts.') }
})
export type TravelSavedSelection = z.infer<typeof TravelSavedSelectionSchema>
