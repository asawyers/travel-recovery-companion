import { describe, expect, it } from 'vitest'
import { addMinutes, localDateTimeToOffset, minutesBetween, sumCosts, toInstantMillis, toTripLocalTime } from '@domain/time'

describe('offset time and money', () => {
  it('requires an explicit offset and rejects invalid calendar dates', () => {
    for (const value of ['2026-11-18T08:00:00', '2026-02-30T08:00:00-05:00', 'garbage']) {
      expect(() => toInstantMillis(value)).toThrow()
    }
    expect(toInstantMillis('2026-11-18T08:00:00-05:00')).toBe(1795006800000)
  })
  it('rejects DST gaps and folds so the traveler must clarify', () => {
    expect(() => localDateTimeToOffset('2026-03-08T02:30')).toThrow()
    expect(() => localDateTimeToOffset('2026-11-01T01:30')).toThrow()
    expect(localDateTimeToOffset('2026-11-18T08:00')).toBe('2026-11-18T08:00:00-05:00')
  })
  it('adds elapsed minutes across DST and returns trip-local offset timestamps', () => {
    expect(addMinutes('2026-03-08T01:45:00-05:00', 30)).toBe('2026-03-08T03:15:00-04:00')
    expect(minutesBetween('2026-11-18T08:00:00-05:00', '2026-11-18T12:50:00-05:00')).toBe(290)
    expect(toTripLocalTime('2026-11-18T13:00:00Z')).toBe('2026-11-18T08:00:00-05:00')
    expect(() => addMinutes('2026-11-18T08:00:00-05:00', Infinity)).toThrow()
    expect(() => localDateTimeToOffset('2026-02-30T08:00')).toThrow()
  })
  it('preserves unknown prices and sums only payable known USD without converting currencies', () => {
    const line = (cents: number | null, currency = 'USD', includedInOtherCharge = false) => ({ label: 'Fare', cents, currency, includedInOtherCharge })
    expect(sumCosts([line(0)])).toEqual({ knownCostCents: 0, priceComplete: true, unsupportedCurrency: false })
    expect(sumCosts([line(1200), line(null), line(500, 'EUR'), line(100, 'USD', true)])).toEqual({ knownCostCents: 1200, priceComplete: false, unsupportedCurrency: true })
    expect(sumCosts([line(null, 'USD', true)])).toEqual({ knownCostCents: 0, priceComplete: true, unsupportedCurrency: false })
    expect(() => sumCosts([line(-1)])).toThrow()
  })
})
