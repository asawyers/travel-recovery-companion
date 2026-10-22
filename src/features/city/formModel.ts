import { Temporal } from "@js-temporal/polyfill";
import { CityTripRequestSchema } from "@domain/city-contracts";
import type {
  City,
  CityCandidate,
  CityTripRequest,
} from "@domain/city-contracts";

export type CityDraft = {
  origin: City | null;
  destination: City | null;
  goal: "asap" | "deadline";
  readyLocal: string;
  readyAt: string | null;
  deadlineLocal: string;
  budget: string;
  budgetMode: "soft" | "hard";
  drivingAllowed: boolean;
  priority: CityTripRequest["priority"];
};
export type CityFormErrors = Partial<
  Record<"origin" | "destination" | "readyAt" | "deadlineAt" | "budget", string>
>;
export const emptyCityDraft = (): CityDraft => ({
  origin: null,
  destination: null,
  goal: "asap",
  readyLocal: "",
  readyAt: null,
  deadlineLocal: "",
  budget: "",
  budgetMode: "soft",
  drivingAllowed: false,
  priority: "earliest",
});
export function localToOffset(local: string, timeZone: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local))
    throw new RangeError("Enter a complete local date and time.");
  return Temporal.PlainDateTime.from(local, { overflow: "reject" })
    .toZonedDateTime(timeZone, { disambiguation: "reject" })
    .toString({
      timeZoneName: "never",
      calendarName: "never",
      smallestUnit: "second",
    });
}
export function cityLocalInput(instant: string, timeZone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function buildCityRequest(
  draft: CityDraft,
  now: string,
  confirmedOptions: CityCandidate[] = [],
): { request?: CityTripRequest; errors: CityFormErrors } {
  const errors: CityFormErrors = {};
  if (!draft.origin)
    errors.origin = "Choose a From city from the search results.";
  if (!draft.destination)
    errors.destination = "Choose a To city from the search results.";
  if (draft.origin && draft.origin.id === draft.destination?.id)
    errors.destination = "Choose a different destination city.";
  let readyAt = draft.readyAt ?? now,
    deadlineAt: string | null = null;
  try {
    if (draft.readyLocal && draft.origin)
      readyAt = localToOffset(draft.readyLocal, draft.origin.timeZone);
    Temporal.Instant.from(readyAt);
  } catch {
    errors.readyAt =
      "Enter a valid, unambiguous leaving time in the origin time zone. Daylight saving gaps and repeated hours need another time.";
  }
  if (draft.goal === "deadline") {
    try {
      if (!draft.destination) throw Error();
      deadlineAt = localToOffset(
        draft.deadlineLocal,
        draft.destination.timeZone,
      );
      if (Temporal.Instant.compare(deadlineAt, readyAt) <= 0) throw Error();
    } catch {
      errors.deadlineAt =
        "Enter a valid, unambiguous arrival deadline after your leaving time, in the destination time zone.";
    }
  }
  let budgetCents: number | null = null;
  if (draft.budget.trim()) {
    if (
      !/^\d+(\.\d{1,2})?$/.test(draft.budget) ||
      Number(draft.budget) > 1_000_000
    )
      errors.budget =
        "Enter a USD budget from 0 to 1,000,000 with up to two decimals.";
    else budgetCents = Math.round(Number(draft.budget) * 100);
  }
  if (Object.keys(errors).length || !draft.origin || !draft.destination)
    return { errors };
  const parsed = CityTripRequestSchema.safeParse({
    version: 2,
    mode: "real",
    originCityId: draft.origin.id,
    destinationCityId: draft.destination.id,
    readyAt,
    deadlineAt,
    budgetCents,
    budgetMode: draft.budgetMode,
    drivingAllowed: false,
    priority: draft.priority,
    confirmedOptions,
  });
  return parsed.success
    ? { request: parsed.data, errors }
    : {
        errors: {
          origin:
            "Trip facts are invalid. Choose your cities and confirm the details again.",
        },
      };
}
export function draftFromCityRequest(
  request: CityTripRequest,
  origin: City,
  destination: City,
): CityDraft {
  return {
    origin,
    destination,
    goal: request.deadlineAt ? "deadline" : "asap",
    readyLocal: "",
    readyAt: request.readyAt,
    deadlineLocal: request.deadlineAt
      ? cityLocalInput(request.deadlineAt, destination.timeZone)
      : "",
    budget:
      request.budgetCents === null ? "" : String(request.budgetCents / 100),
    budgetMode: request.budgetMode,
    drivingAllowed: false,
    priority: request.priority,
  };
}
