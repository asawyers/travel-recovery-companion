import type { RecoveryPlan } from "@domain/schemas";
import { containsGoogleRoutes } from "./providerRetention";
export function planSourceLabels(plan: RecoveryPlan): string {
  const evidence = [
    ...plan.legs.flatMap((leg) => leg.evidence),
    ...(plan.hotel?.evidence ?? []),
  ];
  const labels = {
    live: "Live source",
    schedule: "Published schedule",
    traveler_confirmed: "Traveler confirmed",
    estimated: "Estimated",
    synthetic: "Synthetic / fictional",
  };
  return [
    ...new Set(evidence.map((e) => `${e.environment === "sandbox" ? "Sandbox / test rate" : labels[e.type]} · ${e.provider}`)),
  ].join("; ");
}
export function ProviderAttribution({ plan }: { plan: RecoveryPlan }) {
  return containsGoogleRoutes(plan) ? (
    <p className="mt-3 text-xs text-muted-foreground">
      <span
        translate="no"
        className="whitespace-nowrap text-xs font-normal text-[#1F1F1F]"
      >
        Google Maps
      </span>{" "}
      ·{" "}
      <a
        className="underline"
        href="https://www.google.com/help/terms_maps/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Google Maps terms
      </a>
    </p>
  ) : null;
}
