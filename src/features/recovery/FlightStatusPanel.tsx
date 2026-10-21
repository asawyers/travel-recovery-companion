import type { FlightStatusReport } from "@domain/schemas";
export function FlightStatusPanel({ report }: { report?: FlightStatusReport }) {
  if (!report) return null;
  const outcomes = {
    gate_available:
      "Provider gate-arrival times are shown below. The comparison uses the arrival basis stated in the itinerary.",
    runway_only:
      "Runway arrival reported; this does not establish arrival at the gate. Confirm your gate time.",
    cancelled:
      "FlightAware tracking is marked cancelled. Confirm any airline cancellation directly with the airline.",
    diverted:
      "Provider reported diversion. Confirm the destination and gate time with your airline.",
    position_only:
      "Only flight-position information is available. It does not establish gate arrival.",
  };
  return (
    <section
      data-testid="flight-status"
      className="rounded-lg border bg-white p-5"
      aria-labelledby="flight-status-heading"
    >
      <h2 id="flight-status-heading" className="text-lg font-semibold">
        Flight status
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">FlightAware report</p>
      <p className="mt-2 break-words text-sm">
        {report.ident} · Provider flight identifier: {report.faFlightId}
      </p>
      <p className="mt-2 text-sm">{outcomes[report.outcome]}</p>
      {!report.actualIn && !report.estimatedIn && !report.scheduledIn && (
        <p className="mt-2 text-sm text-amber-900">
          Gate arrival unavailable. The comparison retains your entered fallback
          or confirmed time.
        </p>
      )}
      <dl className="mt-3 space-y-2 break-words text-sm">
        {(
          [
            ["Scheduled gate arrival", report.scheduledIn],
            ["Estimated gate arrival", report.estimatedIn],
            ["Actual gate arrival", report.actualIn],
            ["Runway arrival", report.actualOn],
          ] as const
        ).map(([label, at]) => (
          <div key={label}>
            <dt className="font-medium">{label}</dt>
            <dd>{at ?? "Unavailable"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
