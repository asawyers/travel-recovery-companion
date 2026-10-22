import {
  CITY_ADAPTER_REVISION,
} from "@domain/city-contracts";
import type {
  City,
  CityAssistance,
  CityFacts,
  CityRecoveryResult,
  CityRecoveryResponse,
  CityTripRequest,
} from "@domain/city-contracts";
import type { PreferencePatch } from "@domain/assistance";
import type { ConversationContext } from "@domain/conversation";
import { planCityRecovery } from "@domain/city-planner";
import { compareCityPublic } from "@/lib/city-api";
import { PublicPlannerError } from "@/lib/api";
import { matchesConversation } from "../recovery/conversation";
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function cityReuseKey(request: CityTripRequest): string {
  const { priority: _priority, ...facts } = request;
  return JSON.stringify(
    canonical({ revision: CITY_ADAPTER_REVISION, request: facts }),
  );
}
export type CityCache = { inputKey: string; facts: CityFacts };
export function canReuseCityFacts(
  cache: CityCache | null,
  request: CityTripRequest,
  now: number,
): boolean {
  if (
    !cache ||
    cache.inputKey !== cityReuseKey(request) ||
    cache.facts.adapterRevision !== CITY_ADAPTER_REVISION ||
    !Number.isFinite(now)
  )
    return false;
  const checked = Date.parse(cache.facts.checkedAt);
  return Number.isFinite(checked) && checked <= now &&
    Number.isFinite(Date.parse(cache.facts.expiresAt)) &&
    cache.facts.candidates.every(candidate => candidate.evidence.every(e => {
      const observed = Date.parse(e.checkedAt);
      return Number.isFinite(observed) && observed <= now &&
        (e.providerUpdatedAt === null || Date.parse(e.providerUpdatedAt) <= now) &&
        (e.expiresAt === null || Date.parse(e.expiresAt) >= observed);
    }));
}
export function responseMatchesRequest(
  input: CityTripRequest,
  output: CityTripRequest,
  patch: PreferencePatch | undefined,
): boolean {
  const hard = (r: CityTripRequest) => {
    const {
      confirmedOptions: _facts,
      priority: _priority,
      drivingAllowed: _driving,
      ...facts
    } = r;
    return JSON.stringify(canonical(facts));
  };
  return (
    hard(input) === hard(output) &&
    output.priority === (patch?.priority ?? input.priority) &&
    output.drivingAllowed === (patch?.drivingAllowed ?? input.drivingAllowed)
  );
}
export type CitySessionState = {
  result: CityRecoveryResult | null;
  history: CityRecoveryResult[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  selectedId: string | null;
  saved: boolean;
  assistance: CityAssistance | null;
  sequence: number;
  factsExpiresAt: string | null;
  dirty: boolean;
};
export type CitySessionOptions = {
  now: () => string;
  endpoint: () => string | null;
  transport: typeof compareCityPublic;
};
export class CitySession {
  options: CitySessionOptions;
  revision = 0;
  private sequence = 0;
  private pending: AbortController | null = null;
  private cache: CityCache | null = null;
  private listeners = new Set<() => void>();
  private state: CitySessionState = {
    result: null,
    history: [],
    busy: false,
    error: null,
    notice: null,
    selectedId: null,
    saved: false,
    assistance: null,
    sequence: 0,
    factsExpiresAt: null,
    dirty: false,
  };
  constructor(options: Partial<CitySessionOptions> = {}) {
    this.options = {
      now: () => new Date().toISOString(),
      endpoint: () => null,
      transport: compareCityPublic,
      ...options,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<CitySessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }
  dispose() {
    this.sequence++;
    this.pending?.abort();
    this.pending = null;
    this.cache = null;
    this.acceptedInput = null;
  }
  edit(preserveComparison = false) {
    this.revision++;
    this.dispose();
    if (preserveComparison) {
      this.update({ dirty: true, busy: false, error: null, notice: null });
      return;
    }
    this.update({
      dirty: false,
      result: null,
      history: [],
      selectedId: null,
      saved: false,
      assistance: null,
      busy: false,
      error: null,
      notice: null,
      factsExpiresAt: null,
    });
  }
  select(id: string) {
    const plan = this.state.result?.plans.find((p) => p.id === id);
    if (
      !plan?.selectable ||
      this.state.busy ||
      this.state.dirty ||
      this.state.error
    )
      return;
    const previous = this.state.result!;
    const assessed = planCityRecovery(previous.request,
      this.cache?.facts.candidates ?? previous.request.confirmedOptions, {
        now: this.options.now(), origin: previous.origin, destination: previous.destination,
      });
    const result = { ...assessed, generatedAt: previous.generatedAt,
      warnings: [...new Set([...assessed.warnings, ...previous.warnings])] };
    this.update({
      result: JSON.stringify(result) === JSON.stringify(previous) ? previous : result,
      selectedId: result.plans.some(value => value.id === id && value.selectable) ? id : null,
      saved: false, error: null,
    });
  }
  markSaved() {
    if (this.state.selectedId && this.canUseResult())
      this.update({ saved: true });
  }
  clearSelection() {
    this.update({ selectedId: null, saved: false });
  }
  clearSaved() {
    this.update({ saved: false });
  }
  expire() {
    if (this.expired())
      this.update({ notice: "Last-checked estimates are still available. Prices and availability may have changed; refresh whenever you want." });
  }
  expired() {
    const now = Date.parse(this.options.now());
    const sourceExpired =
      this.cache !== null &&
      (!this.acceptedInput ||
        !canReuseCityFacts(this.cache, this.acceptedInput, now));
    const originalExpired =
      this.state.result?.plans.some((plan) =>
        [plan.evidenceExpiresAt, ...plan.evidence.map((e) => e.expiresAt)].some(
          (expiry) => expiry !== null && Date.parse(expiry) <= now,
        ),
      ) ?? false;
    // A failed recheck may invalidate reusable candidates, but it cannot extend
    // the lifetime of the still-readable comparison.
    const retainedFactsExpired =
      this.state.factsExpiresAt !== null &&
      Date.parse(this.state.factsExpiresAt) <= now;
    return sourceExpired || originalExpired || retainedFactsExpired;
  }
  canUseResult() {
    return (
      !!this.state.result &&
      !this.state.busy &&
      !this.state.dirty &&
      !this.state.error
    );
  }
  canRerank() {
    if (!this.canUseResult()) return false;
    // Local supplied facts can be reassessed without a provider cache.
    return (
      this.state.factsExpiresAt === null ||
      (this.acceptedInput !== null &&
        canReuseCityFacts(
          this.cache,
          this.acceptedInput,
          Date.parse(this.options.now()),
        ))
    );
  }
  /** Apply an already authorized shared preference using accepted source facts with their original observation times. */
  applyPreferences(patch: PreferencePatch) {
    if (!Object.keys(patch).length) return;
    if (!this.canUseResult() || !this.canRerank()) {
      this.edit(true);
      return;
    }
    const previous = this.state.result!;
    const request = { ...previous.request, ...patch };
    const candidates = this.cache?.facts.candidates ?? request.confirmedOptions;
    const result = planCityRecovery(request, candidates, {
      now: this.options.now(), origin: previous.origin, destination: previous.destination,
    });
    this.revision++;
    if (this.acceptedInput && this.cache) {
      this.acceptedInput = { ...this.acceptedInput, ...patch };
      this.cache = { ...this.cache, inputKey: cityReuseKey(this.acceptedInput) };
    }
    this.update({ result, history: [...this.state.history, previous].slice(-3),
      selectedId: null, saved: false, assistance: null });
  }
  private acceptedInput: CityTripRequest | null = null;
  async compare(
    request: CityTripRequest,
    origin: City,
    destination: City,
    investigate = true,
    refinement?: string,
    conversation?: ConversationContext,
  ) {
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    const current = ++this.sequence,
      revision = this.revision;
    const live = () =>
      current === this.sequence &&
      revision === this.revision &&
      !controller.signal.aborted;
    const retained = this.canUseResult() && !refinement?.trim() && !conversation && this.acceptedInput !== null &&
      canReuseCityFacts(this.cache, request, Date.parse(this.options.now())) &&
      cityReuseKey(this.acceptedInput) === cityReuseKey(request);
    this.update({ busy: true, error: null, notice: null, sequence: current });
    try {
      const now = this.options.now(),
        endpoint = this.options.endpoint();
      let result: CityRecoveryResult, assistance: CityAssistance | undefined;
      let factsExpiresAt: string | null = null;
      if (
        !investigate &&
        !refinement?.trim() &&
        (this.state.dirty ||
          (endpoint &&
            !canReuseCityFacts(this.cache, request, Date.parse(now))))
      ) {
        this.update({
          busy: false,
          error: this.state.dirty
            ? "Confirm the edited trip facts before changing priorities."
            : "Trip facts changed. Confirm them before changing priorities.",
        });
        return;
      }
      if (
        !investigate &&
        !refinement?.trim() &&
        canReuseCityFacts(this.cache, request, Date.parse(now))
      ) {
        result = planCityRecovery(request, this.cache!.facts.candidates, {
          now,
          origin,
          destination,
        });
        factsExpiresAt = this.cache!.facts.expiresAt;
      } else if (endpoint) {
        const response: CityRecoveryResponse = await this.options.transport(
          endpoint,
          request,
          investigate,
          controller.signal,
          refinement,
          conversation,
        );
        if (!live()) return;
        if (
          !matchesConversation(
            conversation,
            response.conversation,
            this.revision,
          )
        ) {
          this.update({
            busy: false,
            error:
              "That reply belongs to an earlier trip or message. Current trip facts are retained; send the message again.",
          });
          return;
        }
        if (
          !responseMatchesRequest(
            request,
            response.result.request,
            response.assistance?.appliedPreferences,
          )
        ) {
          this.update({
            busy: false,
            error:
              "The planner changed trip facts without confirmation. Current trip facts are retained; confirm them and retry.",
          });
          return;
        }
        assistance = response.assistance;
        if (assistance?.clarification && this.state.result) {
          this.update({ busy: false, assistance });
          return;
        }
        result = response.result;
        factsExpiresAt = response.facts.expiresAt;
        this.acceptedInput = {
          ...request,
          priority: result.request.priority,
          drivingAllowed: result.request.drivingAllowed,
        };
        this.cache = {
          inputKey: cityReuseKey(this.acceptedInput),
          facts: response.facts,
        };
      } else {
        result = planCityRecovery(request, request.confirmedOptions, {
          now,
          origin,
          destination,
        });
        result.warnings = [
          ...result.warnings,
          "Public planner unavailable: no live sources were checked. Add a complete option you checked directly with an operator.",
        ];
        if (refinement?.trim())
          assistance = {
            status: "unavailable",
            summary:
              "Assisted refinement is unavailable. Confirm trip facts below or use the quick replies to reassess supplied options.",
            appliedPreferences: {},
            selectedPlanId: null,
            activity: [],
          };
      }
      if (!live()) return;
      if (
        result.request.priority !== request.priority ||
        result.request.drivingAllowed !== request.drivingAllowed
      )
        this.revision++;
      this.update({
        result,
        factsExpiresAt,
        dirty: false,
        history: this.state.result
          ? [...this.state.history, this.state.result].slice(-3)
          : this.state.history,
        busy: false,
        selectedId: assistance?.selectedPlanId ?? null,
        saved: false,
        assistance: assistance ?? null,
      });
    } catch (error) {
      if (live()) {
        if (retained) {
          this.update({ busy: false, error: null,
            notice: "Could not refresh sources. Your last-checked estimates are still available; confirm current prices and availability with the operator." });
          return;
        }
        this.cache = null;
        this.update({
          busy: false,
          error:
            error instanceof PublicPlannerError
              ? error.message
              : "Comparison failed. Your inputs are retained; check the supplied facts and retry.",
        });
      }
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }
}
