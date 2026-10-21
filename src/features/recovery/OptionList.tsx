import type { RecoveryResult } from "@domain/schemas";
import { toInstantMillis } from "@domain/time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProviderAttribution, planSourceLabels } from "./ProviderAttribution";
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export const time = (at: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(at));
export function OptionList({
  result,
  selectedId,
  now,
  onSelect,
  onRefine,
  busy,
  stale,
}: {
  result: RecoveryResult | null;
  selectedId: string | null;
  now: string;
  onSelect: (id: string) => void;
  onRefine: (change: "cheapest" | "no-driving") => void;
  busy: boolean;
  stale: boolean;
}) {
  const hotelSandbox = result?.request.hotelDataMode === "sandbox";
  return (
    <section
      aria-labelledby="options-heading"
      className="rounded-lg border bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <h2 id="options-heading" className="text-lg font-semibold">
          Recovery options
        </h2>
        <Badge variant="outline">No inventory reserved</Badge>
      </div>
      <div className="space-y-4 p-5">
        {!result ? (
          <p className="text-sm text-muted-foreground">
            Enter your trip and a confirmed onward option, or choose a fictional
            example. Your comparison will appear here.
          </p>
        ) : (
          <>
            {stale && (
              <p className="rounded-md border border-amber-700/40 bg-amber-50 p-3 text-sm text-amber-950">
                Previous comparison — stale. These results use your earlier
                inputs. Compare again before selecting.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onRefine("cheapest")}
              >
                Cheapest
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onRefine("no-driving")}
              >
                No driving
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Deadline {time(result.request.deadlineAt)} ·{" "}
              {result.request.budgetCents === null
                ? "No budget limit"
                : `${money(result.request.budgetCents)} ${result.request.budgetMode} budget`}{" "}
              ·{" "}
              {result.request.drivingAllowed ? "Driving allowed" : "No driving"}
            </p>
            <div className="rounded-md bg-slate-100 p-3 text-sm">
              <p className="font-medium">
                Original connection{" "}
                {result.originalConnection.missed
                  ? `${result.originalConnection.shortfallMinutes} minutes short`
                  : "fits the supplied allowances"}
              </p>
              <p className="mt-1">
                Gate arrival + {result.request.airportExitMinutes} min airport
                exit + {result.request.originalAccessMinutes} min terminal
                access = ready {time(result.originalConnection.readyAt)}.
                Required ready by{" "}
                {time(result.originalConnection.requiredReadyAt)} (
                {result.request.originalBoardingMinutes} min boarding
                allowance).
              </p>
            </div>
            {!result.plans.length && (
              <div className="rounded-md border border-amber-700/30 p-4">
                <h3 className="font-semibold">No feasible plan</h3>
                <p className="mt-2 text-sm">
                  Check the deadline, complete prices, hard budget and allowed
                  transport. Edit the trip or supplied option and compare again.
                  No limits were relaxed.
                </p>
                <a
                  className="mt-2 inline-block text-sm text-primary underline"
                  href="#trip-form"
                >
                  Edit trip details
                </a>
              </div>
            )}
            {result.plans.map((p, i) => {
              const expired =
                p.evidenceExpiresAt !== null &&
                toInstantMillis(p.evidenceExpiresAt) <= toInstantMillis(now);
              return (
                <article
                  key={p.id}
                  data-testid="option-card"
                  className={`rounded-md border p-4 ${selectedId === p.id ? "border-primary ring-1 ring-primary" : ""}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="font-semibold">{p.title}</h3>
                    {i === 0 && (
                      <Badge variant="secondary">
                        First by {result.request.priority.replace("_", " ")}
                      </Badge>
                    )}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Final arrival</dt>
                      <dd className="mt-1 font-medium tabular-nums">
                        {time(p.finalArrivalAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {hotelSandbox ? p.priceComplete ? "Test total (USD)" : "Known test charges only" : p.priceComplete ? "Total (USD)" : "Known charges only"}
                      </dt>
                      <dd className="mt-1 font-semibold tabular-nums">
                        {money(p.knownCostCents)}
                        {!p.priceComplete && " + unknown"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        Elapsed / changes
                      </dt>
                      <dd className="mt-1 tabular-nums">
                        {p.durationMinutes} min / {p.transfers}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {planSourceLabels(p)} ·{" "}
                    {p.feasibility === "requires_confirmation"
                      ? "Requires confirmation"
                      : "Schedule feasible, seat unconfirmed"}
                  </p>
                  <ProviderAttribution plan={p} />
                  {!p.priceComplete && (
                    <p className="mt-2 text-sm text-amber-800">
                      Price incomplete. The known total is a lower bound.
                    </p>
                  )}
                  {expired && (
                    <p className="mt-2 text-sm text-destructive">
                      Evidence expired. Recheck facts before choosing.
                    </p>
                  )}
                  <Button
                    className="mt-4"
                    aria-label={`Choose ${p.title}`}
                    disabled={stale || !p.selectable || expired || busy}
                    aria-pressed={selectedId === p.id}
                    onClick={() => onSelect(p.id)}
                  >
                    Choose this plan
                  </Button>
                </article>
              );
            })}
            {result.rejected.length > 0 && (
              <details open={!result.plans.length} className="border-t pt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Why other options were excluded ({result.rejected.length})
                </summary>
                <ul className="mt-3 space-y-3 text-sm">
                  {result.rejected.map((p) => (
                    <li key={p.id}>
                      <p className="font-medium">{p.title}</p>
                      {p.violations.map((v) => (
                        <p key={v} className="mt-1 text-muted-foreground">
                          {v}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {result.warnings.length > 0 && (
              <ul className="space-y-2 border-t pt-3 text-sm text-amber-900">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
