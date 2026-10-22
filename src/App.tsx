import { useEffect, useRef, useState } from "react";
import type { ConfirmedOption, RecoveryResult, TripRequest } from "@domain/schemas";
import type { Clarification } from "@domain/conversation";
import { daytimeFixture, overnightFixture } from "@domain/fixtures";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TripForm } from "@/features/recovery/TripForm";
import { StarterForm } from "@/features/recovery/StarterForm";
import { InlineFacts } from "@/features/recovery/InlineFacts";
import { OptionList, money, time } from "@/features/recovery/OptionList";
import { ItineraryPanel } from "@/features/recovery/ItineraryPanel";
import { SavedPlanPanel } from "@/features/recovery/SavedPlanPanel";
import { selectionSnapshot, refreshRequest } from "@/features/recovery/savedSelection";
import { useRecovery } from "@/features/recovery/useRecovery";
import { buildRequest, draftFromRequest, emptyDraft, hotelSandboxDraft, localInput } from "@/features/recovery/formModel";
import type { Draft, FormErrors } from "@/features/recovery/formModel";
import { containsGoogleRoutes, GOOGLE_SAVE_MESSAGE } from "@/features/recovery/providerRetention";
import { LegalPage, LegalFooter } from "@/features/recovery/LegalPage";
import { HotelOffersPanel } from "@/features/recovery/HotelOffersPanel";
import { appendConversation, conversationContext } from "@/features/recovery/conversation";
import type { ConversationTurn } from "@/features/recovery/conversation";

