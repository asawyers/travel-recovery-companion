import { useState } from "react";
import type { ConfirmedOption, TripRequest } from "@domain/schemas";
import { daytimeFixture, overnightFixture } from "@domain/fixtures";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TripForm } from "@/features/recovery/TripForm";
import { OptionList } from "@/features/recovery/OptionList";
import { ItineraryPanel } from "@/features/recovery/ItineraryPanel";
import { SavedPlanPanel } from "@/features/recovery/SavedPlanPanel";
import {
  selectionSnapshot,
  refreshRequest,
} from "@/features/recovery/savedSelection";
import { useRecovery } from "@/features/recovery/useRecovery";
import {
  buildRequest,
  draftFromRequest,
  emptyDraft,
} from "@/features/recovery/formModel";
import type { Draft, FormErrors } from "@/features/recovery/formModel";
import { FlightStatusPanel } from "@/features/recovery/FlightStatusPanel";
import {
  containsGoogleRoutes,
  GOOGLE_SAVE_MESSAGE,
} from "@/features/recovery/providerRetention";
import { LegalPage, LegalFooter } from "@/features/recovery/LegalPage";
function RecoveryApp() {
  const [draft, setDraft] = useState(emptyDraft);
  const [mode, setMode] = useState<TripRequest["mode"]>("real");
  const [exampleOptions, setExampleOptions] = useState<ConfirmedOption[]>([]);
  const [exampleNow, setExampleNow] = useState<string | null>(null);
  const [restoredRequest, setRestoredRequest] = useState<
    TripRequest | undefined
  >();
  const [investigate, setInvestigate] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const recovery = useRecovery();
  const { state } = recovery;
  const busy = state.status === "planning" || state.status === "validating";
  const now = () => exampleNow ?? new Date().toISOString();
  function edit(next: Draft) {
    const { priority: _before, ...before } = draft;
    const { priority: _after, ...after } = next;
    const priorityOnly = JSON.stringify(before) === JSON.stringify(after);
    recovery.edit(priorityOnly);
    const confirmed = { ...next };
    if (next.transit !== draft.transit)
      confirmed.transit = {
        ...next.transit,
        checkedAt: new Date().toISOString(),
      };
    if (next.car !== draft.car)
      confirmed.car = { ...next.car, checkedAt: new Date().toISOString() };
    setDraft(confirmed);
    setErrors({});
    setWarnings([]);
  }
  function compare(
    next = draft,
    nextMode = mode,
    options = exampleOptions,
    clock = now(),
    investigateSources = false,
  ) {
    // Confirm once at the input boundary; priority changes retain original timestamps.
    const confirmed = {
      ...next,
      transit:
        next.transit.enabled && !next.transit.checkedAt
          ? { ...next.transit, checkedAt: clock }
          : next.transit,
      car:
        next.car.enabled && !next.car.checkedAt
          ? { ...next.car, checkedAt: clock }
          : next.car,
    };
    if (confirmed.transit !== next.transit || confirmed.car !== next.car)
      setDraft(confirmed);
    const built = buildRequest(
      confirmed,
      nextMode,
      options,
      clock,
      restoredRequest,
    );
    setErrors(built.errors);
    setWarnings(built.warnings);
    if (built.request) {
      setInvestigate(false);
      void recovery.compare(built.request, clock, investigateSources);
    } else recovery.edit();
  }
  function example(kind: "daytime" | "overnight") {
    const f = kind === "daytime" ? daytimeFixture() : overnightFixture();
    recovery.reset();
    setRestoredRequest(undefined);
    setInvestigate(false);
    setMode("synthetic");
    setExampleOptions(f.candidates);
    setExampleNow(f.now);
    const next = draftFromRequest(f.request);
    setDraft(next);
    compare(next, "synthetic", f.candidates, f.now);
  }
  function real() {
    recovery.reset();
    setRestoredRequest(undefined);
    setInvestigate(false);
    setMode("real");
    setDraft(emptyDraft());
    setExampleOptions([]);
    setExampleNow(null);
    setErrors({});
    setWarnings([]);
  }
  function refreshSaved() {
    if (!recovery.saved) return;
    const request = refreshRequest(recovery.saved);
    const clock =
      request.mode === "synthetic"
        ? recovery.saved.generatedAt
        : new Date().toISOString();
    recovery.edit();
    setRestoredRequest(request);
    setInvestigate(false);
    setDraft(draftFromRequest(request));
    setMode(request.mode);
    setExampleOptions(
      request.mode === "synthetic" ? request.confirmedOptions : [],
    );
    setExampleNow(request.mode === "synthetic" ? clock : null);
    setErrors({});
    setWarnings(
      request.mode === "real"
        ? [
            "This comparison retains original source timestamps. Reconfirm provider facts and re-enter any changed onward options before choosing.",
          ]
        : [],
    );
    void recovery.compare(request, clock, recovery.configured);
  }
  function refine(change: "cheapest" | "no-driving") {
    const next: Draft = {
      ...draft,
      ...(change === "cheapest"
        ? { priority: "cheapest" as const }
        : { drivingAllowed: false }),
    };
    edit(next);
    compare(next);
  }
  return (
    <>
      <a
        href="#trip-form"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-3"
      >
        Skip to trip details
      </a>
      <header className="border-b border-t-4 border-t-[#153247] bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <p className="font-semibold">Travel recovery companion</p>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-green-800">
              Device-local saving
            </Badge>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Boston to Portland recovery planner
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          A delayed San Diego–Boston flight meant missing Portland trains and
          driving onward. Compare the whole journey from your revised Boston
          Logan gate arrival to Portland, Maine.
        </p>
        <div
          data-testid="provenance-banner"
          className={`my-6 rounded-md border px-4 py-3 text-sm ${mode === "synthetic" ? "border-amber-700/40 bg-amber-50 text-amber-950" : "bg-white"}`}
        >
          <strong>
            {mode === "synthetic"
              ? "Synthetic / fictional example"
              : "Traveler-entered trip"}
          </strong>
          <p className="mt-1">
            {mode === "synthetic"
              ? "Every option, price, hotel and source in this example is fictional. Demonstration clock: Nov 18, 2026, 7:55 am America/New_York; source timestamps are fixed."
              : recovery.configured
                ? "Your supplied facts are compared by the public planner. Live availability is checked only when an available source is explicitly investigated; source warnings show what was actually checked."
                : "Only facts you enter are compared locally. No live schedule, fare, seat, rental or hotel availability has been checked."}
          </p>
        </div>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]">
          <TripForm
            draft={draft}
            errors={errors}
            synthetic={mode === "synthetic"}
            busy={busy}
            onChange={edit}
            onSubmit={() =>
              compare(draft, mode, exampleOptions, now(), investigate)
            }
            configured={recovery.configured}
            investigate={investigate}
            onInvestigate={(value) => {
              recovery.edit();
              setInvestigate(value);
            }}
            onExample={example}
            onReal={real}
          />
          <div className="min-w-0 space-y-5">
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="text-sm"
            >
              {busy
                ? "Comparing supplied journey facts…"
                : state.result
                  ? `${state.result.plans.length} recovery options. ${state.status === "partial_results" ? "Some prices are incomplete." : ""}`
                  : "Enter trip facts to begin."}
            </div>
            {(warnings.length > 0 || state.error) && (
              <Alert role={state.error ? "alert" : "note"}>
                <AlertTitle>
                  {state.error
                    ? "Comparison unavailable"
                    : "Check supplied facts"}
                </AlertTitle>
                <AlertDescription>
                  {state.error}
                  {warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            <FlightStatusPanel report={state.result?.flightStatus} />
            <OptionList
              result={state.result}
              selectedId={state.selectedPlanId}
              now={now()}
              onSelect={(id) => recovery.select(id, now())}
              onRefine={refine}
              busy={busy}
              stale={state.stale}
            />
            <ItineraryPanel
              saved={state.persistence === "saved"}
              arrivalEvidence={state.arrivalEvidence}
              result={state.result}
              plan={state.result?.plans.find(
                (p) => p.id === state.selectedPlanId,
              )}
            />
            <Button
              disabled={
                !selectionSnapshot(state, now(), new Date().toISOString()).ok &&
                !(
                  !state.stale &&
                  state.result?.plans.some(
                    (p) =>
                      p.id === state.selectedPlanId && containsGoogleRoutes(p),
                  )
                )
              }
              onClick={() => recovery.save(now())}
            >
              Save on this device
            </Button>
            {state.result?.plans.some(
              (p) => p.id === state.selectedPlanId && containsGoogleRoutes(p),
            ) && (
              <p className="text-sm text-amber-900">{GOOGLE_SAVE_MESSAGE}</p>
            )}
            {recovery.storageMessage && (
              <p role="status" className="text-sm text-green-800">
                {recovery.storageMessage}
              </p>
            )}
            {recovery.storageError && (
              <Alert role="alert">
                <AlertTitle>
                  {recovery.storageError.includes("Google Maps")
                    ? "Device saving restricted"
                    : "Device storage unavailable"}
                </AlertTitle>
                <AlertDescription>{recovery.storageError}</AlertDescription>
                {!recovery.saved && (
                  <Button
                    className="mt-3"
                    variant="outline"
                    onClick={recovery.deleteSaved}
                  >
                    Delete saved plan
                  </Button>
                )}
              </Alert>
            )}
            {recovery.saved && (
              <SavedPlanPanel
                saved={recovery.saved}
                busy={busy}
                configured={recovery.configured}
                onDelete={recovery.deleteSaved}
                onRefresh={refreshSaved}
              />
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Confirm current schedules, prices, pickup hours and availability
              with the operator before booking. Saving keeps one itinerary in
              this browser on this device. No tickets or reservations are
              purchased.
            </p>
          </div>
        </div>
      </main>
      <LegalFooter />
    </>
  );
}
function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/terms" || path === "/privacy")
    return <LegalPage page={path === "/terms" ? "terms" : "privacy"} />;
  return <RecoveryApp />;
}
export default App;
