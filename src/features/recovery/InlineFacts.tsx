import { useEffect, useRef } from "react";
import type { HotelOption } from "@domain/schemas";
import { HotelJourneyFacts } from "./HotelJourneyFacts";
import type { Clarification } from "@domain/conversation";
import { clarificationQuestion } from "@domain/conversation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Draft, FormErrors } from "./formModel";

export function InlineFacts({ clarification, draft, errors, busy, offers = [], onChange, onSubmit }: {
  clarification: Clarification; draft: Draft; errors: FormErrors; busy: boolean; offers?: HotelOption[];
  onChange: (draft: Draft) => void; onSubmit: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>("input,select")?.focus(); }, [clarification.field]);
  function text(key: keyof Draft, label: string, type = "text") {
    return <label className="block space-y-2 text-sm" key={key}><span className="font-medium">{label}</span><Input id={`answer-${key}`} type={type} step={type === "datetime-local" ? "1" : "any"} value={String(draft[key])} onChange={event => onChange({ ...draft, [key]: event.target.value })} aria-invalid={!!errors[key]} />{errors[key] && <span role="alert" className="text-destructive">{errors[key]}</span>}</label>;
  }
  return <form ref={ref} onSubmit={event => { event.preventDefault(); if (clarification.field !== "hotelJourney") onSubmit(); }} className="space-y-4 rounded-md border-l-4 border-l-primary bg-white p-4" aria-label="Confirm trip fact">
    <p className="text-sm font-medium">{clarificationQuestion(clarification)}</p>
    {clarification.field === "arrivalAt" && text("arrivalAt", "Revised gate arrival", "datetime-local")}
    {clarification.field === "deadlineAt" && <>{text("deadlineAt", "Final destination deadline", "datetime-local")}<Button type="button" variant="outline" onClick={() => onChange({ ...draft, deadlineAt: "" })}>Use as soon as possible</Button></>}
    {clarification.field === "budget" && <>{text("budget", "Budget (USD)", "number")}<label className="block text-sm">Budget limit<select className="recovery-select mt-2" value={draft.budgetMode} onChange={event => onChange({ ...draft, budgetMode: event.target.value as Draft["budgetMode"] })}><option value="soft">Soft preference</option><option value="hard">Hard maximum</option></select></label></>}
    {clarification.field === "stay" && <>{text("checkin", "Check-in date", "date")}{text("checkout", "Check-out date", "date")}{text("guestNationality", "Guest nationality (2-letter country code)")}<p className="text-xs text-muted-foreground">1 adult, 1 room. Nationality is supplied by you.</p></>}
    {clarification.field === "connection" && <>{text("originalDepartureAt", "Original onward departure", "datetime-local")}{text("originalAccessMinutes", "Original terminal access minutes", "number")}{text("originalBoardingMinutes", "Original boarding minutes", "number")}</>}
    {clarification.field === "preference" && <><label className="block text-sm">Priority<select className="recovery-select mt-2" value={draft.priority} onChange={event => onChange({ ...draft, priority: event.target.value as Draft["priority"] })}><option value="earliest">Earliest arrival</option><option value="cheapest">Cheapest complete price</option><option value="fewest_transfers">Fewest vehicle changes</option></select></label><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.drivingAllowed} onChange={event => onChange({ ...draft, drivingAllowed: event.target.checked })} />Allow driving</label></>}
    {clarification.field === "hotelJourney" && <HotelJourneyFacts draft={draft} offers={offers} busy={busy} onChange={onChange} onComplete={onSubmit} />}
    {clarification.field !== "hotelJourney" && <Button type="submit" disabled={busy}>Use these facts</Button>}
  </form>;
}
