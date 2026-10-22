import { useState } from "react";
import type { City, CityCandidate } from "@domain/city-contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildManualCityCandidate, emptyManualDraft } from "./manualModel";
import type { ManualCityDraft } from "./manualModel";
export function ManualCityOption({
  origin,
  destination,
  busy,
  onAdd,
}: {
  origin: City;
  destination: City;
  busy: boolean;
  onAdd: (candidate: CityCandidate) => void;
}) {
  const [draft, setDraft] = useState(emptyManualDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const field = (key: keyof ManualCityDraft, label: string, type = "text") => (
    <div className="space-y-2">
      <Label htmlFor={`manual-city-${key}`}>{label}</Label>
      <Input
        id={`manual-city-${key}`}
        type={type}
        value={draft[key]}
        onChange={(event) => {
          setDraft((current) => ({ ...current, [key]: event.target.value }));
          setErrors([]);
        }}
      />
    </div>
  );
  return (
    <details className="mt-6 rounded-lg border bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Add an option you’ve checked
      </summary>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const built = buildManualCityCandidate(
            draft,
            origin,
            destination,
            new Date().toISOString(),
          );
          setErrors(built.errors);
          if (built.candidate) {
            onAdd(built.candidate);
            setDraft(emptyManualDraft());
          }
        }}
        noValidate
      >
        <p className="text-sm text-muted-foreground">
          Enter a direct bus or train you checked with the operator. Include
          walking access, boarding and final walking allowances, with every
          cost. These are your supplied facts; no schedules, transfers or fares
          are invented.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="manual-city-mode">Travel mode</Label>
            <select
              id="manual-city-mode"
              className="recovery-select"
              value={draft.mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  mode: event.target.value as "bus" | "rail",
                })
              }
            >
              <option value="bus">Bus</option>
              <option value="rail">Train</option>
            </select>
          </div>
          {field("operator", "Operator")}
          {field("service", "Service name or number")}
          {field("departureStation", "Departure station")}
          {field("arrivalStation", "Arrival station")}
          {field(
            "departureLocal",
            `Departure time (${origin.timeZone})`,
            "datetime-local",
          )}
          {field(
            "arrivalLocal",
            `Arrival time (${destination.timeZone})`,
            "datetime-local",
          )}
          {field(
            "accessMinutes",
            "Walking to departure station (minutes)",
            "number",
          )}
          {field("boardingMinutes", "Boarding allowance (minutes)", "number")}
          {field(
            "finalMinutes",
            "Final walk to destination city center (minutes)",
            "number",
          )}
          {field("fare", "Service fare (USD)", "number")}
          {field("accessCost", "Origin access cost (USD)", "number")}
          {field("finalCost", "Final transfer cost (USD)", "number")}
        </div>
        {errors.length > 0 && (
          <ul
            role="alert"
            className="list-disc space-y-1 pl-5 text-sm text-destructive"
          >
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        <Button disabled={busy} type="submit">
          Confirm checked option and compare
        </Button>
        <p className="text-xs text-muted-foreground">
          Enter 0 explicitly when an allowance or charge is zero. This saves the
          check time only when you confirm; refresh keeps the original
          timestamp.
        </p>
      </form>
    </details>
  );
}