function RecoveryApp() {
  const [draft, setDraft] = useState(emptyDraft);
  const [mode, setMode] = useState<TripRequest["mode"]>("real");
  const [exampleOptions, setExampleOptions] = useState<ConfirmedOption[]>([]);
  const [exampleNow, setExampleNow] = useState<string | null>(null);
  const [restoredRequest, setRestoredRequest] = useState<TripRequest>();
  const [started, setStarted] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [refinement, setRefinement] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [pastResults, setPastResults] = useState<RecoveryResult[]>([]);
  const [requestedField, setRequestedField] = useState<Clarification | null>(null);
  const lastReported = useRef(0);
  const displayedResult = useRef<RecoveryResult | null>(null);
  const recovery = useRecovery();
  const { state } = recovery;
  const hotelSandbox = mode === "synthetic" && draft.hotelSandbox;
  const busy = state.status === "planning" || state.status === "validating";
  const now = () => exampleNow ?? new Date().toISOString();
  function addTurn(role: ConversationTurn["role"], content: string, id = crypto.randomUUID()) {
    const turn = { id, role, content, revision: recovery.getRevision() };
    setTurns(current => appendConversation(current, turn));
  }
  useEffect(() => {
    if (!state.result || state.stale || busy || state.status === "error" || lastReported.current === state.sequence) return;
    const previous = displayedResult.current;
    if (previous && previous !== state.result) setPastResults(current => [...current, previous].slice(-3));
    displayedResult.current = state.result;
    lastReported.current = state.sequence;
    setDraft(current => ({ ...current, priority: state.result!.request.priority, drivingAllowed: state.result!.request.drivingAllowed }));
    if (state.assistance?.clarification) setRequestedField(state.assistance.clarification);
    const content = state.assistance?.summary ?? `${state.result.plans.length ? `${state.result.plans.length} recovery options are ready to compare.` : "No complete recovery journey is available from the supplied facts."} ${hotelSandbox ? "Demo guide: these are test hotel rates and fictional onward inputs." : "Source labels show what was checked. Confirm availability before booking."}`;
    setTurns(current => appendConversation(current, { id: `answer-${state.sequence}`, role: "assistant", content, revision: recovery.getRevision() }));
  }, [state.result, state.assistance, state.stale, state.sequence, state.status, busy, hotelSandbox]);

  function edit(next: Draft) {
    const { priority: _before, ...before } = draft;
    const { priority: _after, ...after } = next;
    const priorityOnly = JSON.stringify(before) === JSON.stringify(after);
    recovery.edit(priorityOnly);
    const confirmed = { ...next };
    const checkedAt = new Date().toISOString();
    if (next.transit !== draft.transit) confirmed.transit = { ...next.transit, checkedAt };
    if (next.car !== draft.car) confirmed.car = { ...next.car, checkedAt };
    if (next.hotel !== draft.hotel) {
      const h = next.hotel, previous = draft.hotel;
      confirmed.hotel = { ...h,
        hotelCheckedAt: h.hotelMinutes !== previous.hotelMinutes || h.hotelCost !== previous.hotelCost || h.hotelKind !== previous.hotelKind ? checkedAt : h.hotelCheckedAt,
        stationCheckedAt: h.stationMinutes !== previous.stationMinutes || h.stationCost !== previous.stationCost || h.stationKind !== previous.stationKind ? checkedAt : h.stationCheckedAt,
      };
    }
    if (next.transit.departureTerminal !== draft.transit.departureTerminal && confirmed.hotel.hotelId)
      confirmed.hotel = { ...confirmed.hotel, stationMinutes: "", stationCost: "", stationKind: "transfer", stationCheckedAt: "" };
    setDraft(confirmed);
    setErrors({});
    setWarnings([]);
  }
  function compare(next = draft, nextMode = mode, options = exampleOptions, clock = now(), investigate = true, refinementText?: string, sourceRequest: TripRequest | null = restoredRequest ?? null, userText?: string) {
    const confirmed = { ...next,
      transit: next.transit.enabled && !next.transit.checkedAt ? { ...next.transit, checkedAt: clock } : next.transit,
      car: next.car.enabled && !next.car.checkedAt ? { ...next.car, checkedAt: clock } : next.car,
    };
    const built = buildRequest(confirmed, nextMode, options, clock, sourceRequest ?? undefined);
    setErrors(built.errors); setWarnings(built.warnings);
    if (!built.request) { recovery.edit(); return; }
    setStarted(true); setDraft(confirmed); setRequestedField(null);
    const message = userText ?? `BOS to Portland, ME, 1 adult. Gate arrival ${time(built.request.arrivalAt)}. ${built.request.deadlineAt ? `Arrive by ${time(built.request.deadlineAt)}.` : "As soon as possible."}`;
    const turnId = crypto.randomUUID();
    const context = refinementText ? conversationContext(turnId, recovery.getRevision(), turns) : undefined;
    addTurn("user", message, turnId);
    void recovery.compare(built.request, clock, investigate, refinementText, context);
  }
  function submitStarter(arrivalNow: boolean) {
    const clock = now();
    const next = arrivalNow ? { ...draft, arrivalAt: localInput(clock) } : draft;
    if (arrivalNow) edit(next);
    compare(next, mode, exampleOptions, clock);
  }
  function confirmInlineFacts() {
    if (requestedField?.field === "stay") {
      if (!draft.checkin || !draft.checkout || !draft.guestNationality.trim()) {
        setErrors({ checkin: "Enter the stay dates and guest nationality before checking hotel rates." });
        return;
      }
      const next = { ...draft, overnightAllowed: true };
      edit(next); compare(next); return;
    }
    compare();
  }
  function resetConversation() { setTurns([]); setPastResults([]); setRequestedField(null); lastReported.current = 0; displayedResult.current = null; setRefinement(""); setErrors({}); setWarnings([]); }
  function example(kind: "daytime" | "overnight") {
    const f = kind === "daytime" ? daytimeFixture() : overnightFixture();
    recovery.reset(); resetConversation(); setRestoredRequest(undefined);
    setMode("synthetic"); setExampleOptions(f.candidates); setExampleNow(f.now);
    const next = draftFromRequest(f.request); setDraft(next);
    compare(next, "synthetic", f.candidates, f.now, false, undefined, null);
  }
  function sandbox() {
    const clock = new Date().toISOString(), next = hotelSandboxDraft(clock);
    recovery.reset(); resetConversation(); setRestoredRequest(undefined);
    setMode("synthetic"); setExampleOptions([]); setExampleNow(null); setDraft(next);
    compare(next, "synthetic", [], clock, true, undefined, null);
  }
  function real() {
    recovery.reset(); resetConversation(); setRestoredRequest(undefined); setStarted(false);
    setMode("real"); setDraft(emptyDraft()); setExampleOptions([]); setExampleNow(null);
  }
  function refreshSaved() {
    if (!recovery.saved) return;
    const historical = refreshRequest(recovery.saved);
    const request: TripRequest = { ...historical, flight: null, arrivalBasis: historical.mode === "real" ? "traveler_confirmed" : historical.arrivalBasis };
    const clock = request.mode === "synthetic" && request.hotelDataMode !== "sandbox" ? recovery.saved.generatedAt : new Date().toISOString();
    recovery.edit(); setStarted(true); setRefinement(""); setRequestedField(null); setRestoredRequest(request);
    setDraft(draftFromRequest(request)); setMode(request.mode);
    setExampleOptions(request.mode === "synthetic" && request.hotelDataMode !== "sandbox" ? request.confirmedOptions : []);
    setExampleNow(request.mode === "synthetic" && request.hotelDataMode !== "sandbox" ? clock : null);
    setErrors({}); setWarnings([]); addTurn("user", "Refresh the saved itinerary using its original trip dates and source timestamps.");
    void recovery.compare(request, clock, recovery.configured);
  }
  function quickReply(change: "cheapest" | "no-driving" | "fewest_transfers" | "overnight") {
    if (change === "overnight") {
      edit({ ...draft, overnightAllowed: true }); setRequestedField({ field: "stay", reason: "required" });
      addTurn("user", "Explore overnight"); addTurn("assistant", hotelSandbox ? "Demo guide: use the fictional stay dates below to explore test hotel rates." : "What dates and guest nationality should I use to check an overnight stay?"); return;
    }
    const next: Draft = { ...draft, ...(change === "no-driving" ? { drivingAllowed: false } : { priority: change }) };
    edit(next);
    compare(next, mode, exampleOptions, now(), change === "no-driving", undefined, restoredRequest ?? null, change === "cheapest" ? "Cheaper" : change === "no-driving" ? "No driving" : "Fewer changes");
  }
  function sendMessage() {
    const message = refinement.trim(); if (!message || busy) return;
    setRefinement("");
    if (hotelSandbox) {
      addTurn("user", message); addTurn("assistant", "Demo guide (not a model): choose a test hotel below, then apply fictional transfer defaults or edit the test inputs. Recheck sandbox hotel rates after changing those facts. No live sources, AI or booking links are used."); return;
    }
    compare(draft, mode, exampleOptions, now(), true, message, restoredRequest ?? null, message);
  }
  function applyFictionalDefaults() {
    const clock = now();
    const next = { ...draft, hotel: { ...draft.hotel, hotelMinutes: "20", hotelCost: "0", hotelKind: "transfer" as const, hotelCheckedAt: clock, stationMinutes: "25", stationCost: "0", stationKind: "transfer" as const, stationCheckedAt: clock, checkinMinutes: "15", leaveHotelAt: `${draft.checkout}T09:00` } };
    edit(next); compare(next, mode, exampleOptions, clock, true, undefined, restoredRequest ?? null, "Apply fictional defaults to this property: 20 minutes airport to hotel, 15 minutes check-in, leave at 09:00 and 25 minutes to the fictional boarding stop. Both transfer test prices are $0.");
  }
  const canSave = selectionSnapshot(state, now(), new Date().toISOString()).ok;
  const googleSelected = state.result?.plans.some(plan => plan.id === state.selectedPlanId && containsGoogleRoutes(plan));
  const editor = <StarterForm confirmedRequest={state.request ?? undefined} key={`${mode}-${exampleNow ?? "current"}-${started}`} draft={draft} errors={errors} busy={busy} started={started} onChange={edit} onSubmit={submitStarter} />;
  return <>
    <a href="#trip-form" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-3">Skip to trip details</a>
    <header className="border-b border-t-4 border-t-[#153247] bg-white"><div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6"><p className="font-semibold">Travel recovery companion</p><Badge variant="secondary" className="text-green-800">Device-local saving</Badge></div></header>
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Let's get you to Portland</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Boston Logan to Portland, Maine. One adult, the whole journey.</p>
      {!started ? <section className="mt-7 rounded-lg border bg-white p-5 sm:p-7" aria-label="Start your recovery">{editor}</section> : <>
        <div data-testid="provenance-banner" className={`mt-6 border-l-4 px-4 py-3 text-sm ${mode === "synthetic" ? "border-amber-700 bg-amber-50 text-amber-950" : "border-primary bg-white"}`}><strong>{hotelSandbox ? "Sandbox hotel rates + fictional onward inputs" : mode === "synthetic" ? "Synthetic / fictional example" : "Traveler-entered trip"}</strong><p className="mt-1 leading-relaxed">{hotelSandbox ? "Demo guide (not a model). Hotel rates are sandbox test data; onward services, fares, transfers and allowances are fictional. All amounts are test prices. No live availability, reservations or booking links." : mode === "synthetic" ? "Every option, price, hotel and source in this example is fictional. Demonstration clock: Nov 18, 2026, 7:55 am America/New_York; source timestamps are fixed." : "Available sources are checked when you find or update options. Sources may be unavailable; labels and warnings show what was actually checked."}</p></div>
        <details className="my-5 rounded-md border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">Edit trip <span className="ml-2 font-normal text-muted-foreground">{draft.arrivalAt ? draft.arrivalAt.replace("T", " ") : "Gate arrival pending"} · {draft.deadlineAt ? `Arrive by ${draft.deadlineAt.replace("T", " ")}` : "As soon as possible"} · {draft.budget ? `$${draft.budget} ${draft.budgetMode} budget` : "No budget limit"} · {draft.drivingAllowed ? "Driving allowed" : "No driving"} · {{earliest:"Earliest arrival",cheapest:"Cheapest complete price",fewest_transfers:"Fewest vehicle changes"}[draft.priority]} · {draft.overnightAllowed ? "Overnight allowed" : "Overnight not allowed"} · {draft.airportExitMinutes} min airport exit</span></summary><div className="mt-5">{editor}</div></details>
        <section role="log" aria-label="Recovery conversation" aria-live="polite" aria-relevant="additions" className="space-y-5">
          {turns.map(turn => <article key={turn.id} className={`conversation-turn rounded-lg px-4 py-3 text-sm leading-relaxed ${turn.role === "user" ? "ml-8 border bg-white" : "mr-3"}`}><p className="mb-1 text-xs font-medium text-muted-foreground">{turn.role === "user" ? "You" : hotelSandbox ? "Demo guide" : "Recovery companion"}</p><p className="whitespace-pre-wrap">{turn.content}</p></article>)}
          {pastResults.length > 0 && <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">Earlier comparisons</summary><p className="mt-2">Historical options use earlier trip facts and cannot be selected.</p>{pastResults.map((result, index) => <div key={index} className="mt-3 space-y-2">{result.plans.slice(0,3).map(plan => <article key={plan.id} data-testid="historical-option-card" className="rounded border p-3"><p>{plan.title}</p><p>{time(plan.finalArrivalAt)} · {money(plan.knownCostCents)}{!plan.priceComplete && " + unknown"} · {result.request.hotelDataMode === "sandbox" ? "Test data · no booking links" : "Historical comparison"}</p></article>)}</div>)}</details>}
          <div role="status" aria-atomic="true" className={busy ? "text-sm" : "sr-only"}>{busy ? "Checking available journey facts…" : state.result ? `${state.result.plans.length} recovery options. ${state.status === "partial_results" ? "Some prices are incomplete." : ""}` : "Finding your options…"}</div>
          {(warnings.length > 0 || state.error) && <Alert role={state.error ? "alert" : "note"}><AlertTitle>{state.error ? "Comparison unavailable" : "Check supplied facts"}</AlertTitle><AlertDescription>{state.error}{warnings.map(warning => <p key={warning}>{warning}</p>)}</AlertDescription></Alert>}
          {state.assistance && <div data-testid="assistance-panel" className="space-y-2 border-l-2 pl-4 text-sm"><p className="font-medium">{state.assistance.status === "completed" ? "Refinement complete" : state.assistance.status === "limited" ? "Limited assistance" : "Assistance unavailable"}</p>{Object.keys(state.assistance.appliedPreferences).length > 0 && <p>Applied preferences: {[state.assistance.appliedPreferences.drivingAllowed === undefined ? null : state.assistance.appliedPreferences.drivingAllowed ? "driving allowed" : "no driving", state.assistance.appliedPreferences.priority?.replaceAll("_", " ")].filter(Boolean).join(", ")}.</p>}{state.assistance.activity.length > 0 && <details><summary className="cursor-pointer font-medium">Source and assessment activity</summary><ul className="mt-2 space-y-2">{state.assistance.activity.map((activity,index) => <li key={index}><p>{activity.tool.replaceAll("_"," ")} · {activity.status}</p><p>{activity.message}</p><p className="break-words text-xs text-muted-foreground">Checked {activity.checkedAt}</p></li>)}</ul></details>}</div>}
          {requestedField && !manualOpen && <InlineFacts offers={state.hotelOffers} clarification={requestedField} draft={draft} errors={errors} busy={busy} onChange={edit} onSubmit={confirmInlineFacts} />}
          <HotelOffersPanel sandbox={hotelSandbox} offers={state.hotelOffers} selectedId={draft.hotel.hotelId} busy={busy} bookingOrigin={state.hotelBookingOrigin} expiresAt={state.hotelOffersExpiresAt} onExpired={recovery.expireOffers} onSelect={hotelId => { if (hotelId !== draft.hotel.hotelId) { edit({ ...draft, hotel: { ...emptyDraft().hotel, hotelId } }); if (!hotelSandbox) setRequestedField({ field: "hotelJourney", reason: "required" }); } }} />
          {hotelSandbox && draft.hotel.hotelId && <div className="rounded-md border border-amber-700/40 bg-amber-50 p-4 text-sm"><p className="font-medium">Fictional inputs for this selected property</p><p className="my-2">20-minute airport transfer, 15-minute check-in, 09:00 hotel departure and 25-minute boarding-stop transfer. Both transfer test prices are $0. These are editable demo assumptions.</p><Button variant="outline" disabled={busy} onClick={applyFictionalDefaults}>Use fictional transfer defaults</Button></div>}
          <OptionList result={state.result} selectedId={state.selectedPlanId} now={now()} onSelect={id => recovery.select(id, now())} onRefine={quickReply} busy={busy} stale={state.stale} />
        </section>
        <div className="mt-5 rounded-lg bg-background py-3"><div className="mb-3 flex flex-wrap gap-2" aria-label="Quick replies">{([ ["cheapest", "Cheaper"], ["no-driving", "No driving"], ["fewest_transfers", "Fewer changes"], ["overnight", "Explore overnight"] ] as const).map(([change,label]) => <Button key={change} variant="outline" disabled={busy || !state.result} onClick={() => quickReply(change)}>{label}</Button>)}</div>
        <form className="space-y-3 rounded-lg border bg-white p-4" onSubmit={event => { event.preventDefault(); sendMessage(); }}><label className="block text-sm font-medium" htmlFor="refinement">Message about your trip</label><textarea id="refinement" value={refinement} onChange={event => setRefinement(event.target.value)} maxLength={500} rows={2} className="w-full resize-y rounded-md border px-3 py-2 text-sm" placeholder={hotelSandbox ? "Ask the demo guide what to do next" : "What would make this journey work better?"} aria-describedby="conversation-help" /><div className="flex flex-wrap items-center justify-between gap-3"><p id="conversation-help" className="max-w-sm text-xs leading-relaxed text-muted-foreground">{hotelSandbox ? "Deterministic demo guide. No model or live transport calls." : "Up to 500 characters. Messages and recent conversation stay in this tab and are sent to enabled assistance and sources. They are never saved with your itinerary."}</p><Button type="submit" disabled={busy || !refinement.trim()}>Send message</Button></div>{!recovery.configured && !hotelSandbox && <p className="text-sm text-muted-foreground">Assisted refinement is unavailable. You can still use quick replies and confirm trip facts.</p>}</form></div>
        <Button className="mt-4" variant="outline" disabled={busy} onClick={() => compare()}>Recheck available sources</Button>
        <div className="mt-6 space-y-4"><ItineraryPanel saved={state.persistence === "saved"} arrivalEvidence={state.arrivalEvidence} hotelBookingOrigin={state.hotelBookingOrigin} result={state.result} plan={state.result?.plans.find(plan => plan.id === state.selectedPlanId)} /><Button disabled={!canSave && !(!state.stale && googleSelected)} onClick={() => recovery.save(now())}>Save on this device</Button>{googleSelected && <p className="text-sm text-amber-900">{GOOGLE_SAVE_MESSAGE}</p>}</div>
      </>}
        <details open={manualOpen} onToggle={event => setManualOpen(event.currentTarget.open)} className="mt-5 rounded-md border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">Add an option you’ve checked</summary>{manualOpen && <div className="mt-4"><TripForm draft={draft} errors={errors} synthetic={mode === "synthetic"} busy={busy} onChange={edit} onSubmit={() => compare()} configured={recovery.configured} hotelInvestigationNeeded={!!draft.hotel.hotelId} selectedHotelName={state.hotelOffers.find(hotel => hotel.id === draft.hotel.hotelId)?.name} onExample={example} onReal={real} onHotelSandbox={sandbox} /></div>}</details>
      {recovery.storageMessage && <p role="status" className="mt-4 text-sm text-green-800">{recovery.storageMessage}</p>}
      {recovery.storageError && <Alert role="alert" className="mt-4"><AlertTitle>{recovery.storageError.includes("Google Maps") ? "Device saving restricted" : "Device storage unavailable"}</AlertTitle><AlertDescription>{recovery.storageError}</AlertDescription>{!recovery.saved && <Button className="mt-3" variant="outline" onClick={recovery.deleteSaved}>Delete saved plan</Button>}</Alert>}
      {recovery.saved && <div className="mt-6"><SavedPlanPanel saved={recovery.saved} busy={busy} configured={recovery.configured} onDelete={recovery.deleteSaved} onRefresh={refreshSaved} /></div>}
      <details className="mt-8 border-t pt-5"><summary className="cursor-pointer text-sm text-muted-foreground">Try a demonstration</summary><div className="mt-4 space-y-3"><p className="text-sm text-muted-foreground">Try fictional journeys or real sandbox test hotel rates with a labeled demo guide.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={sandbox}>Try hotel sandbox</Button><Button type="button" variant="outline" disabled={busy} onClick={() => example("daytime")}>Daytime fictional example</Button><Button type="button" variant="outline" disabled={busy} onClick={() => example("overnight")}>Overnight fictional example</Button>{mode === "synthetic" && <Button type="button" variant="secondary" onClick={real}>Use my own trip</Button>}</div></div></details>
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">Confirm schedules, prices and availability with the operator before booking. Saving keeps one itinerary in this browser on this device. No tickets or reservations are purchased.</p>
    </main><LegalFooter />
  </>;
}
function App() { const path = window.location.pathname.replace(/\/$/, ""); if (path === "/terms" || path === "/privacy") return <LegalPage page={path === "/terms" ? "terms" : "privacy"} />; return <RecoveryApp />; }
export default App;
