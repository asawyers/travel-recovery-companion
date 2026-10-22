import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CityCandidate, CitySavedSelection } from "@domain/city-contracts";
import { nearestAirports } from "@domain/airport-metadata";
import {
  type TravelRequestBinding,
  TravelTripSchema,
} from "@domain/travel-contracts";
import {
  buildTravelRequest,
  nearbyArrivalAirport,
  useTravelRecovery,
} from "../travel/useTravelRecovery";
import {
  AirportChoices,
  TravelRecoveryPanel,
} from "../travel/TravelRecoveryPanel";
import { hasOnwardConversationContext, isTravelMessage, travelConversationGuidance, travelMessageTarget } from "../travel/travelConversation";
import { TravelHistoryPanel } from "../travel/TravelHistoryPanel";
import {
  readTravelHistory,
  travelSnapshot,
  writeTravelSelection,
} from "../travel/savedSelection";
import { cityAnswer, cityResultCount } from "./conversationModel";
import { Badge } from "@/components/ui/badge";
import {
  AgentActivityList,
  CompanionAvatar,
  CompanionStatus,
  LoadingSpinner,
} from "@/components/ui/companion";
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
import { containsTravelGoogleMaps } from "../travel/savedSelectionSchema";
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
  const visiblePlans = state.result?.plans.filter((plan) => plan.kind !== "driving_estimate") ?? [];
  const visibleRejected = state.result?.rejected.filter((plan) => plan.kind !== "driving_estimate") ?? [];
  const [draft, setDraft] = useState(emptyCityDraft);
  const travel = useTravelRecovery();
  const nearbyTravel = useTravelRecovery();
  const [activeTravel, setActiveTravel] = useState<"primary" | "nearby" | null>(null);
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
  const alternative = nearbyArrivalAirport(draft.destination, from, to);
  const travelReported = useRef(0);
  const nearbyReported = useRef(0);
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
  const conversationScroll = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  useEffect(() => {
    const panel = conversationScroll.current;
    if (panel && started && !editing && followConversation.current) {
      panel.scrollTop = panel.scrollHeight;
    }
  }, [turns, state.busy, travel.state.busy, nearbyTravel.state.busy, started, editing]);
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
    if (role === "user") followConversation.current = true;
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
      travel.session.applyPreferences({ ...assistance.appliedPreferences, drivingAllowed: false });
      nearbyTravel.session.applyPreferences({ ...assistance.appliedPreferences, drivingAllowed: false });
    }
    if (!assistance?.clarification) {
      setDraft((current) => ({
        ...current,
        priority: state.result!.request.priority,
        drivingAllowed: false,
      }));
      if (state.result.request.drivingAllowed) {
        session.applyPreferences({ drivingAllowed: false });
      }
    }
  }, [state, session]);
  function edit(next: CityDraft) {
    const cityChanged =
      next.origin?.id !== draft.origin?.id ||
      next.destination?.id !== draft.destination?.id;
    session.edit(!cityChanged);
    travel.session.edit(!cityChanged);
    nearbyTravel.session.edit(!cityChanged);
    if (cityChanged) { setAirports(null); setActiveTravel(null); }
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
    setDraft({ ...next, drivingAllowed: false, readyAt: built.request.readyAt });
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
      if (!investigate) { travel.session.rerank(built.request.priority); nearbyTravel.session.rerank(built.request.priority); }
      else {
        const {
          version: _version,
          mode: _mode,
          confirmedOptions: _options,
          ...trip
        } = built.request;
        const active = travel.state.result?.request ?? nearbyTravel.state.result?.request;
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
        const nearbyAirport = nearbyArrivalAirport(next.destination, from, to);
        const alternateInput = nearbyAirport && buildTravelRequest(TravelTripSchema.parse(trip), next.origin, from, nearbyAirport.airport.iata, Boolean(preserve && active.overnight));
        if (alternateInput) {
          if (input) { alternateInput.departureDate = input.departureDate; alternateInput.overnight = input.overnight; }
          void nearbyTravel.session.search(alternateInput);
        } else nearbyTravel.session.edit(false);
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
    kind: "cheapest" | "fewest_transfers" | "overnight",
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
          TravelTripSchema.parse({ ...tripFacts, drivingAllowed: false }),
          draft.origin,
          from,
          to,
          true,
        );
        addTurn("user", "Explore overnight");
        if (input) void travel.session.search(input);
        else travel.session.unavailable();
        const alternateInput = alternative && buildTravelRequest(TravelTripSchema.parse({ ...tripFacts, drivingAllowed: false }), draft.origin, from, alternative.airport.iata, true);
        if (alternateInput) void nearbyTravel.session.search(alternateInput);
      }
      return;
    }
    if (
      (kind === "cheapest" || kind === "fewest_transfers") &&
      !session.canRerank() &&
      !travel.session.usable() &&
      !nearbyTravel.session.usable()
    ) {
      session.expire();
      travel.session.expire();
      nearbyTravel.session.expire();
      return;
    }
    const next = {
      ...draft,
      priority: kind,
      drivingAllowed: false,
    };
    setDraft(next);
    if (!session.canRerank()) {
      travel.session.rerank(kind);
      nearbyTravel.session.rerank(kind);
      addTurn("user", kind === "cheapest" ? "Cheaper" : "Fewer changes");
      return;
    }
    void compare(
      next,
      manual,
      false,
      undefined,
      kind === "cheapest" ? "Cheaper" : "Fewer changes",
    );
  }
  useEffect(() => {
    const t = travel.state;
    if (t.busy || !t.result || t.error || t.sequence === travelReported.current)
      return;
    travelReported.current = t.sequence;
    const assistance = t.result.assistance;
    const guidance = travelConversationGuidance(t.result, false, Boolean(t.hotel));
    addTurn("assistant", guidance.summary);
    if (guidance.openTripEditor) setEditing(true);
    if (guidance.reviewFacts) travel.session.reviewFacts();
    if (
      assistance?.status === "completed" &&
      Object.keys(assistance.appliedPreferences).length
    ) {
      setDraft((current) => ({ ...current, ...assistance.appliedPreferences, drivingAllowed: false }));
      session.applyPreferences({ ...assistance.appliedPreferences, drivingAllowed: false });
      nearbyTravel.session.applyPreferences({ ...assistance.appliedPreferences, drivingAllowed: false });
    }
    if (!assistance?.clarification && t.result.request.trip.drivingAllowed) {
      travel.session.applyPreferences({ drivingAllowed: false });
    }
  }, [travel.state]);
  useEffect(() => {
    const t = nearbyTravel.state;
    if (t.busy || !t.result || t.error || t.sequence === nearbyReported.current) return;
    nearbyReported.current = t.sequence;
    const result = t.result;
    const assistance = result.assistance;
    if (assistance?.status === "completed" && Object.keys(assistance.appliedPreferences).length) {
      const patch = { ...assistance.appliedPreferences, drivingAllowed: false };
      setDraft(current => ({ ...current, ...patch }));
      session.applyPreferences(patch);
      travel.session.applyPreferences(patch);
      if (result.request.trip.drivingAllowed) nearbyTravel.session.applyPreferences({ drivingAllowed: false });
    }
    if (!assistance?.clarification && result.request.trip.drivingAllowed) nearbyTravel.session.applyPreferences({ drivingAllowed: false });
    const guidance = travelConversationGuidance(result, true, Boolean(t.hotel));
    addTurn("assistant", guidance.summary);
    if (guidance.openTripEditor) setEditing(true);
    if (guidance.reviewFacts) nearbyTravel.session.reviewFacts();
  }, [nearbyTravel.state]);
  function travelMessage(text: string) {
    const target = travelMessageTarget({ text, primaryAirport: to, nearbyAirport: alternative?.airport.iata, active: activeTravel,
      primaryResult: Boolean(travel.state.result), nearbyResult: Boolean(nearbyTravel.state.result),
      primaryHasFlights: Boolean(travel.state.result?.flightOffers.length), nearbyHasFlights: Boolean(nearbyTravel.state.result?.flightOffers.length) });
    const controller = target === "nearby" ? nearbyTravel : travel;
    setActiveTravel(target);
    const result = controller.state.result;
    const turnId = crypto.randomUUID();
    addTurn("user", text, turnId);
    let input: TravelRequestBinding | null = result
      ? {
          ...result.request,
          trip: {
            ...result.request.trip,
            priority: draft.priority,
            drivingAllowed: false,
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
      controller.session.usable() &&
      !state.dirty &&
      !controller.state.editingFacts &&
      !result.selectionIssue &&
      result.request.originAirportIata === from &&
      result.request.destinationAirportIata === (controller === nearbyTravel ? alternative?.airport.iata : to) &&
      Object.entries(result.request.trip).every(
        ([key, value]) => current[key as keyof typeof current] === value,
      ) &&
      controller.state.flight?.id === confirmed.flightOfferId &&
      controller.state.flight.fingerprint === confirmed.flightFingerprint &&
      (result.request.overnight
        ? controller.state.hotel?.id === confirmed.hotelOfferId &&
          controller.state.hotel.fingerprint === confirmed.hotelFingerprint
        : confirmed.hotelOfferId === null && controller.state.hotel === null)
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
          controller === nearbyTravel ? alternative?.airport.iata ?? to : to,
          wantsOvernight,
        );
      }
    }
    if (!input) {
      controller.session.unavailable();
      return;
    }
    void controller.session.search({
      ...input,
      refinement: text,
      conversation: conversationContext(turnId, session.revision, turns),
    });
  }
  function refreshTravel(request: TravelRequestBinding) {
    setActiveTravel(null);
    session.edit();
    travel.session.edit(false);
    nearbyTravel.session.edit(false);
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
    void travel.session.search({ ...request, trip: { ...request.trip, drivingAllowed: false } });
  }
  function save() {
    const chosenTravel = nearbyTravel.state.selected ? nearbyTravel : travel;
    if (
      chosenTravel.state.selected &&
      chosenTravel.state.result &&
      chosenTravel.session.usable()
    ) {
      const snap = travelSnapshot(
        chosenTravel.state.result,
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
    if (!state.result || !state.selectedId || !selected || !session.canUseResult()) return;
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
    nearbyTravel.session.clearSelection();
    setStorageError(null);
    setStorageMessage("Saved plan deleted from this device.");
  }
  function refresh(saved: CitySavedSelection) {
    setActiveTravel(null);
    session.edit();
    travel.session.edit(false);
    nearbyTravel.session.edit(false);
    setAirports(null);
    const request = { ...refreshCityRequest(saved), drivingAllowed: false },
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
  const selected = visiblePlans.find(
      (plan) => plan.id === state.selectedId,
    ),
    googleSelected = (!!selected && containsCityGoogle(selected)) ||
      (travel.state.selected && containsTravelGoogleMaps(travel.state.result?.journey)) ||
      (nearbyTravel.state.selected && containsTravelGoogleMaps(nearbyTravel.state.result?.journey)),
    savedRecord = record.ok ? record.value : null;
  const canSave =
    (!!selected && session.canUseResult()) ||
    (travel.state.selected && travel.session.usable()) ||
    (nearbyTravel.state.selected && nearbyTravel.session.usable());
  const editor = (
    <>
      <AirportChoices
        origin={draft.origin}
        destination={draft.destination}
        from={from}
        to={to}
        open={
          travel.state.result?.assistance?.clarification?.field === "airport" || nearbyTravel.state.result?.assistance?.clarification?.field === "airport"
        }
        onChange={(from, to) => {
          setAirports({ from, to });
          setActiveTravel(null);
          session.edit(true);
          travel.session.edit(true);
          nearbyTravel.session.edit(true);
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
  // Trip facts are explicitly confirmed in the form. Assistance can patch priority; standalone driving stays disabled.
  const clarification = state.assistance?.clarification;
  const savedPlan = (
    <>
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
    </>
  );
  const supportingContent = (
    <div className="recovery-supporting-content">
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
      {started && <LegalFooter />}
    </div>
  );
  return (
    <div className={started ? "recovery-app recovery-app-started" : "recovery-app"}>
      <a
        href="#trip-form"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-3"
      >
        Skip to trip details
      </a>
      <header className="recovery-header border-b bg-white">
        <div className="recovery-header-inner mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <a href="/" className="flex items-center gap-3 font-semibold text-[#173247]">
            <CompanionAvatar size="sm" />
            Travel recovery companion
          </a>
          <Badge variant="secondary" className="bg-[#E8F3F1] text-[#126B70]">
            Device-local saving
          </Badge>
        </div>
      </header>
      <main className={`recovery-main mx-auto px-4 py-8 sm:px-6 ${started ? "max-w-[1280px]" : "max-w-3xl sm:py-12"}`}>
        <div className={started ? "recovery-intro mb-6" : "mb-8 max-w-xl"}>
          <h1 className={started ? "companion-heading text-2xl font-semibold tracking-tight" : "companion-heading text-3xl font-semibold tracking-tight sm:text-4xl"}>
            Where are you trying to get to?
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {started ? "Talk through your next step here, and compare the journey options alongside." : "Start with your cities. We’ll work through the whole journey with you."}
          </p>
          {!started && (
            <p className="mt-4 text-sm leading-relaxed text-[#126B70]">
              Compare ground travel and flight quotes. Explore an origin overnight when you need it.
            </p>
          )}
        </div>
        {!started ? (
          <>
            <section
              className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8"
              aria-label="Start your recovery"
            >
              {editor}
            </section>
            {savedPlan}
          </>
        ) : (
          <div className="recovery-panes grid items-start gap-6">
            <aside aria-label="Trip conversation" className="recovery-conversation min-w-0 rounded-2xl border bg-white shadow-sm">
              <div className="recovery-conversation-heading flex shrink-0 items-center gap-3 border-b px-5 py-4">
                <CompanionAvatar />
                <div>
                  <h2 className="companion-heading font-semibold">Your recovery companion</h2>
                  <p className="mt-1 text-sm text-muted-foreground">We’ll work through the next step together.</p>
                </div>
              </div>
              <div
                ref={conversationScroll}
                role="region"
                aria-label="Conversation history"
                tabIndex={0}
                onScroll={(event) => {
                  const panel = event.currentTarget;
                  followConversation.current = panel.scrollHeight - panel.clientHeight - panel.scrollTop <= 48;
                }}
                className="recovery-conversation-history"
              >
                <div className="border-b bg-[#F4F7FA] px-5 py-4 text-sm">
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
                  className="border-b bg-white px-5 py-3"
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
                  className="space-y-5 bg-[#F4F7FA]/60 px-4 py-5"
                >
                  {turns.map((turn) => (
                    <article
                      key={turn.id}
                      className={`conversation-turn flex items-start gap-3 text-sm leading-relaxed ${
                        turn.role === "user" ? "ml-8 flex-row-reverse" : "mr-2"
                      }`}
                    >
                      {turn.role === "assistant" ? (
                        <CompanionAvatar size="sm" className="mt-1 shrink-0" />
                      ) : (
                        <span aria-hidden="true" className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#E5EDF7] text-xs font-semibold text-[#285FCB]">Y</span>
                      )}
                      <div className={`min-w-0 rounded-2xl px-4 py-3 ${turn.role === "user" ? "rounded-tr-sm bg-[#EAF1FB] text-[#173247]" : "rounded-tl-sm border bg-white"}`}>
                        <p className="mb-1 text-xs font-semibold text-muted-foreground">
                          {turn.role === "user" ? "You" : "Recovery companion"}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{turn.content}</p>
                      </div>
                    </article>
                  ))}
                  {state.busy ? (
                    <CompanionStatus label="Checking available journey facts…" />
                  ) : !state.result ? (
                    <p className="text-sm text-muted-foreground">
                      Confirm your trip details to compare options.
                    </p>
                  ) : null}
                  {(travel.state.busy || nearbyTravel.state.busy) && (
                    <CompanionStatus label="Checking flight and hotel options…" />
                  )}
                  {state.notice && (
                    <p role="status" className="rounded-xl bg-[var(--companion-paper)] p-3 text-sm text-muted-foreground">
                      {state.notice}
                    </p>
                  )}
                  {state.error && (
                    <Alert role="alert">
                      <AlertTitle>Comparison unavailable</AlertTitle>
                      <AlertDescription>{state.error}</AlertDescription>
                    </Alert>
                  )}
                  {state.assistance && (
                    <details className="rounded-xl border bg-white p-3 text-sm">
                      <summary className="cursor-pointer font-medium">
                        Source and assessment activity
                      </summary>
                      <p className="mt-2 text-muted-foreground">
                        {state.assistance.status === "completed"
                          ? "Refinement complete"
                          : state.assistance.status === "limited"
                            ? "Limited assistance"
                            : "Assistance unavailable"}
                      </p>
                      <AgentActivityList activity={state.assistance.activity} />
                    </details>
                  )}

                </section>
              </div>
              <div className="recovery-composer border-t bg-white p-4">
                <div className="recovery-quick-replies flex flex-wrap gap-2" aria-label="Quick replies">
                  {(
                    [
                      ["cheapest", "Cheaper"],
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
                        nearbyTravel.state.busy ||
                        state.dirty ||
                        (!state.result && !travel.state.result && !nearbyTravel.state.result) ||
                        ((kind === "cheapest" || kind === "fewest_transfers") &&
                          !session.canRerank() &&
                          !travel.session.usable() && !nearbyTravel.session.usable())
                      }
                      onClick={() => quickReply(kind)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {!state.dirty && state.result && !session.canRerank() && (
                  <p className="text-sm text-muted-foreground">
                    This comparison is unavailable. Refresh sources to try again.
                  </p>
                )}
                <form
                  className="recovery-message-form space-y-3"
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
                      isTravelMessage(text, [from, to, alternative?.airport.iata ?? ""], hasOnwardConversationContext(travel.state, nearbyTravel.state, activeTravel))
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
                    className="recovery-message-input min-h-20 w-full resize-y rounded-xl border bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="What would make this journey work better?"
                    aria-describedby="city-conversation-help"
                  />
                  <div className="recovery-message-send flex flex-wrap items-center justify-end gap-3">
                    <Button
                      type="submit"
                      disabled={
                        state.busy ||
                        travel.state.busy ||
                        nearbyTravel.state.busy ||
                        state.dirty ||
                        !message.trim()
                      }
                    >
                      {(state.busy || travel.state.busy || nearbyTravel.state.busy) && <LoadingSpinner />}
                      Send message
                    </Button>
                  </div>
                  <details className="recovery-message-privacy text-sm text-muted-foreground">
                    <summary className="cursor-pointer">About messages and privacy</summary>
                    <p
                      id="city-conversation-help"
                      className="text-sm leading-relaxed text-muted-foreground"
                    >
                      Messages and bounded recent conversation stay in this tab
                      and are sent to enabled assistance. They are never saved
                      with your itinerary.
                    </p>
                  </details>
                  {!configured && (
                    <p className="recovery-message-unavailable text-sm text-muted-foreground">
                      Assisted refinement is unavailable. Confirm trip facts or
                      add an option you checked.
                    </p>
                  )}
                </form>

              </div>
            </aside>
            <section aria-label="Travel options" tabIndex={0} className="recovery-options min-w-0 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                <div>
                  <h2 className="companion-heading text-xl font-semibold">Travel options</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Compare ground travel and flight quotes. Explore an origin overnight when you need it.</p>
                </div>
                {(state.busy || travel.state.busy || nearbyTravel.state.busy) && <Badge variant="secondary" className="gap-2"><LoadingSpinner /> Checking sources</Badge>}
              </div>
              {(state.result || travel.state.result || nearbyTravel.state.result) && (
                <p className="text-sm text-muted-foreground">
                  Prices and availability may change. Keep planning with these estimates, or refresh sources whenever you like.
                </p>
              )}
              {state.result && <p role="status" className="text-sm text-muted-foreground">{cityResultCount(state.result)}</p>}
              {state.dirty && (
                <p role="status" className="rounded-xl border border-[#DCC5A7] bg-[#FFF8EE] p-4 text-sm text-[#A35B12]">
                  Your previous comparison is shown below. Confirm the edited trip facts to update it.
                </p>
              )}
              {state.result && (
                <>
                  <div className="space-y-3">
                    {visiblePlans.map((plan) => (
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
                          if (session.getSnapshot().selectedId === plan.id) {
                            travel.session.clearSelection();
                            nearbyTravel.session.clearSelection();
                          }
                        }}
                      />
                    ))}
                  </div>
                  {visibleRejected.length > 0 && (
                    <details
                      className="text-sm"
                      open={visiblePlans.length === 0}
                    >
                      <summary className="cursor-pointer font-medium">
                        Other routes and limits ({visibleRejected.length})
                      </summary>
                      <p className="my-3 text-muted-foreground">
                        These routes do not meet the current trip facts or need
                        more confirmation and cannot be chosen.
                      </p>
                      <div className="space-y-3">
                        {visibleRejected.map((plan) => (
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
                      {result.plans.filter((plan) => plan.kind !== "driving_estimate").map((plan) => (
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
              <TravelRecoveryPanel
                controller={travel}
                onActivate={() => setActiveTravel("primary")}
                onChoose={() => { session.clearSelection(); nearbyTravel.session.clearSelection(); }}
              />
              {(alternative || nearbyTravel.state.result) && <TravelRecoveryPanel
                controller={nearbyTravel}
                onActivate={() => setActiveTravel("nearby")}
                nearby
                destination={draft.destination}
                onChoose={() => { session.clearSelection(); travel.session.clearSelection(); }}
              />}

              <div className="flex flex-wrap items-start gap-3 rounded-xl border bg-white p-4">
                <Button
                  variant="outline"
                  disabled={state.busy || state.dirty}
                  onClick={() => void compare(draft, manual, true)}
                >
                  {state.busy && <LoadingSpinner />}
                  Recheck available sources
                </Button>
                {travel.state.result?.request.overnight && (
                  <Button
                    variant="outline"
                    disabled={
                      state.busy ||
                      travel.state.busy ||
                        nearbyTravel.state.busy ||
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

              {savedPlan}
              {supportingContent}
            </section>
          </div>
        )}
        {!started && supportingContent}
      </main>
      {!started && <LegalFooter />}
    </div>
  );
}
