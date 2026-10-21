import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import type { Draft, FormErrors } from "./formModel";

type Props = {
  draft: Draft;
  errors: FormErrors;
  synthetic: boolean;
  busy: boolean;
  configured: boolean;
  investigate: boolean;
  selectedHotelName?: string;
  hotelInvestigationNeeded: boolean;
  onInvestigate: (value: boolean) => void;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
  onExample: (kind: "daytime" | "overnight") => void;
  onReal: () => void;
  onHotelSandbox: () => void;
};
type TextFieldProps = {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  help?: string;
};
function TextField({
  name,
  label,
  value,
  onChange,
  error,
  type = "text",
  help,
}: TextFieldProps) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        type={type}
        step={
          type === "datetime-local"
            ? "1"
            : type === "number"
              ? "any"
              : undefined
        }
        value={value}
        maxLength={500}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={
          error ? `${name}-error` : help ? `${name}-help` : undefined
        }
      />
      {help && <FieldDescription id={`${name}-help`}>{help}</FieldDescription>}
      {error && <FieldError id={`${name}-error`}>{error}</FieldError>}
    </Field>
  );
}
function Check({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
    >
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}
function Choice({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full"
      >
        {options.map(([v, l]) => (
          <NativeSelectOption key={v} value={v}>
            {l}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
export function TripForm({
  draft: d,
  errors,
  synthetic,
  busy,
  configured,
  investigate,
  onInvestigate,
  selectedHotelName,
  hotelInvestigationNeeded,
  onChange,
  onSubmit,
  onExample,
  onReal,
  onHotelSandbox,
}: Props) {
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...d, [key]: value });
  const text = (
    key: keyof Draft,
    label: string,
    type = "text",
    help?: string,
  ) => (
    <TextField
      key={key}
      name={key}
      label={label}
      value={String(d[key])}
      type={type}
      help={help}
      error={errors[key]}
      onChange={(v) => update(key, v as never)}
    />
  );
  const transitText = (
    key: keyof Draft["transit"],
    label: string,
    type = "text",
  ) => (
    <TextField
      key={key}
      name={`transit-${key}`}
      label={label}
      type={type}
      value={String(d.transit[key])}
      onChange={(v) => update("transit", { ...d.transit, [key]: v })}
    />
  );
  const carText = (key: keyof Draft["car"], label: string, type = "text") => (
    <TextField
      key={key}
      name={`car-${key}`}
      label={label}
      type={type}
      value={String(d.car[key])}
      onChange={(v) => update("car", { ...d.car, [key]: v })}
    />
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }
  return (
    <section
      className="rounded-lg border bg-white"
      aria-labelledby="trip-heading"
    >
      <div className="border-b p-5">
        <h2 id="trip-heading" className="text-lg font-semibold">
          Your onward trip
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          1 adult · BOS to Portland, ME public destination
        </p>
      </div>
      <form
        id="trip-form"
        onSubmit={submit}
        noValidate
        className="space-y-5 p-5"
      >
        <p className="text-sm text-muted-foreground">
          All times: America/New_York. Enter arrival at the gate; airport exit
          time is added once.
        </p>
        {text("arrivalAt", "Revised gate arrival", "datetime-local")}
        {text(
          "originalDepartureAt",
          "Original onward departure",
          "datetime-local",
        )}
        {text("deadlineAt", "Final destination deadline", "datetime-local")}
        <div className="grid grid-cols-2 gap-3">
          {text(
            "budget",
            "Budget (USD)",
            "number",
            "Blank means no budget limit.",
          )}
          <Choice
            id="budgetMode"
            label="Budget limit"
            value={d.budgetMode}
            onChange={(v) => update("budgetMode", v as Draft["budgetMode"])}
            options={[
              ["soft", "Soft preference"],
              ["hard", "Hard maximum"],
            ]}
          />
        </div>
        <Choice
          id="priority"
          label="Priority"
          value={d.priority}
          onChange={(v) => update("priority", v as Draft["priority"])}
          options={[
            ["earliest", "Earliest arrival"],
            ["cheapest", "Cheapest complete price"],
            ["fewest_transfers", "Fewest vehicle changes"],
          ]}
        />
        <div>
          <Check
            id="drivingAllowed"
            checked={d.drivingAllowed}
            onChange={(v) => update("drivingAllowed", v)}
          >
            Allow driving
          </Check>
          <Check
            id="overnightAllowed"
            checked={d.overnightAllowed}
            onChange={(v) => update("overnightAllowed", v)}
          >
            Allow overnight stay
          </Check>
        </div>
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Airport and original connection allowances
          </summary>
          <div className="mt-4 space-y-4">
            {text(
              "airportExitMinutes",
              "Airport exit minutes",
              "number",
              "Gate to terminal exit, including bags. Default assumption: 45 min.",
            )}
            {text(
              "originalAccessMinutes",
              "Original terminal access minutes",
              "number",
            )}
            {text(
              "originalBoardingMinutes",
              "Original boarding minutes",
              "number",
            )}
          </div>
        </details>
        {d.overnightAllowed && (
          <fieldset className="space-y-4 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold">
              Intended stay
            </legend>
            <div className="grid grid-cols-2 gap-3">
              {text("checkin", "Check-in date", "date")}
              {text("checkout", "Check-out date", "date")}
            </div>
            {text(
              "guestNationality",
              "Guest nationality (2-letter country code)",
              "text",
              d.hotelSandbox ? "US is an explicit fictional demo default; edit for this test stay." : "Enter explicitly, for example US. Never inferred.",
            )}
            <p className="text-xs text-muted-foreground">
              {d.hotelSandbox ? "1 adult, 1 room. Investigate sandbox hotel rates to check the test source. Test rates need two property transfers and the fictional checkout-date transit before becoming a complete test journey." : "1 adult, 1 room. Choose Investigate available sources to check enabled hotel sources. Returned room rates need complete transfer and next-day transit facts before becoming a recovery journey."}
            </p>
          </fieldset>
        )}
        {(!synthetic || d.hotelSandbox) && d.overnightAllowed && d.hotel.hotelId && (
          <fieldset className="space-y-4 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold">Selected hotel journey</legend>
            <p className="text-sm font-medium">{selectedHotelName ?? `Selected property: ${d.hotel.hotelId}`}</p>
            {d.hotelSandbox && <p className="text-sm text-amber-950">Enter fictional test allowances for this property. All transfer costs entered here are test amounts; no transfer service is checked.</p>}
            <p className="text-xs text-muted-foreground">{d.hotelSandbox ? "Airport access starts at BOS terminal exit. Bind the second test transfer to the exact fictional boarding stop below. No shuttle or timetable is inferred. Blank fees stay unknown." : "Enter facts for this exact property. Airport access starts at BOS terminal exit. Hotel access to transit ends at the actual boarding stop in the confirmed train or bus below. No shuttle or timetable is inferred. Blank fees stay unknown."}</p>
            {([
              ["hotelMinutes", "Airport to hotel minutes", "number"],
              ["hotelCost", "Airport to hotel cost (USD)", "number"],
              ["checkinMinutes", "Hotel check-in minutes", "number"],
              ["leaveHotelAt", "Leave hotel at", "datetime-local"],
              ["stationMinutes", "Hotel to boarding stop minutes", "number"],
              ["stationCost", "Hotel to boarding stop cost (USD)", "number"],
            ] as const).map(([key, label, type]) => <TextField key={key} name={`hotel-${key}`} label={label} type={type} value={d.hotel[key]} onChange={value => update("hotel", { ...d.hotel, [key]: value })} />)}
            <Choice id="hotel-access-kind" label="Airport to hotel method" value={d.hotel.hotelKind} options={[["transfer", "Vehicle transfer"], ["walk", "Walk"]]} onChange={value => update("hotel", { ...d.hotel, hotelKind: value as "transfer" | "walk" })} />
            <Choice id="hotel-station-kind" label="Hotel to boarding stop method" value={d.hotel.stationKind} options={[["transfer", "Vehicle transfer"], ["walk", "Walk"]]} onChange={value => update("hotel", { ...d.hotel, stationKind: value as "transfer" | "walk" })} />
            <p className="break-words text-xs text-muted-foreground">Airport transfer checked {d.hotel.hotelCheckedAt || "when entered"}. Boarding stop transfer checked {d.hotel.stationCheckedAt || "when entered"}.</p>
            <Button type="button" variant="outline" onClick={() => update("hotel", { ...d.hotel, hotelCheckedAt: new Date().toISOString(), stationCheckedAt: new Date().toISOString() })}>I rechecked both hotel transfers</Button>
            <p className="text-xs text-muted-foreground">New or changed hotel facts require a fresh investigation of the selected property. Unchanged priority comparisons reuse current facts. If required facts or availability are missing, other supported plans remain available.</p>
            <Button type="button" variant="outline" onClick={() => update("hotel", { ...d.hotel, hotelId: "" })}>Remove hotel selection</Button>
          </fieldset>
        )}
        {(!synthetic || d.hotelSandbox) && (
          <>
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {d.hotelSandbox ? "Edit fictional train or bus" : "Add a confirmed train or bus"}
              </summary>
              <div className="mt-3 space-y-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {d.hotelSandbox ? "These editable service times, stops, transfer allowances and fares are fictional test inputs. The US nationality is an explicit demo default. No real operator service or availability is claimed. Blank prices mean unknown." : "Use date-specific facts you checked with the operator. No timetable or seat inventory is fetched. Blank prices mean unknown; enter 0 only when free."}
                </p>
                {!d.hotelSandbox && <p className="flex flex-wrap gap-4 text-sm">
                  <a
                    className="text-primary underline"
                    href="https://www.amtrak.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Amtrak official site
                  </a>
                  <a
                    className="text-primary underline"
                    href="https://concordcoachlines.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Concord Coach official site
                  </a>
                </p>}
                <Check
                  id="transit-enabled"
                  checked={d.transit.enabled}
                  onChange={(v) =>
                    update("transit", {
                      ...d.transit,
                      enabled: v,
                      checkedAt:
                        d.transit.checkedAt || new Date().toISOString(),
                    })
                  }
                >
                  Include this transit option
                </Check>
                <Choice
                  id="transit-kind"
                  label="Transport"
                  value={d.transit.kind}
                  onChange={(v) =>
                    update("transit", {
                      ...d.transit,
                      kind: v as "bus" | "train",
                    })
                  }
                  options={[
                    ["bus", "Bus"],
                    ["train", "Train"],
                  ]}
                />
                {transitText("title", "Operator / service name")}
                {transitText(
                  "departure",
                  "Transit departure",
                  "datetime-local",
                )}
                {transitText("arrival", "Transit arrival", "datetime-local")}
                {transitText("departureTerminal", "Departure terminal")}
                {transitText("arrivalTerminal", "Arrival terminal")}
                {transitText("fare", d.hotelSandbox ? "Test fare (USD)" : "Fare (USD)", "number")}
                {transitText(
                  "boardingMinutes",
                  "Transit boarding minutes",
                  "number",
                )}
                <div className="grid grid-cols-2 gap-3">
                  {transitText("accessMinutes", "Access minutes", "number")}
                  {transitText("accessCost", "Access cost (USD)", "number")}
                  {transitText(
                    "finalMinutes",
                    "Final transfer minutes",
                    "number",
                  )}
                  {transitText(
                    "finalCost",
                    "Final transfer cost (USD)",
                    "number",
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Access starts at BOS terminal exit. Final transfer ends at
                  Portland, ME.
                </p>
                <Choice
                  id="transit-access-kind"
                  label="Access method"
                  value={d.transit.accessKind}
                  onChange={(v) =>
                    update("transit", {
                      ...d.transit,
                      accessKind: v as "transfer" | "walk",
                    })
                  }
                  options={[
                    ["transfer", "Vehicle transfer"],
                    ["walk", "Walk"],
                  ]}
                />
                <Choice
                  id="transit-final-kind"
                  label="Final transfer method"
                  value={d.transit.finalKind}
                  onChange={(v) =>
                    update("transit", {
                      ...d.transit,
                      finalKind: v as "transfer" | "walk",
                    })
                  }
                  options={[
                    ["transfer", "Vehicle transfer"],
                    ["walk", "Walk"],
                  ]}
                />
                {transitText(
                  "accessVehicle",
                  "Access vehicle identifier (optional)",
                )}
                {transitText(
                  "finalVehicle",
                  "Final vehicle identifier (optional)",
                )}
                <p className="text-xs text-muted-foreground">
                  Use the same identifier only when remaining on the same
                  vehicle. Blank vehicle transfers count as separate vehicles.
                </p>
                <Check
                  id="transit-estimated"
                  checked={d.transit.estimated}
                  onChange={(v) =>
                    update("transit", { ...d.transit, estimated: v })
                  }
                >
                  These times or prices are estimates
                </Check>
                <p className="break-words text-xs text-muted-foreground">
                  {d.hotelSandbox ? "Fictional test inputs" : d.transit.estimated ? "Estimated" : "Traveler confirmed"} ·
                  recorded {d.transit.checkedAt || "when enabled"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    update("transit", {
                      ...d.transit,
                      checkedAt: new Date().toISOString(),
                    })
                  }
                >
                  I rechecked the transit facts
                </Button>
              </div>
            </details>
            {!d.hotelSandbox && <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Add a rental car estimate
              </summary>
              <div className="mt-3 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Supply every duration and pickup/return location. Unknown
                  charges remain unknown; enter 0 for confirmed no charge.
                </p>
                <Check
                  id="car-enabled"
                  checked={d.car.enabled}
                  onChange={(v) =>
                    update("car", {
                      ...d.car,
                      enabled: v,
                      checkedAt: d.car.checkedAt || new Date().toISOString(),
                    })
                  }
                >
                  Include this car option
                </Check>
                {carText("title", "Rental operator")}
                {carText("pickup", "Rental pickup location")}
                {carText("dropoff", "Portland rental return location")}
                <div className="grid grid-cols-2 gap-3">
                  {carText("accessMinutes", "Rental shuttle minutes", "number")}
                  {carText("accessCost", "Rental shuttle cost (USD)", "number")}
                  {carText("pickupMinutes", "Rental pickup minutes", "number")}
                  {carText("driveMinutes", "Driving minutes", "number")}
                  {carText("returnMinutes", "Rental return minutes", "number")}
                  {carText("walkMinutes", "Final walk minutes", "number")}
                </div>
                {carText("rental", "Rental charge (USD)", "number")}
                {carText("fees", "Tax and one-way fees (USD)", "number")}
                {carText("fuel", "Fuel (USD)", "number")}
                {carText("tolls", "Tolls (USD)", "number")}
                {carText("other", "Other charges (USD)", "number")}
                <Check
                  id="pickup-confirmed"
                  checked={d.car.pickupConfirmed}
                  onChange={(v) =>
                    update("car", { ...d.car, pickupConfirmed: v })
                  }
                >
                  Pickup hours confirmed
                </Check>
                <Check
                  id="return-confirmed"
                  checked={d.car.returnConfirmed}
                  onChange={(v) =>
                    update("car", { ...d.car, returnConfirmed: v })
                  }
                >
                  One-way return location confirmed
                </Check>
                <p className="break-words text-xs text-muted-foreground">
                  Estimated · recorded {d.car.checkedAt || "when enabled"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    update("car", {
                      ...d.car,
                      checkedAt: new Date().toISOString(),
                    })
                  }
                >
                  I rechecked the car facts
                </Button>
              </div>
            </details>}
          </>
        )}
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-sm text-destructive">
            Check the marked trip fields. Your entries are retained.
          </p>
        )}
        {configured && (
          <div>
            <Check
              id="investigate-sources"
              checked={investigate}
              onChange={onInvestigate}
            >
              {d.hotelSandbox ? "Investigate sandbox hotel rates" : "Investigate available sources"}
            </Check>
            <p className="text-xs text-muted-foreground">
              {d.hotelSandbox ? "Checks only the hotel sandbox using test rates. No live availability, transport sources, AI assistance or bookings. Sandbox rates may be unavailable." : "Relevant current trip inputs are sent to enabled third-party sources only when you choose this investigation. Optional sources may be unavailable. Comparing supplied facts still works; source warnings report the outcome."}
            </p>
          </div>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Comparing…" : (!synthetic || d.hotelSandbox) && configured && hotelInvestigationNeeded ? "Investigate selected hotel journey" : "Compare recovery options"}
        </Button>
      </form>
      <div className="space-y-3 border-t p-5">
        <p className="text-sm font-medium">Try test hotel rates</p>
        <Button type="button" variant="outline" disabled={busy} onClick={onHotelSandbox}>Try hotel sandbox</Button>
        <p className="text-xs text-muted-foreground">Sandbox hotel rates with editable fictional onward inputs. No live availability or reservations. Requires an available sandbox source.</p>
      </div>
      <div className="space-y-3 border-t p-5">
        <p className="text-sm font-medium">Explore fictional examples</p>
        <div className="grid gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onExample("daytime")}
          >
            Daytime fictional example
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onExample("overnight")}
          >
            Overnight fictional example
          </Button>
          {synthetic && (
            <Button type="button" variant="secondary" onClick={onReal}>
              Use my own trip
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Examples use invented transport and prices. No inventory has been
          checked.
        </p>
      </div>
    </section>
  );
}
