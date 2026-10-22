import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CityCandidate, CitySavedSelection } from "@domain/city-contracts";
import { nearestAirports } from "@domain/airport-metadata";
import {
  type TravelRequestBinding,
  TravelTripSchema,
} from "@domain/travel-contracts";
import {
  buildTravelRequest,
  useTravelRecovery,
} from "../travel/useTravelRecovery";
import {
  AirportChoices,
  TravelRecoveryPanel,
} from "../travel/TravelRecoveryPanel";
import { TravelHistoryPanel } from "../travel/TravelHistoryPanel";
import {
  readTravelHistory,
  travelSnapshot,
  writeTravelSelection,
} from "../travel/savedSelection";
import { cityAnswer, cityResultCount } from "./conversationModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cityRecoveryEndpoint } from "@/lib/city-api";
import {
  appendConversation,
  conversationContext,
} from "../recovery/conversation";
import type { ConversationTurn } from "../recovery/conversation";
import { clearSavedSelection } from "../recovery/savedSelection";
import type {
  SelectionStorage,
  StorageResult,
} from "../recovery/savedSelection";
import { GOOGLE_SAVE_MESSAGE } from "../recovery/providerRetention";
import { LegalFooter } from "../recovery/LegalPage";
import { CityStarterForm } from "./CityStarterForm";
import { CityPlanCard } from "./CityPlanCard";
import { ManualCityOption } from "./ManualCityOption";
import { CityHistoryPanel } from "./CityHistoryPanel";
import { CitySession } from "./session";
import {
  buildCityRequest,
  draftFromCityRequest,
  emptyCityDraft,
} from "./formModel";
import type { CityDraft, CityFormErrors } from "./formModel";
import {
  citySnapshot,
  containsCityGoogle,
  refreshCityRequest,
  writeCitySelection,
} from "./savedSelection";
function storage<T>(
  operation: (storage: SelectionStorage) => StorageResult<T>,
): StorageResult<T> {
  try {
    return operation(window.localStorage);
  } catch {
    return {
      ok: false,
      message:
        "Browser storage is unavailable. Allow storage and retry. Your current trip is retained.",
    };
  }
}
export function CityRecoveryApp() {
  const [session] = useState(
    () =>
      new CitySession({
        endpoint: () =>
          cityRecoveryEndpoint(import.meta.env.VITE_RECOVERY_API_URL),
      }),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [draft, setDraft] = useState(emptyCityDraft);
  const travel = useTravelRecovery();
  const [airports, setAirports] = useState<{ from: string; to: string } | null>(
    null,
  );
  const from =
    airports?.from ??
    (draft.origin
      ? (nearestAirports(draft.origin)[0]?.airport.iata ?? "")
      : "");
  const to =
    airports?.to ??
    (draft.destination
      ? (nearestAirports(draft.destination)[0]?.airport.iata ?? "")
      : "");
  const travelReported = useRef(0);
  const [errors, setErrors] = useState<CityFormErrors>({});
  const [started, setStarted] = useState(false);
  const [manual, setManual] = useState<CityCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [editing, setEditing] = useState(false);
  const [manualKey, setManualKey] = useState(0);
  const [record, setRecord] = useState(() => storage(readTravelHistory));
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const reported = useRef(0);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (!state.result) return;
    const expiries = [
      state.factsExpiresAt,
      ...state.result.plans.flatMap((plan) => [
        plan.evidenceExpiresAt,
        ...plan.evidence.map((e) => e.expiresAt),
      ]),
    ].flatMap((expiry) => (expiry ? [Date.parse(expiry)] : []));
    if (!expiries.length) return;
    const next = Math.min(...expiries);
    if (next <= Date.now()) {
      session.expire();
      return;
    }
    const timer = window.setTimeout(
      () => session.expire(),
      Math.min(next - Date.now(), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [state.result, state.factsExpiresAt, session]);
  const configured = !!import.meta.env.VITE_RECOVERY_API_URL?.trim();
  function addTurn(
    role: ConversationTurn["role"],
    content: string,
    id = crypto.randomUUID(),
  ) {
    setTurns((current) =>
      appendConversation(current, {
        id,
        role,
        content,
        revision: session.revision,
      }),
    );
  }
  useEffect(() => {
    const content = cityAnswer(state);
    if (!content || state.sequence === reported.current || !state.result) {
      return;
    }
    reported.current = state.sequence;
    const assistance = state.assistance;
    setTurns((current) =>
      appendConversation(current, {
        id: `answer-${state.sequence}`,
        role: "assistant",
        content,
        revision: session.revision,
      }),
    );
    if (
      assistance?.clarification &&
      assistance.clarification.field !== "hotel"
    ) {
      setEditing(true);
    }
    if (
      assistance?.status === "completed" &&
      Object.keys(assistance.appliedPreferences).length
    ) {
      travel.session.applyPreferences(assistance.appliedPreferences);
    }
    if (!assistance?.clarification) {
      setDraft((current) => ({
        ...current,
        priority: state.result!.request.priority,
        drivingAllowed: state.result!.request.drivingAllowed,
      }));
    }
  }, [state, session]);
  function edit(next: CityDraft) {
    const cityChanged =
      next.origin?.id !== draft.origin?.id ||
      next.destination?.id !== draft.destination?.id;
    session.edit(!cityChanged);
    travel.session.edit(!cityChanged);
    if (cityChanged) setAirports(null);
    setStorageMessage(null);
    setStorageError(null);
    setErrors({});
    if (cityChanged) {
      setManual([]);
      setManualKey((k) => k + 1);
      setTurns([]);
      setMessage("");
      setDraft({
        ...next,
        readyAt: null,
        readyLocal: "",
        deadlineLocal: "",
        goal: "asap",
      });
    } else setDraft(next);
  }
  async function compare(
    next = draft,
    candidates = manual,
    investigate = true,
    refinement?: string,
    userText?: string,
    travelMode: "preserve" | "same-day" = "preserve",
  ) {
    const built = buildCityRequest(next, new Date().toISOString(), candidates);
    setErrors(built.errors);
    if (!built.request || !next.origin || !next.destination) {
      setEditing(true);
      return;
    }
    setStarted(true);
    setEditing(false);
    setStorageMessage(null);
    setStorageError(null);
    setDraft({ ...next, readyAt: built.request.readyAt });
    const turnId = crypto.randomUUID(),
      context = refinement
        ? conversationContext(turnId, session.revision, turns)
        : undefined;
    addTurn(
      "user",
      userText ??
        `${next.origin.name}, ${next.origin.stateCode} to ${next.destination.name}, ${next.destination.stateCode}. ${
          built.request.deadlineAt
            ? "Arrive by the destination-local deadline."
            : "As soon as possible."
        }`,
      turnId,
    );
    if (!refinement) {
      if (!investigate) travel.session.rerank(built.request.priority);
      else {
        const {
          version: _version,
          mode: _mode,
          confirmedOptions: _options,
          ...trip
        } = built.request;
        const active = travel.state.result?.request;
        const preserve =
          travelMode === "preserve" &&
          active &&
          active.trip.originCityId === trip.originCityId &&
          active.trip.destinationCityId === trip.destinationCityId;
        const input = buildTravelRequest(
          TravelTripSchema.parse(trip),
          next.origin,
          from,
          to,
          Boolean(preserve && active.overnight),
        );
        // Rechecking sources or changing a soft preference does not authorize
        // a different travel day. Explicit readiness/airport edits rebuild dates.
        if (
          input &&
          preserve &&
          active.trip.readyAt === trip.readyAt &&
          active.originAirportIata === from &&
          active.destinationAirportIata === to
        ) {
          input.departureDate = active.departureDate;
          input.overnight = active.overnight;
        }
        if (input) void travel.session.search(input);
        else travel.session.unavailable();
      }
    }
    await session.compare(
      built.request,
      next.origin,
      next.destination,
      investigate,
      refinement,
      context,
    );
  }
  function quickReply(
    kind: "cheapest" | "fewest_transfers" | "no-driving" | "overnight",
  ) {
    if (state.dirty) return;
    if (kind === "overnight") {
      const request = state.result?.request;
      const tripFacts = request
        ? (({ version: _v, mode: _m, confirmedOptions: _c, ...trip }) => trip)(
            request,
          )
        : travel.state.result?.request.trip;
      if (tripFacts && draft.origin) {
        const input = buildTravelRequest(
          TravelTripSchema.parse(tripFacts),
          draft.origin,
          from,
          to,
          true,
        );
        addTurn("user", "Explore overnight");
        if (input) void travel.session.search(input);
        else travel.session.unavailable();
      }
      return;
    }
    if (
      (kind === "cheapest" || kind === "fewest_transfers") &&
      !session.canRerank() &&
      !travel.session.usable()
    ) {
      session.expire();
      travel.session.expire();
      return;
    }
    const next = {
      ...draft,
      ...(kind === "no-driving"
        ? { drivingAllowed: false }
        : { priority: kind }),
    };
    setDraft(next);
    if (kind !== "no-driving" && !session.canRerank()) {
      travel.session.rerank(kind);
      addTurn("user", kind === "cheapest" ? "Cheaper" : "Fewer changes");
      return;
    }
    void compare(
      next,
      manual,
      kind === "no-driving",
      undefined,
      kind === "no-driving"
        ? "No driving"
        : kind === "cheapest"
          ? "Cheaper"
          : "Fewer changes",
    );
  }
  useEffect(() => {
    const t = travel.state;
    if (t.busy || !t.result || t.error || t.sequence === travelReported.current)
      return;
    travelReported.current = t.sequence;
    const summary =
      t.result.assistance?.summary ??
      `${t.result.flightOffers.length} flight quotes${
        t.result.request.overnight
          ? ` and ${t.result.hotelOffers.length} origin hotel quotes`
          : ""
      } checked. Confirm transfers and allowances before choosing a complete flight journey.`;
    addTurn("assistant", summary);
    const assistance = t.result.assistance;
    if (
      assistance?.status === "completed" &&
      Object.keys(assistance.appliedPreferences).length
    ) {
      setDraft((current) => ({ ...current, ...assistance.appliedPreferences }));
      session.applyPreferences(assistance.appliedPreferences);
    }
    const field = t.result.assistance?.clarification?.field;
    if (
      field &&
      ["airport", "readyAt", "deadlineAt", "budget", "preference"].includes(
        field,
      )
    )
      setEditing(true);
    if (field === "transfer" || (field === "hotel" && t.hotel))
      travel.session.reviewFacts();
  }, [travel.state]);
  function travelMessage(text: string) {
    const result = travel.state.result;
    const turnId = crypto.randomUUID();
    addTurn("user", text, turnId);
    let input: TravelRequestBinding | null = result
      ? {
          ...result.request,
          trip: {
            ...result.request.trip,
            priority: draft.priority,
            drivingAllowed: draft.drivingAllowed,
          },
          selection: null,
        }
      : null;
    const confirmed = result?.request.selection;
    const current = buildCityRequest(
      draft,
      new Date().toISOString(),
      manual,
    ).request;
    if (
      input &&
      result &&
      confirmed &&
      current &&
      travel.session.usable() &&
      !state.dirty &&
      !travel.state.editingFacts &&
      !result.selectionIssue &&
      result.request.originAirportIata === from &&
      result.request.destinationAirportIata === to &&
      Object.entries(result.request.trip).every(
        ([key, value]) => current[key as keyof typeof current] === value,
      ) &&
      travel.state.flight?.id === confirmed.flightOfferId &&
      travel.state.flight.fingerprint === confirmed.flightFingerprint &&
      (result.request.overnight
        ? travel.state.hotel?.id === confirmed.hotelOfferId &&
          travel.state.hotel.fingerprint === confirmed.hotelFingerprint
        : confirmed.hotelOfferId === null && travel.state.hotel === null)
    ) {
      input.selection = confirmed;
    }
    // A hotel keyword alone cannot authorize changing a calendar day.
    const hotelMention = /\b(overnight|hotel|stay)\b/i.test(text);
    const negated =
      /\b(no|not|never|without|avoid|skip|cannot|can't|don't|won't)\b/i.test(
        text,
      );
    // Accept only complete, narrow hotel-search commands. All other prose keeps
    // its original date binding and can use the explicit Explore overnight action.
    const explicitOvernightCommand =
      /^(?:please\s+)?(?:find|search for|explore|show me|check|i need|i want|i would like)\s+(?:(?:a|an|some)\s+)?(?:overnight(?:\s+(?:hotels?|stay|options))?|hotels?|one-night stay)(?:\s+and\s+(?:a\s+)?flights?)?[.!]?$/i.test(
        text.trim(),
      );
    const wantsOvernight = explicitOvernightCommand && !negated;
    if (hotelMention && !wantsOvernight && !negated)
      addTurn(
        "assistant",
        "Your current flight date is retained. Choose Explore overnight to check one night at your origin and a flight the next day.",
      );
    if (draft.origin && (!input || wantsOvernight)) {
      const built = buildCityRequest(draft, new Date().toISOString(), manual);
      if (built.request) {
        const {
          version: _version,
          mode: _mode,
          confirmedOptions: _options,
          ...trip
        } = built.request;
        input = buildTravelRequest(
          TravelTripSchema.parse(trip),
          draft.origin,
          from,
          to,
          wantsOvernight,
        );
      }
    }
    if (!input) {
      travel.session.unavailable();
      return;
    }
    void travel.session.search({
      ...input,
      refinement: text,
      conversation: conversationContext(turnId, session.revision, turns),
    });
  }
  function refreshTravel(request: TravelRequestBinding) {
    session.edit();
    travel.session.edit(false);
    const saved =
      record.ok && record.value?.schemaVersion === 3 ? record.value : null;
    if (
      !saved ||
      saved.origin.id !== request.trip.originCityId ||
      saved.destination.id !== request.trip.destinationCityId
    )
      return;
    const { origin, destination } = saved;
    const cityRequest = {
      version: 2 as const,
      mode: "real" as const,
      ...request.trip,
      confirmedOptions: [],
    };
    setDraft(draftFromCityRequest(cityRequest, origin, destination));
    setAirports({
      from: request.originAirportIata,
      to: request.destinationAirportIata,
    });
    setManual([]);
    setManualKey((k) => k + 1);
    setTurns([]);
    setMessage("");
    setStarted(true);
    setEditing(false);
    void travel.session.search(request);
  }
  function save() {
    if (
      travel.state.selected &&
      travel.state.result &&
      travel.session.usable()
    ) {
      const snap = travelSnapshot(
        travel.state.result,
        new Date().toISOString(),
      );
      const saved = snap.ok
        ? storage((s) => writeTravelSelection(s, snap.value))
        : snap;
      if (!saved.ok) {
        setStorageError(saved.message);
        return;
      }
      setRecord(saved);
      setStorageError(null);
      setStorageMessage(
        "Saved on this device. No tickets or reservations have been purchased.",
      );
      return;
    }
    if (!state.result || !state.selectedId || !session.canUseResult()) return;
    if (session.expired()) {
      setStorageError(
        "Source checks expired. Recheck available sources before saving.",
      );
      return;
    }
    const snap = citySnapshot(
      state.result,
      state.selectedId,
      new Date().toISOString(),
    );
    const saved = snap.ok
      ? storage((s) => writeCitySelection(s, snap.value))
      : snap;
    if (!saved.ok) {
      setStorageError(saved.message);
      setStorageMessage(null);
      return;
    }
    setRecord(saved);
    setStorageError(null);
    setStorageMessage(
      "Saved on this device. No tickets or reservations have been purchased.",
    );
    session.markSaved();
  }
  function deleteSaved() {
    const cleared = storage(clearSavedSelection);
    if (!cleared.ok) {
      setStorageError(cleared.message);
      return;
    }
    setRecord(cleared);
    session.clearSaved();
    travel.session.clearSelection();
    setStorageError(null);
    setStorageMessage("Saved plan deleted from this device.");
  }
  function refresh(saved: CitySavedSelection) {
    session.edit();
    travel.session.edit(false);
    setAirports(null);
    const request = refreshCityRequest(saved),
      next = draftFromCityRequest(request, saved.origin, saved.destination);
    setDraft(next);
    setManual(request.confirmedOptions);
    setManualKey((k) => k + 1);
    setTurns([]);
    setMessage("");
    setErrors({});
    setStorageMessage(null);
    setStarted(true);
    setEditing(false);
    addTurn(
      "user",
      "Refresh the saved itinerary using its original cities, trip times and source check timestamps.",
    );
    void session.compare(request, saved.origin, saved.destination, true);
  }
  function addManual(candidate: CityCandidate) {
    if (manual.length >= 12) {
      setStorageError(
        "Remove or change the trip before adding more than 12 checked options.",
      );
      return;
    }
    const candidates = [...manual, candidate];
    session.edit(true);
    setManual(candidates);
    void compare(
      draft,
      candidates,
      true,
      undefined,
      "Compare this option I checked directly with the operator.",
    );
  }
  const selected = state.result?.plans.find(
      (plan) => plan.id === state.selectedId,
    ),
    googleSelected = !!selected && containsCityGoogle(selected),
    savedRecord = record.ok ? record.value : null;
  const canSave =
    (!!selected && session.canUseResult()) ||
    (travel.state.selected && travel.session.usable());
  const editor = (
    <>
      <AirportChoices
        origin={draft.origin}
        destination={draft.destination}
        from={from}
        to={to}
        open={
          travel.state.result?.assistance?.clarification?.field === "airport"
        }
        onChange={(from, to) => {
          setAirports({ from, to });
          session.edit(true);
          travel.session.edit(true);
        }}
      />
      <CityStarterForm
        draft={draft}
        errors={errors}
        busy={state.busy}
        started={started}
        onChange={edit}
        onSubmit={() => void compare()}
      />
    </>
  );
  // Trip facts are explicitly confirmed in the form. Assistance can only patch driving and priority.
  const clarification = state.assistance?.clarification;
  return (
    <>
      <a
        href="#trip-form"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-3"
      >
        Skip to trip details
      </a>
      <header className="border-b border-t-4 border-t-[#153247] bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <a href="/" className="font-semibold">
            Travel recovery companion
          </a>
          <Badge variant="secondary" className="text-green-800">
            Device-local saving
          </Badge>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Where are you trying to get to?
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Start with your cities. We’ll work through the whole journey with you.
        </p>
        <p className="mt-3 rounded-md bg-slate-100 p-3 text-sm font-medium">
          Compare ground travel and flight quotes. Explore an origin overnight
          when you need it.
        </p>
        {!started ? (
          <section
            className="mt-7 rounded-lg border bg-white p-5 sm:p-7"
            aria-label="Start your recovery"
          >
            {editor}
          </section>
        ) : (
          <>
            <div className="mt-6 border-l-4 border-primary bg-white px-4 py-3 text-sm">
              <strong>
                {draft.origin?.name}, {draft.origin?.stateCode} to{" "}
                {draft.destination?.name}, {draft.destination?.stateCode}
              </strong>
              <p className="mt-1">
                City center estimates for one adult. Sources may be unavailable;
                each option shows what was checked.
              </p>
            </div>
            <details
              open={editing}
              onToggle={(event) => setEditing(event.currentTarget.open)}
              className="my-5 rounded-md border bg-white p-4"
            >
              <summary className="cursor-pointer text-sm font-medium">
                Edit trip
                {clarification && clarification.field !== "hotel"
                  ? " · Confirm the requested facts"
                  : ""}
              </summary>
              <div className="mt-5">{editor}</div>
            </details>
            <section
              role="log"
              aria-label="Recovery conversation"
              aria-live="polite"
              aria-relevant="additions"
              className="space-y-5"
            >
              {turns.map((turn) => (
                <article
                  key={turn.id}
                  className={`conversation-turn rounded-lg px-4 py-3 text-sm leading-relaxed ${
                    turn.role === "user" ? "ml-8 border bg-white" : "mr-3"
                  }`}
                >
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {turn.role === "user" ? "You" : "Recovery companion"}
                  </p>
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                </article>
              ))}
              <p role="status" className="text-sm">
                {state.busy
                  ? "Checking available journey facts…"
                  : state.result
                    ? cityResultCount(state.result)
                    : "Confirm your trip details to compare options."}
              </p>
              {state.dirty && (
                <p role="status" className="text-sm">
                  Your previous comparison is shown below. Confirm the edited
                  trip facts to update it.
                </p>
              )}
              {state.error && (
                <Alert role="alert">
                  <AlertTitle>Comparison unavailable</AlertTitle>
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              )}
              {state.assistance && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">
                    Source and assessment activity
                  </summary>
                  <p className="mt-2">
                    {state.assistance.status === "completed"
                      ? "Refinement complete"
                      : state.assistance.status === "limited"
                        ? "Limited assistance"
                        : "Assistance unavailable"}
                  </p>
                  {state.assistance.activity.map((item, index) => (
                    <p key={index} className="mt-2">
                      {item.tool.replaceAll("_", " ")} · {item.status}:{" "}
                      {item.message}
                      <span className="block text-xs text-muted-foreground">
                        Checked {item.checkedAt}
                      </span>
                    </p>
                  ))}
                </details>
              )}
              {state.result && (
                <>
                  <div className="space-y-3">
                    {state.result.plans.map((plan) => (
                      <CityPlanCard
                        key={plan.id}
                        plan={plan}
                        origin={state.result!.origin}
                        destination={state.result!.destination}
                        busy={!session.canUseResult()}
                        selected={state.selectedId === plan.id}
                        saved={state.saved}
                        onSelect={() => {
                          setStorageMessage(null);
                          session.select(plan.id);
                          if (session.getSnapshot().selectedId === plan.id)
                            travel.session.clearSelection();
                        }}
                      />
                    ))}
                  </div>
                  {state.result.rejected.length > 0 && (
                    <details
                      className="text-sm"
                      open={state.result.plans.length === 0}
                    >
                      <summary className="cursor-pointer font-medium">
                        Other routes and limits ({state.result.rejected.length})
                      </summary>
                      <p className="my-3 text-muted-foreground">
                        These are informational and cannot be chosen. Long
                        drives need a rest and vehicle plan.
                      </p>
                      <div className="space-y-3">
                        {state.result.rejected.map((plan) => (
                          <CityPlanCard
                            key={plan.id}
                            plan={plan}
                            origin={state.result!.origin}
                            destination={state.result!.destination}
                          />
                        ))}
                      </div>
                    </details>
                  )}
                  {state.result.warnings.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium">
                        Comparison limits and warnings
                      </summary>
                      <ul className="mt-3 list-disc space-y-2 pl-5">
                        {state.result.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
              {state.history.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Earlier comparisons
                  </summary>
                  <p className="my-3 text-sm">
                    Historical options use earlier trip facts and cannot be
                    selected.
                  </p>
                  {state.history.map((result, index) => (
                    <div key={index} className="mt-3 space-y-2">
                      {result.plans.map((plan) => (
                        <CityPlanCard
                          key={plan.id}
                          plan={plan}
                          origin={result.origin}
                          destination={result.destination}
                          historical
                        />
                      ))}
                    </div>
                  ))}
                </details>
              )}
            </section>
            <TravelRecoveryPanel
              controller={travel}
              onChoose={() => session.clearSelection()}
            />
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-2" aria-label="Quick replies">
                {(
                  [
                    ["cheapest", "Cheaper"],
                    ["no-driving", "No driving"],
                    ["fewest_transfers", "Fewer changes"],
                    ["overnight", "Explore overnight"],
                  ] as const
                ).map(([kind, label]) => (
                  <Button
                    variant="outline"
                    key={kind}
                    disabled={
                      state.busy ||
                      travel.state.busy ||
                      state.dirty ||
                      (!state.result && !travel.state.result) ||
                      ((kind === "cheapest" || kind === "fewest_transfers") &&
                        !session.canRerank() &&
                        !travel.session.usable())
                    }
                    onClick={() => quickReply(kind)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {!state.dirty && state.result && !session.canRerank() && (
                <p className="text-sm text-muted-foreground">
                  Source checks need refreshing. Choose “Recheck available
                  sources” before changing priorities.
                </p>
              )}
              <form
                className="space-y-3 rounded-lg border bg-white p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = message.trim();
                  if (!text || state.busy || state.dirty) return;
                  setMessage("");
                  if (
                    /^(cheaper|cheapest|fewer changes|fewest transfers)[.!?]?$/i.test(
                      text,
                    )
                  ) {
                    quickReply(
                      /cheap/i.test(text) ? "cheapest" : "fewest_transfers",
                    );
                  } else if (
                    /flight|fly|airport|hotel|overnight|stay|security|connection|transfer/i.test(
                      text,
                    )
                  )
                    travelMessage(text);
                  else void compare(draft, manual, true, text, text);
                }}
              >
                <label
                  htmlFor="city-message"
                  className="block text-sm font-medium"
                >
                  Message about your trip
                </label>
                <textarea
                  id="city-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={500}
                  rows={2}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="What would make this journey work better?"
                  aria-describedby="city-conversation-help"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p
                    id="city-conversation-help"
                    className="max-w-sm text-xs leading-relaxed text-muted-foreground"
                  >
                    Messages and bounded recent conversation stay in this tab
                    and are sent to enabled assistance. They are never saved
                    with your itinerary.
                  </p>
                  <Button
                    type="submit"
                    disabled={
                      state.busy ||
                      travel.state.busy ||
                      state.dirty ||
                      !message.trim()
                    }
                  >
                    Send message
                  </Button>
                </div>
                {!configured && (
                  <p className="text-xs text-muted-foreground">
                    Assisted refinement is unavailable. Confirm trip facts or
                    add an option you checked.
                  </p>
                )}
              </form>
              <Button
                variant="outline"
                disabled={state.busy || state.dirty}
                onClick={() => void compare(draft, manual, true)}
              >
                Recheck available sources
              </Button>
              {travel.state.result?.request.overnight && (
                <Button
                  variant="outline"
                  disabled={
                    state.busy ||
                    travel.state.busy ||
                    state.dirty ||
                    travel.state.dirty
                  }
                  onClick={() =>
                    void compare(
                      draft,
                      manual,
                      true,
                      undefined,
                      "Search same-day flights",
                      "same-day",
                    )
                  }
                >
                  Search same-day flights
                </Button>
              )}
              <div className="space-y-2">
                <Button disabled={!canSave} onClick={save}>
                  Save on this device
                </Button>
                {googleSelected && (
                  <p className="text-sm text-amber-900">
                    {GOOGLE_SAVE_MESSAGE}
                  </p>
                )}
              </div>
            </div>
            {draft.origin && draft.destination && (
              <ManualCityOption
                key={manualKey}
                origin={draft.origin}
                destination={draft.destination}
                busy={state.busy || state.dirty}
                onAdd={addManual}
              />
            )}
          </>
        )}
        {storageMessage && (
          <p role="status" className="mt-4 text-sm text-green-800">
            {storageMessage}
          </p>
        )}
        {(storageError || !record.ok) && (
          <Alert role="alert" className="mt-4">
            <AlertTitle>Device storage</AlertTitle>
            <AlertDescription>
              {storageError || (!record.ok ? record.message : "")}
            </AlertDescription>
            {!savedRecord && (
              <Button variant="outline" className="mt-3" onClick={deleteSaved}>
                Delete saved plan
              </Button>
            )}
          </Alert>
        )}
        {savedRecord && (
          <div className="mt-6">
            {savedRecord.schemaVersion === 3 ? (
              <TravelHistoryPanel
                history={savedRecord}
                onRefresh={refreshTravel}
                onDelete={deleteSaved}
              />
            ) : (
              <CityHistoryPanel
                saved={savedRecord}
                busy={state.busy}
                configured={configured}
                onDelete={deleteSaved}
                onRefresh={refresh}
              />
            )}
          </div>
        )}
        <details className="mt-8 border-t pt-5">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Try a demonstration
          </summary>
          <p className="my-3 text-sm text-muted-foreground">
            Separate Boston Logan to Portland, Maine airport examples. All
            onward itineraries are fictional; hotel sandbox rates are test data.
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <a className="underline" href="/legacy?demo=daytime">
              Daytime fictional example
            </a>
            <a className="underline" href="/legacy?demo=overnight">
              Overnight fictional example
            </a>
            <a className="underline" href="/legacy?demo=sandbox">
              Try hotel sandbox
            </a>
          </div>
        </details>
        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          Confirm schedules, prices and availability with the operator. Saving
          keeps one itinerary in this browser on this device. No accounts,
          tickets or reservations are created.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          City names and locations:{" "}
          <a
            className="underline"
            href="https://www.geonames.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            GeoNames
          </a>
          , licensed under{" "}
          <a
            className="underline"
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
          >
            CC BY 4.0
          </a>
          .
        </p>
      </main>
      <LegalFooter />
    </>
  );
}
