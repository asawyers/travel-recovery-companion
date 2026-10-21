import { z } from "zod";
import {
  TripRequestSchema,
  TransitOptionSchema,
  CarOptionSchema,
} from "@domain/schemas";
import type {
  TripRequest,
  ConfirmedOption,
  SourceEvidence,
  TransferInput,
} from "@domain/schemas";
import {
  localDateTimeToOffset,
  addMinutes,
  toTripLocalTime,
} from "@domain/time";

export type Draft = ReturnType<typeof emptyDraft>;
export const emptyDraft = () => ({
  arrivalAt: "",
  originalDepartureAt: "",
  deadlineAt: "",
  budget: "",
  budgetMode: "soft" as TripRequest["budgetMode"],
  priority: "earliest" as TripRequest["priority"],
  drivingAllowed: true,
  overnightAllowed: false,
  airportExitMinutes: "45",
  originalAccessMinutes: "30",
  originalBoardingMinutes: "15",
  checkin: "",
  checkout: "",
  guestNationality: "",
  transit: {
    enabled: false,
    kind: "bus" as "bus" | "train",
    title: "",
    departure: "",
    arrival: "",
    fare: "",
    departureTerminal: "",
    arrivalTerminal: "",
    accessMinutes: "",
    accessCost: "",
    finalMinutes: "",
    finalCost: "",
    boardingMinutes: "15",
    accessKind: "transfer" as "transfer" | "walk",
    finalKind: "transfer" as "transfer" | "walk",
    accessVehicle: "",
    finalVehicle: "",
    estimated: false,
    checkedAt: "",
  },
  car: {
    enabled: false,
    title: "",
    pickup: "",
    dropoff: "",
    accessMinutes: "",
    accessCost: "",
    pickupMinutes: "",
    driveMinutes: "",
    returnMinutes: "",
    walkMinutes: "",
    rental: "",
    fees: "",
    fuel: "",
    tolls: "",
    other: "",
    pickupConfirmed: false,
    returnConfirmed: false,
    checkedAt: "",
  },
});
export type FormErrors = Record<string, string>;
const amount = z
  .string()
  .regex(
    /^\d+(\.\d{1,2})?$/,
    "Use a nonnegative USD amount with at most two decimal places",
  )
  .transform((v) => Math.round(Number(v) * 100))
  .pipe(z.number().int().max(100_000_000));
const minute = z
  .string()
  .regex(/^\d+$/, "Use whole minutes, 0 or more")
  .transform(Number)
  .pipe(z.number().int().min(0).max(10_080));
const label = z.string().trim().min(1, "Enter this fact").max(500);
class OptionalFactError extends Error {}

function omissionCause(error: unknown, fallback: string): string {
  if (error instanceof OptionalFactError) return error.message;
  // Only expose known, user-facing schema messages, never serialized Zod errors.
  if (error instanceof z.ZodError) {
    if (
      error.issues.some(
        (issue) => issue.message === "Transit arrival must follow departure",
      )
    ) {
      return "Transit arrival must follow departure. Correct the entered service times.";
    }
    if (
      error.issues.some(
        (issue) => issue.message === "Use whole minutes, 0 or more",
      )
    ) {
      return "Enter whole-minute allowances from 0 to 10,080.";
    }
  }
  if (error instanceof RangeError) {
    return "Enter valid, unambiguous America/New_York dates and times; daylight-saving gaps and repeated local times need clarification.";
  }
  return fallback;
}

export const localInput = (at: string) =>
  toTripLocalTime(at).replace(/(?:Z|[+-]\d{2}:\d{2})$/, "");
