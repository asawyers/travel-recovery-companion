import type { Assistance } from "@domain/assistance";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";

export function AssistancePanel({ assistance, value, onChange, onSubmit, busy, configured, hasResult, investigate, onInvestigate }: {
  assistance: Assistance | null; value: string; onChange: (value: string) => void; onSubmit: () => void; busy: boolean; configured: boolean; hasResult: boolean; investigate: boolean; onInvestigate: (value: boolean) => void;
}) {
  return <section aria-labelledby="refine-heading" className="rounded-lg border bg-white p-5">
    <h2 id="refine-heading" className="text-lg font-semibold">Refine your options</h2>
    <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <Field>
        <FieldLabel htmlFor="refinement">Refine this comparison</FieldLabel>
        <textarea id="refinement" value={value} onChange={event => onChange(event.target.value)} maxLength={500} rows={3} className="w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" aria-describedby="refinement-help" placeholder="For example: avoid driving and prefer the cheapest complete journey" />
        <FieldDescription id="refinement-help">Up to 500 characters. Accepted priority and driving preferences appear in your trip details. Your text and current trip are sent to the public planner and enabled OpenAI assistance when you apply it. Refinement text and activity are not included in device-saved plans.</FieldDescription>
      </Field>
      {configured && <div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm" htmlFor="refinement-investigate"><input id="refinement-investigate" type="checkbox" checked={investigate} onChange={event => onInvestigate(event.target.checked)} className="size-4 accent-primary" />Check enabled sources with this refinement</label>
        <p className="text-xs text-muted-foreground">This explicitly sends relevant trip inputs to enabled sources for a fresh check. Without it, refinement compares only your entered facts; previous provider routes and hotel rates are not sent as manual facts.</p>
      </div>}
      <Button type="submit" variant="outline" disabled={busy || !value.trim() || !configured || !hasResult}>Apply refinement</Button>
      {!configured && <p className="text-sm text-muted-foreground">Assisted refinement is unavailable because the public planner is not configured. Use the priority and driving controls to compare supplied facts.</p>}
      {!hasResult && configured && <p className="text-sm text-muted-foreground">Compare your trip before applying a refinement.</p>}
    </form>
    {assistance && <div data-testid="assistance-panel" role="status" className="mt-4 space-y-2 border-t pt-4 text-sm">
      <p className="font-medium">{assistance.status === "completed" ? "Refinement complete" : assistance.status === "limited" ? "Limited assistance" : "Assistance unavailable"}</p>
      <p>{assistance.summary}</p>
      {Object.keys(assistance.appliedPreferences).length > 0 && <p>Applied preferences: {[
        assistance.appliedPreferences.drivingAllowed === undefined ? null : assistance.appliedPreferences.drivingAllowed ? "driving allowed" : "no driving",
        assistance.appliedPreferences.priority?.replaceAll("_", " "),
      ].filter(Boolean).join(", ")}.</p>}
      {assistance.activity.length > 0 && <details>
        <summary className="cursor-pointer font-medium">Source and assessment activity</summary>
        <ul className="mt-2 space-y-2">{assistance.activity.map((activity, index) => <li key={index}>
          <p>{activity.tool.replaceAll("_", " ")} · {activity.status}</p><p>{activity.message}</p><p className="break-words text-xs text-muted-foreground">Checked {activity.checkedAt}</p>
        </li>)}</ul>
      </details>}
    </div>}
  </section>;
}
