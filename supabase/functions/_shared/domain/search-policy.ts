import type { TripRequest } from './schemas.ts'
import { addMinutes } from './time.ts'

/** Bounds lookup coverage for ASAP requests without creating a traveler deadline. */
export function searchEndAt(request: Pick<TripRequest, 'arrivalAt' | 'deadlineAt'>): string {
  return request.deadlineAt ?? addMinutes(request.arrivalAt, 1440)
}
