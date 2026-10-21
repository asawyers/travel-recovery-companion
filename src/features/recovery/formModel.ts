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
    "Use a positive USD amount with at most two decimal places",
  )
  .transform((v) => Math.round(Number(v) * 100))
  .pipe(z.number().int().max(100_000_000));
const minute = z
  .string()
  .regex(/^\d+$/, "Use whole minutes, 0 or more")
  .transform(Number)
  .pipe(z.number().int().min(0).max(10_080));
const label = z.string().trim().min(1, "Enter this fact").max(500);
export const localInput = (at: string) =>
  toTripLocalTime(at).replace(/(?:Z|[+-]\d{2}:\d{2})$/, "");
export function draftFromRequest(r: TripRequest): Draft {
  return {
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
}
export function buildRequest(
  d: Draft,
  mode: TripRequest["mode"],
  exampleOptions: ConfirmedOption[],
  now: string,
): { request: TripRequest | null; errors: FormErrors; warnings: string[] } {
  const errors: FormErrors = {};
  const warnings: string[] = [];
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
  function date(key: string, value: string): string | undefined {
    try {
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
  const options = mode === "synthetic" ? exampleOptions : [];
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
  const cash = (v: string) => (v.trim() === "" ? null : amount.parse(v));
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
  if (mode === "real" && d.transit.enabled) {
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
          fareCents: cash(t.fare),
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
    } catch {
      warnings.push(
        "Transit option omitted: enter the service name, valid unambiguous departure/arrival, both terminals and whole-minute transfer/boarding allowances. Prices may stay blank (unknown); entered USD prices need at most 2 decimals.",
      );
    }
  }
  if (mode === "real" && d.car.enabled) {
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
            cents: cash(value),
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
    } catch {
      warnings.push(
        "Car option omitted: supply operator, pickup/return locations and all whole-minute shuttle, pickup, driving, return and walking allowances. Blank charges remain unknown.",
      );
    }
  }
  const parsed = TripRequestSchema.safeParse({
    mode,
    airport: "BOS",
    destination: "Portland, ME",
    timeZone: "America/New_York",
    arrivalAt,
    arrivalBasis: "traveler_confirmed",
    flight: null,
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
