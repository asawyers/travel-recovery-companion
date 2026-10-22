import type {
  City,
  CityCandidate,
  CityLeg,
  CityPlace,
} from "@domain/city-contracts";
import { CityCandidateSchema } from "@domain/city-contracts";
import { localToOffset } from "./formModel";
export type ManualCityDraft = {
  mode: "bus" | "rail";
  operator: string;
  service: string;
  departureStation: string;
  arrivalStation: string;
  departureLocal: string;
  arrivalLocal: string;
  accessMinutes: string;
  boardingMinutes: string;
  finalMinutes: string;
  fare: string;
  accessCost: string;
  finalCost: string;
};
export const emptyManualDraft = (): ManualCityDraft => ({
  mode: "bus",
  operator: "",
  service: "",
  departureStation: "",
  arrivalStation: "",
  departureLocal: "",
  arrivalLocal: "",
  accessMinutes: "",
  boardingMinutes: "",
  finalMinutes: "",
  fare: "",
  accessCost: "",
  finalCost: "",
});
export function buildManualCityCandidate(
  d: ManualCityDraft,
  origin: City,
  destination: City,
  checkedAt: string,
): { candidate?: CityCandidate; errors: string[] } {
  const errors: string[] = [];
  for (const [field, label] of [
    ["operator", "operator"],
    ["service", "service"],
    ["departureStation", "departure station"],
    ["arrivalStation", "arrival station"],
  ] as const)
    if (!d[field].trim()) errors.push(`Enter the ${label} you checked.`);
  for (const [field, label] of [
    ["accessMinutes", "origin access"],
    ["boardingMinutes", "boarding allowance"],
    ["finalMinutes", "final transfer"],
  ] as const)
    if (!/^\d+$/.test(d[field]) || Number(d[field]) > 10080)
      errors.push(`Enter explicit ${label} minutes (0 is allowed).`);
  for (const [field, label] of [
    ["fare", "fare"],
    ["accessCost", "origin access cost"],
    ["finalCost", "final transfer cost"],
  ] as const)
    if (!/^\d+(\.\d{1,2})?$/.test(d[field]) || Number(d[field]) > 1_000_000)
      errors.push(`Enter the checked ${label} in USD (0 is allowed).`);
  let depart = "",
    arrive = "";
  try {
    depart = localToOffset(d.departureLocal, origin.timeZone);
  } catch {
    errors.push("Enter an unambiguous departure time in the origin time zone.");
  }
  try {
    arrive = localToOffset(d.arrivalLocal, destination.timeZone);
    if (Date.parse(arrive) <= Date.parse(depart))
      errors.push("Arrival must follow departure.");
  } catch {
    errors.push(
      "Enter an unambiguous arrival time in the destination time zone.",
    );
  }
  if (errors.length) return { errors };
  const id = `manual-${crypto.randomUUID()}`,
    place = (name: string): CityPlace => ({
      name: name.trim(),
      latitude: null,
      longitude: null,
    }),
    start = place(origin.name),
    from = place(d.departureStation),
    to = place(d.arrivalStation),
    end = place(destination.name);
  const at = (time: string, minutes: number) =>
    new Date(Date.parse(time) + minutes * 60000).toISOString();
  const accessStart = at(
      depart,
      -Number(d.accessMinutes) - Number(d.boardingMinutes),
    ),
    stationAt = at(depart, -Number(d.boardingMinutes)),
    finalAt = at(arrive, Number(d.finalMinutes));
  const leg = (
    suffix: string,
    mode: CityLeg["mode"],
    a: CityPlace,
    b: CityPlace,
    startAt: string,
    endAt: string,
    zone: string,
    arrivalZone = zone,
  ): CityLeg => ({
    id: `${id}-${suffix}`,
    mode,
    from: a,
    to: b,
    startAt,
    endAt,
    departureTimeZone: zone,
    arrivalTimeZone: arrivalZone,
    operator: mode === d.mode ? d.operator.trim() : null,
    service: mode === d.mode ? d.service.trim() : null,
    vehicleId: mode === d.mode ? id : null,
    assumptions:
      mode === "walk"
        ? [
            "Traveler supplied transfer allowance and cost; confirm the actual transfer.",
          ]
        : [],
  });
  const legs = [
    leg("access", "walk", start, from, accessStart, stationAt, origin.timeZone),
    leg("boarding", "wait", from, from, stationAt, depart, origin.timeZone),
    leg(
      "service",
      d.mode,
      from,
      to,
      depart,
      arrive,
      origin.timeZone,
      destination.timeZone,
    ),
    leg("final", "walk", to, end, arrive, finalAt, destination.timeZone),
  ];
  const parsed = CityCandidateSchema.safeParse({
    id,
    title: `${d.operator.trim()} ${d.mode === "rail" ? "train" : "bus"} · ${d.service.trim()}`,
    kind: "transit",
    originCityId: origin.id,
    destinationCityId: destination.id,
    legs,
    costs: [
      {
        label: "Checked service fare",
        cents: Math.round(Number(d.fare) * 100),
        currency: "USD",
        includedInOtherCharge: false,
      },
      {
        label: "Origin access",
        cents: Math.round(Number(d.accessCost) * 100),
        currency: "USD",
        includedInOtherCharge: false,
      },
      {
        label: "Final transfer",
        cents: Math.round(Number(d.finalCost) * 100),
        currency: "USD",
        includedInOtherCharge: false,
      },
    ],
    evidence: [
      {
        type: "traveler_confirmed",
        provider: "Traveler checked directly with operator",
        sourceUrl: null,
        checkedAt,
        serviceDate: d.departureLocal.slice(0, 10),
        providerUpdatedAt: null,
        expiresAt: null,
        environment: "production",
        warnings: [
          "Traveler supplied facts; recheck service, access and availability before booking.",
        ],
      },
    ],
    confirmations: [
      "Station locations and transfer allowances are traveler supplied and require confirmation.",
    ],
  });
  return parsed.success
    ? { candidate: parsed.data, errors: [] }
    : {
        errors: [
          "The checked option is invalid. Review its service, times and explicit transfer costs.",
        ],
      };
}
