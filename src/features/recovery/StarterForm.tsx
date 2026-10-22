import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import type { TripRequest } from "@domain/schemas";
import type { Draft, FormErrors } from "./formModel";

export function StarterForm({ draft, errors, busy, started, confirmedRequest, onChange, onSubmit }: {
  draft: Draft; errors: FormErrors; busy: boolean; started: boolean; confirmedRequest?: Pick<TripRequest, "arrivalAt" | "deadlineAt">;
  onChange: (draft: Draft) => void; onSubmit: (arrivalNow: boolean) => void;
}) {
  const [arrivalNow, setArrivalNow] = useState(!draft.arrivalAt);
  const [deadline, setDeadline] = useState(!!draft.deadlineAt);
  const [deadlineError, setDeadlineError] = useState("");
  // Only the validated request boundary synchronizes these UI choices. Draft
  // edits can deliberately leave an explicit deadline blank while it is edited.
  useEffect(() => { if (confirmedRequest?.arrivalAt) setArrivalNow(false); }, [confirmedRequest?.arrivalAt]);
  useEffect(() => {
    if (confirmedRequest) { setDeadline(confirmedRequest.deadlineAt !== null); setDeadlineError(""); }
  }, [confirmedRequest?.deadlineAt]);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  return <form id="trip-form" noValidate onSubmit={event => { event.preventDefault(); if (deadline && !draft.deadlineAt.trim()) { setDeadlineError("Enter an arrival deadline or choose As soon as possible."); return; } setDeadlineError(""); onSubmit(arrivalNow); }} className="space-y-5">
    <Field><FieldLabel htmlFor="arrival-choice">Gate arrival</FieldLabel>
      <select className="recovery-select" id="arrival-choice" value={arrivalNow ? "now" : "custom"} onChange={event => setArrivalNow(event.target.value === "now")}>
        <option value="now">Now</option><option value="custom">Enter a time</option>
      </select>
      <FieldDescription>Boston Logan gate arrival. All times are America/New_York.</FieldDescription>
    </Field>
    {!arrivalNow && <Field><FieldLabel htmlFor="arrivalAt">Revised gate arrival</FieldLabel><Input id="arrivalAt" type="datetime-local" step="1" value={draft.arrivalAt} onChange={event => update("arrivalAt", event.target.value)} aria-invalid={!!errors.arrivalAt} />{errors.arrivalAt && <FieldError>{errors.arrivalAt}</FieldError>}</Field>}
    <Field><FieldLabel htmlFor="arrival-goal">Arrival goal</FieldLabel><select className="recovery-select" id="arrival-goal" value={deadline ? "deadline" : "asap"} onChange={event => { setDeadlineError(""); setDeadline(event.target.value === "deadline"); if (event.target.value === "asap") update("deadlineAt", ""); }}><option value="asap">As soon as possible</option><option value="deadline">By a specific time</option></select></Field>
    {deadline && <Field><FieldLabel htmlFor="deadlineAt">Final destination deadline</FieldLabel><Input id="deadlineAt" type="datetime-local" step="1" value={draft.deadlineAt} onChange={event => { setDeadlineError(""); update("deadlineAt", event.target.value); }} aria-invalid={!!errors.deadlineAt || !!deadlineError} />{(errors.deadlineAt || deadlineError) && <FieldError role="alert">{errors.deadlineAt || deadlineError}</FieldError>}</Field>}
    <details className="text-sm"><summary className="cursor-pointer font-medium">Airport exit assumption: {draft.airportExitMinutes} minutes</summary><Field className="mt-3"><FieldLabel htmlFor="airportExitMinutes">Airport exit minutes</FieldLabel><Input id="airportExitMinutes" type="number" min="0" value={draft.airportExitMinutes} onChange={event => update("airportExitMinutes", event.target.value)} /><FieldDescription>From the gate to terminal exit, including bags. Added once.</FieldDescription>{errors.airportExitMinutes && <FieldError>{errors.airportExitMinutes}</FieldError>}</Field></details>
    <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Preferences (optional)</summary><div className="mt-4 space-y-4">
      <Field><FieldLabel htmlFor="budget">Budget (USD)</FieldLabel><Input id="budget" type="number" min="0" step="0.01" value={draft.budget} onChange={event => update("budget", event.target.value)} /><FieldDescription>Leave blank for no limit. Unknown prices stay unknown.</FieldDescription>{errors.budget && <FieldError>{errors.budget}</FieldError>}</Field>
      <Field><FieldLabel htmlFor="budgetMode">Budget limit</FieldLabel><select className="recovery-select" id="budgetMode" value={draft.budgetMode} onChange={event => update("budgetMode", event.target.value as Draft["budgetMode"])}><option value="soft">Soft preference</option><option value="hard">Hard maximum</option></select></Field>
      <Field><FieldLabel htmlFor="priority">Priority</FieldLabel><select className="recovery-select" id="priority" value={draft.priority} onChange={event => update("priority", event.target.value as Draft["priority"])}><option value="earliest">Earliest arrival</option><option value="cheapest">Cheapest complete price</option><option value="fewest_transfers">Fewest vehicle changes</option></select></Field>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.drivingAllowed} onChange={event => update("drivingAllowed", event.target.checked)} />Allow driving</label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.overnightAllowed} onChange={event => update("overnightAllowed", event.target.checked)} />Allow overnight stay</label>
      <p className="text-xs text-muted-foreground">Permission to explore overnight options. Stay details can be added when needed.</p>
    </div></details>
    {Object.keys(errors).length > 0 && <p role="alert" className="text-sm text-destructive">Check the marked trip facts. Your entries are retained.</p>}
    <Button type="submit" disabled={busy} className="w-full">{busy ? "Finding options…" : started ? "Update options" : "Find my options"}</Button>
    <p className="text-xs leading-relaxed text-muted-foreground">This checks available sources using your trip details. Sources may be unavailable or incomplete; no tickets or rooms are reserved.</p>
  </form>;
}
