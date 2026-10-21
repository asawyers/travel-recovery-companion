import { Temporal } from '@js-temporal/polyfill'
import type { CostLine } from './schemas.ts'

export const TRIP_TIME_ZONE = 'America/New_York'

/** Offset-free wall time must be clarified before it can become a trip fact. */
export function toInstantMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new RangeError('An ISO timestamp with an explicit offset is required')
  }
  return Temporal.Instant.from(value).epochMilliseconds
}

export function toTripLocalTime(value: string): string {
  return Temporal.Instant.fromEpochMilliseconds(toInstantMillis(value))
    .toZonedDateTimeISO(TRIP_TIME_ZONE).toString({ timeZoneName: 'never' })
}

export function addMinutes(value: string, minutes: number): string {
  if (!Number.isFinite(minutes)) throw new RangeError('Minutes must be finite')
  return toTripLocalTime(Temporal.Instant.fromEpochMilliseconds(toInstantMillis(value)).add({ milliseconds: minutes * 60_000 }).toString())
}

export function minutesBetween(from: string, to: string): number {
  return (toInstantMillis(to) - toInstantMillis(from)) / 60_000
}

export function localDateTimeToOffset(value: string, zone = TRIP_TIME_ZONE): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(value)) {
    throw new RangeError('A local ISO date and time is required')
  }
  return Temporal.PlainDateTime.from(value, { overflow: 'reject' })
    .toZonedDateTime(zone, { disambiguation: 'reject' }).toString({ timeZoneName: 'never' })
}

export function sumCosts(costs: CostLine[]): { knownCostCents: number; priceComplete: boolean; unsupportedCurrency: boolean } {
  for (const cost of costs) {
    if (cost.cents !== null && (!Number.isSafeInteger(cost.cents) || cost.cents < 0)) {
      throw new RangeError('Money must be nonnegative integer cents or null')
    }
  }
  const payable = costs.filter(cost => !cost.includedInOtherCharge)
  const summable = payable.filter(cost => cost.cents !== null && cost.currency === 'USD')
  const knownCostCents = summable.reduce((total, cost) => total + cost.cents!, 0)
  if (!Number.isSafeInteger(knownCostCents)) throw new RangeError('Cost total exceeds safe integer cents')
  return { knownCostCents, priceComplete: summable.length === payable.length, unsupportedCurrency: payable.some(cost => cost.cents !== null && cost.currency !== 'USD') }
}