export function draftFromRequest(r: TripRequest): Draft {
  const draft: Draft = {
    ...emptyDraft(),
    arrivalAt: localInput(r.arrivalAt),
    originalDepartureAt: localInput(r.originalDepartureAt),
    deadlineAt: localInput(r.deadlineAt),
    budget: r.budgetCents === null ? "" : String(r.budgetCents / 100),
    budgetMode: r.budgetMode,
    priority: r.priority,
    drivingAllowed: r.drivingAllowed,
    overnightAllowed: r.overnightAllowed,
    airportExitMinutes: String(r.airportExitMinutes),
    originalAccessMinutes: String(r.originalAccessMinutes),
    originalBoardingMinutes: String(r.originalBoardingMinutes),
    checkin: r.stay?.checkin ?? "",
    checkout: r.stay?.checkout ?? "",
    guestNationality: r.stay?.guestNationality ?? "",
  };
  const usd = (cents: number | null | undefined) =>
    cents == null ? "" : String(cents / 100);
  for (const option of r.mode === "real" ? r.confirmedOptions : []) {
    if (
      (option.kind === "bus" || option.kind === "train") &&
      option.id === "manual-transit"
    )
      draft.transit = {
        ...draft.transit,
        enabled: true,
        kind: option.kind,
        title: option.title,
        departure: localInput(option.departureAt),
        arrival: localInput(option.arrivalAt),
        fare: usd(option.fareCents),
        departureTerminal: option.access.to,
        arrivalTerminal: option.finalTransfer.from,
        accessMinutes: String(option.access.minutes),
        accessCost: usd(option.access.costCents),
        finalMinutes: String(option.finalTransfer.minutes),
        finalCost: usd(option.finalTransfer.costCents),
        boardingMinutes: String(option.boardingMinutes),
        accessKind: option.access.kind,
        finalKind: option.finalTransfer.kind,
        accessVehicle: option.access.vehicleId ?? "",
        finalVehicle: option.finalTransfer.vehicleId ?? "",
        estimated: option.evidence.some((item) => item.type === "estimated"),
        checkedAt: option.evidence[0].checkedAt,
      };
    if (option.kind === "car" && option.id === "manual-car") {
      const charge = (label: string) =>
        usd(option.costs.find((cost) => cost.label === label)?.cents);
      draft.car = {
        ...draft.car,
        enabled: true,
        title: option.title,
        pickup: option.access.to,
        dropoff: option.finalTransfer.from,
        accessMinutes: String(option.access.minutes),
        accessCost: usd(option.access.costCents),
        pickupMinutes: String(option.pickupMinutes),
        driveMinutes: String(option.driveMinutes),
        returnMinutes: String(option.returnMinutes),
        walkMinutes: String(option.finalTransfer.minutes),
        rental: charge("Rental"),
        fees: charge("Tax / one-way fees"),
        fuel: charge("Fuel"),
        tolls: charge("Tolls"),
        other: charge("Other charges"),
        pickupConfirmed: option.pickupHoursConfirmed,
        returnConfirmed: option.returnLocationConfirmed,
        checkedAt: option.evidence[0].checkedAt,
      };
    }
  }
  return draft;
}
export function buildRequest(
  d: Draft,
  mode: TripRequest["mode"],
  exampleOptions: ConfirmedOption[],
  now: string,
  restoredRequest?: TripRequest,
): { request: TripRequest | null; errors: FormErrors; warnings: string[] } {
  const errors: FormErrors = {};
  const warnings: string[] = [];
  // Restored inputs are historical source data, never a seed for the facts cache.
  const original = restoredRequest?.mode === mode ? restoredRequest : undefined;
  const originalDraft = original ? draftFromRequest(original) : undefined;
  const unchangedTransit =
    !!originalDraft &&
    JSON.stringify(d.transit) === JSON.stringify(originalDraft.transit);
  const unchangedCar =
    !!originalDraft &&
    JSON.stringify(d.car) === JSON.stringify(originalDraft.car);
  function parse<T>(
    key: string,
    schema: z.ZodType<T>,
    value: unknown,
  ): T | undefined {
    const r = schema.safeParse(value);
    if (r.success) return r.data;
    errors[key] = r.error.issues[0]?.message ?? "Check this value";
    return undefined;
  }
  function date(
    key: "arrivalAt" | "originalDepartureAt" | "deadlineAt",
    value: string,
  ): string | undefined {
    try {
      if (original && originalDraft && value === originalDraft[key])
        return original[key];
      return localDateTimeToOffset(value);
    } catch {
      errors[key] =
        "Enter a valid local time. An ambiguous or nonexistent daylight-saving time needs a different, unambiguous time.";
      return undefined;
    }
  }
  const arrivalAt = date("arrivalAt", d.arrivalAt);
  const originalDepartureAt = date(
    "originalDepartureAt",
    d.originalDepartureAt,
  );
  const deadlineAt = date("deadlineAt", d.deadlineAt);
  const budgetCents =
    d.budget.trim() === "" ? null : parse("budget", amount, d.budget);
  const airportExitMinutes = parse(
    "airportExitMinutes",
    minute,
    d.airportExitMinutes,
  );
  const originalAccessMinutes = parse(
    "originalAccessMinutes",
    minute,
    d.originalAccessMinutes,
  );
  const originalBoardingMinutes = parse(
    "originalBoardingMinutes",
    minute,
    d.originalBoardingMinutes,
  );
  let stay = null;
  if (d.overnightAllowed) {
    const r = TripRequestSchema.shape.stay.safeParse({
      checkin: d.checkin,
      checkout: d.checkout,
      guestNationality: d.guestNationality.toUpperCase(),
      adults: 1,
      rooms: 1,
    });
    if (r.success) stay = r.data;
    else
      for (const issue of r.error.issues)
        errors[String(issue.path[0] ?? "checkin")] = issue.message;
  }
  if (Object.keys(errors).length) return { request: null, errors, warnings };
  const options =
    mode === "synthetic"
      ? [...exampleOptions]
      : (original?.confirmedOptions ?? []).filter(
          (option) =>
            (option.id !== "manual-transit" || unchangedTransit) &&
            (option.id !== "manual-car" || unchangedCar),
        );
  const evidence = (
    provider: string,
    at: string,
    checkedAt: string,
    estimated = false,
  ): SourceEvidence[] => [
    {
      type: estimated ? "estimated" : "traveler_confirmed",
      provider,
      sourceUrl: null,
      checkedAt,
      serviceDate: toTripLocalTime(at).slice(0, 10),
      providerUpdatedAt: null,
      expiresAt: null,
      environment: "production",
      warnings: [
        "Traveler-entered facts; operator availability has not been checked by this app.",
      ],
    },
  ];
  const cash = (v: string, field = "Transfer cost") => {
    if (v.trim() === "") return null;
    const parsed = amount.safeParse(v);
    if (!parsed.success)
      throw new OptionalFactError(
        `${field} must be a nonnegative USD amount with at most two decimal places, no more than $1,000,000. Leave it blank if unknown.`,
      );
    return parsed.data;
  };
  const transfer = (
    from: string,
    to: string,
    mins: string,
    price: string,
    at: string,
    ev: SourceEvidence[],
    kind: "walk" | "transfer",
    vehicleId = "",
  ): TransferInput => ({
    from: label.parse(from),
    to: label.parse(to),
    minutes: minute.parse(mins),
    costCents: cash(price),
    kind,
    vehicleId: vehicleId.trim() || null,
    evidence: ev.map((e) => ({
      ...e,
      serviceDate: toTripLocalTime(at).slice(0, 10),
    })),
    assumptions: [
      kind === "walk"
        ? "Traveler-supplied walking allowance."
        : "Traveler-supplied transfer duration; an unspecified vehicle counts as a separate vehicle.",
    ],
  });
  if (mode === "real" && d.transit.enabled && !unchangedTransit) {
    try {
      const t = d.transit;
      const departureAt = localDateTimeToOffset(t.departure);
      const transitArrival = localDateTimeToOffset(t.arrival);
      const ev = evidence(
        label.parse(t.title),
        departureAt,
        t.checkedAt || now,
        t.estimated,
      );
      options.push(
        TransitOptionSchema.parse({
          kind: t.kind,
          id: "manual-transit",
          title: label.parse(t.title),
          departureAt,
          arrivalAt: transitArrival,
          boardingMinutes: minute.parse(t.boardingMinutes),
          fareCents: cash(t.fare, "Fare"),
          access: transfer(
            "BOS terminal exit",
            t.departureTerminal,
            t.accessMinutes,
            t.accessCost,
            addMinutes(arrivalAt!, airportExitMinutes!),
            ev,
            t.accessKind,
            t.accessVehicle,
          ),
          finalTransfer: transfer(
            t.arrivalTerminal,
            "Portland, ME",
            t.finalMinutes,
            t.finalCost,
            transitArrival,
            ev,
            t.finalKind,
            t.finalVehicle,
          ),
          evidence: ev,
          confirmations: [
            "Confirm current seat availability with the operator before booking.",
          ],
        }),
      );
    } catch (error) {
      warnings.push(
        `Transit option omitted: ${omissionCause(error, "Enter the service name, both terminals and whole-minute transfer/boarding allowances. Prices may stay blank (unknown).")}`,
      );
    }
  }
  if (mode === "real" && d.car.enabled && !unchangedCar) {
    try {
      const c = d.car;
      const exitAt = addMinutes(arrivalAt!, airportExitMinutes!);
      const pickupAt = addMinutes(exitAt, minute.parse(c.accessMinutes));
      const finalAt = addMinutes(
        pickupAt,
        minute.parse(c.pickupMinutes) +
          minute.parse(c.driveMinutes) +
          minute.parse(c.returnMinutes),
      );
      const ev = evidence(
        label.parse(c.title),
        pickupAt,
        c.checkedAt || now,
        true,
      );
      options.push(
        CarOptionSchema.parse({
          kind: "car",
          id: "manual-car",
          title: label.parse(c.title),
          access: transfer(
            "BOS terminal exit",
            c.pickup,
            c.accessMinutes,
            c.accessCost,
            exitAt,
            ev,
            "transfer",
          ),
          pickupMinutes: minute.parse(c.pickupMinutes),
          driveMinutes: minute.parse(c.driveMinutes),
          returnMinutes: minute.parse(c.returnMinutes),
          finalTransfer: transfer(
            c.dropoff,
            "Portland, ME",
            c.walkMinutes,
            "0",
            finalAt,
            ev,
            "walk",
          ),
          costs: [
            ["Rental", c.rental],
            ["Tax / one-way fees", c.fees],
            ["Fuel", c.fuel],
            ["Tolls", c.tolls],
            ["Other charges", c.other],
          ].map(([name, value]) => ({
            label: name,
            cents: cash(value, name),
            currency: "USD",
            includedInOtherCharge: false,
          })),
          pickupHoursConfirmed: c.pickupConfirmed,
          returnLocationConfirmed: c.returnConfirmed,
          evidence: ev,
          confirmations: [
            "Traveler-entered rental and driving estimates need confirmation.",
          ],
        }),
      );
    } catch (error) {
      warnings.push(
        `Car option omitted: ${omissionCause(error, "Supply the operator, pickup/return locations and all whole-minute shuttle, pickup, driving, return and walking allowances. Blank charges remain unknown.")}`,
      );
    }
  }
  const parsed = TripRequestSchema.safeParse({
    mode,
    airport: "BOS",
    destination: "Portland, ME",
    timeZone: "America/New_York",
    arrivalAt,
    arrivalBasis:
      original && d.arrivalAt === originalDraft?.arrivalAt
        ? original.arrivalBasis
        : "traveler_confirmed",
    flight: original?.flight ?? null,
    originalDepartureAt,
    originalAccessMinutes,
    originalBoardingMinutes,
    airportExitMinutes,
    deadlineAt,
    budgetCents,
    budgetMode: d.budgetMode,
    drivingAllowed: d.drivingAllowed,
    overnightAllowed: d.overnightAllowed,
    priority: d.priority,
    confirmedOptions: options,
    stay,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0])] = issue.message;
    return { request: null, errors, warnings };
  }
  if (!options.length)
    warnings.push(
      "Add a date-specific confirmed train, bus or car option below. No schedules or prices are fetched automatically.",
    );
  return { request: parsed.data, errors, warnings };
}
