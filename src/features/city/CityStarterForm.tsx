import { LoadingSpinner } from "@/components/ui/companion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CityPicker } from "./CityPicker";
import { cityLocalInput } from "./formModel";
import type { CityDraft, CityFormErrors } from "./formModel";
export function CityStarterForm({
  draft,
  errors,
  busy,
  started,
  onChange,
  onSubmit,
}: {
  draft: CityDraft;
  errors: CityFormErrors;
  busy: boolean;
  started: boolean;
  onChange: (draft: CityDraft) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      id="trip-form"
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      <div className={`grid gap-5 ${started ? "" : "sm:grid-cols-2"}`}>
        <CityPicker
          label="From city"
          value={draft.origin}
          error={errors.origin}
          onChange={(origin) => onChange({ ...draft, origin })}
        />
        <CityPicker
          label="To city"
          value={draft.destination}
          error={errors.destination}
          onChange={(destination) => onChange({ ...draft, destination })}
        />
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-3 text-base font-medium">
          When do you need to get there?
        </legend>
        <div className="flex flex-wrap gap-5">
          <label className="flex min-h-11 items-center gap-2 rounded-lg border bg-[#F4F7FA] px-3 py-2 text-sm">
            <input
              type="radio"
              name="arrival-goal"
              checked={draft.goal === "asap"}
              onChange={() =>
                onChange({ ...draft, goal: "asap", deadlineLocal: "" })
              }
            />
            As soon as possible
          </label>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border bg-[#F4F7FA] px-3 py-2 text-sm">
            <input
              type="radio"
              name="arrival-goal"
              checked={draft.goal === "deadline"}
              onChange={() => onChange({ ...draft, goal: "deadline" })}
            />
            By a date and time
          </label>
        </div>
        {draft.goal === "deadline" && (
          <div className="space-y-2">
            <Label htmlFor="city-deadline">Arrive by</Label>
            <Input
              id="city-deadline"
              type="datetime-local"
              value={draft.deadlineLocal}
              onChange={(event) =>
                onChange({ ...draft, deadlineLocal: event.target.value })
              }
              aria-invalid={!!errors.deadlineAt}
              aria-describedby="city-deadline-zone"
            />
            <p
              id="city-deadline-zone"
              className="text-xs text-muted-foreground"
            >
              Destination local time:{" "}
              {draft.destination?.timeZone ?? "choose your To city first"}.
              Repeated or skipped daylight saving times must be changed.
            </p>
            {errors.deadlineAt && (
              <p role="alert" className="text-sm text-destructive">
                {errors.deadlineAt}
              </p>
            )}
          </div>
        )}
      </fieldset>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          {draft.readyLocal
            ? "Leaving at the time below"
            : draft.readyAt
              ? `Leaving time: ${draft.origin ? cityLocalInput(draft.readyAt, draft.origin.timeZone).replace("T", " ") : draft.readyAt}`
              : "Leaving now"}{" "}
          <span className="font-normal text-muted-foreground">
            · {draft.origin?.timeZone ?? "origin local time"} · Edit
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          <Label htmlFor="city-ready">Leaving time</Label>
          <Input
            id="city-ready"
            type="datetime-local"
            value={draft.readyLocal}
            onChange={(event) =>
              onChange({
                ...draft,
                readyLocal: event.target.value,
                readyAt: null,
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            {draft.origin?.timeZone ?? "Choose your From city"}. Leave blank to
            use{" "}
            {draft.readyAt
              ? "your original leaving time"
              : "the current time when you find options"}
            .
          </p>
        </div>
      </details>
      {errors.readyAt && (
        <p role="alert" className="text-sm text-destructive">
          {errors.readyAt}
        </p>
      )}
      {started && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Budget and travel preferences
          </summary>
          <div className="mt-4 grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="city-budget">Budget (USD, optional)</Label>
              <Input
                id="city-budget"
                inputMode="decimal"
                value={draft.budget}
                onChange={(event) =>
                  onChange({ ...draft, budget: event.target.value })
                }
              />
              {errors.budget && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.budget}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="city-budget-mode">Budget flexibility</Label>
              <select
                id="city-budget-mode"
                className="recovery-select"
                value={draft.budgetMode}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    budgetMode: event.target.value as CityDraft["budgetMode"],
                  })
                }
              >
                <option value="soft">Preference</option>
                <option value="hard">Hard limit</option>
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border bg-[#F4F7FA] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={draft.drivingAllowed}
                onChange={(event) =>
                  onChange({ ...draft, drivingAllowed: event.target.checked })
                }
              />
              Driving allowed
            </label>
            <div className="space-y-2">
              <Label htmlFor="city-priority">Prioritize</Label>
              <select
                id="city-priority"
                className="recovery-select"
                value={draft.priority}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    priority: event.target.value as CityDraft["priority"],
                  })
                }
              >
                <option value="earliest">Earliest arrival</option>
                <option value="cheapest">Lowest complete price</option>
                <option value="fewest_transfers">Fewer changes</option>
              </select>
            </div>
          </div>
        </details>
      )}
      <Button type="submit" disabled={busy} className="min-h-11 h-auto w-full whitespace-normal px-5 py-3 sm:w-auto">
        {busy && <LoadingSpinner />}
        {started ? "Confirm trip facts and update options" : "Find my options"}
      </Button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        One adult, city center to city center. These estimates include the
        complete journey when sources supply it. Confirm the exact start, end
        and payable costs before traveling.
      </p>
    </form>
  );
}
