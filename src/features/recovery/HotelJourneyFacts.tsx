import { useState } from "react";
import type { HotelOption } from "@domain/schemas";
import { localDateTimeToOffset } from "@domain/time";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { buildRequest, emptyDraft } from "./formModel";
import type { Draft } from "./formModel";

type Step = "property" | "hotelMinutes" | "checkinMinutes" | "leaveHotelAt" | "stationMinutes" | "service" | "ready";
const validMinutes = (value: string) => /^\d+$/.test(value) && Number(value) <= 10080;
const validPrice = (value: string) => value.trim() === "" || (/^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= 1000000);
const priceError = "Enter a nonnegative USD amount with at most two decimal places, up to $1,000,000. Leave it blank if unknown.";
function serviceError(draft: Draft): string | null {
  const t = draft.transit;
  if (!t.enabled || [t.title,t.departureTerminal,t.arrivalTerminal].some(value => !value.trim() || value.trim().length > 500)) return "Enter the service name and both actual boarding stops.";
  if (![t.boardingMinutes,t.accessMinutes,t.finalMinutes].every(validMinutes)) return "Enter whole-minute boarding, airport access and final transfer allowances from 0 to 10,080.";
  if (![t.fare,t.accessCost,t.finalCost].every(validPrice)) return priceError;
  try {
    const departure = localDateTimeToOffset(t.departure), arrival = localDateTimeToOffset(t.arrival);
    if (t.departure.slice(0,10) !== draft.checkout) return "Enter a transit departure on the checkout date. Timetables are never shifted.";
    if (Date.parse(arrival) <= Date.parse(departure)) return "Transit arrival must follow departure.";
  } catch { return "Enter valid, unambiguous America/New_York service times; daylight-saving gaps and repeated times need clarification."; }
  return null;
}
function validHotelDeparture(draft: Draft): boolean {
  try { localDateTimeToOffset(draft.hotel.leaveHotelAt); return !!draft.checkout && draft.hotel.leaveHotelAt.slice(0,10) === draft.checkout; }
  catch { return false; }
}
export function nextHotelFact(draft: Draft): Step {
  if (!draft.hotel.hotelId) return "property";
  if (!validMinutes(draft.hotel.hotelMinutes) || !validPrice(draft.hotel.hotelCost)) return "hotelMinutes";
  if (!validMinutes(draft.hotel.checkinMinutes)) return "checkinMinutes";
  if (!validHotelDeparture(draft)) return "leaveHotelAt";
  if (!validMinutes(draft.hotel.stationMinutes) || !validPrice(draft.hotel.stationCost)) return "stationMinutes";
  return serviceError(draft) ? "service" : "ready";
}
export function HotelJourneyFacts({ draft, offers, busy, onChange, onComplete }: {
  draft: Draft; offers: HotelOption[]; busy: boolean; onChange: (draft: Draft) => void; onComplete: () => void;
}) {
  const [step, setStep] = useState<Step>(() => nextHotelFact(draft));
  const [error, setError] = useState("");
  const labels = { hotelMinutes:"Airport to hotel minutes", checkinMinutes:"Hotel check-in minutes", leaveHotelAt:"Leave hotel at", stationMinutes:"Hotel to boarding stop minutes" };
  const property = offers.find(offer => offer.id === draft.hotel.hotelId);
  function hotelText(key: keyof Draft["hotel"], label: string, type = "number") {
    return <label key={key} className="block space-y-2 text-sm"><span>{label}</span><Input type={type} step={type === "datetime-local" ? "1" : "any"} value={draft.hotel[key]} onChange={event => onChange({ ...draft, hotel: { ...draft.hotel, [key]: event.target.value } })} /></label>;
  }
  function transitText(key: keyof Draft["transit"], label: string, type = "text") {
    return <label key={key} className="block space-y-2 text-sm"><span>{label}</span><Input type={type} step={type === "datetime-local" ? "1" : "any"} value={String(draft.transit[key])} onChange={event => onChange({ ...draft, transit: { ...draft.transit, enabled:true, [key]:event.target.value } })} /></label>;
  }
  function advance() {
    setError("");
    if (step === "property" && !draft.hotel.hotelId) { setError("Choose a checked hotel offer first."); return; }
    if (step === "hotelMinutes" || step === "checkinMinutes" || step === "stationMinutes") {
      if (!validMinutes(draft.hotel[step])) { setError("Enter whole minutes from 0 to 10,080."); return; }
    }
    if ((step === "hotelMinutes" && !validPrice(draft.hotel.hotelCost)) || (step === "stationMinutes" && !validPrice(draft.hotel.stationCost))) { setError(priceError); return; }
    if (step === "leaveHotelAt" && !validHotelDeparture(draft)) { setError("Enter a valid, unambiguous hotel departure on the checkout date."); return; }
    if (step === "service") { const error = serviceError(draft); if (error) { setError(error); return; } }
    const next = nextHotelFact(draft);
    if (next !== "ready") { setStep(next); return; }
    // The adapter may omit incomplete optional facts. A focused confirmation must
    // retain its editor instead of silently submitting that reduced request.
    const built = buildRequest(draft, draft.hotelSandbox ? "synthetic" : "real", [], new Date().toISOString());
    if (!built.request?.hotelSelection || !built.request.confirmedOptions.some(option => option.id === "manual-transit")) {
      setStep("service");
      setError(built.warnings.find(warning => /omitted/.test(warning)) ?? Object.values(built.errors)[0] ?? "Check the stay dates and the checkout-date service before continuing.");
      return;
    }
    onComplete();
  }
  return <div className="space-y-4" aria-label="Hotel journey fact">
    <p className="text-sm font-medium">{property?.name ?? (draft.hotel.hotelId ? `Selected property: ${draft.hotel.hotelId}` : "Choose the property for this journey")}</p>
    <label className="block text-sm">Change hotel detail<select className="recovery-select mt-2" value={step} onChange={event => { setStep(event.target.value as Step); setError(""); }}><option value="property">Property</option><option value="hotelMinutes">Airport to hotel transfer</option><option value="checkinMinutes">Check-in allowance</option><option value="leaveHotelAt">Hotel departure</option><option value="stationMinutes">Hotel to boarding stop transfer</option><option value="service">Checkout-date service</option><option value="ready">Review entered facts</option></select></label>
    {step === "property" && <label className="block text-sm">Checked hotel offer<select className="recovery-select mt-2" value={draft.hotel.hotelId} onChange={event => onChange({ ...draft, hotel:{ ...emptyDraft().hotel, hotelId:event.target.value } })}><option value="">Choose a property</option>{offers.map(offer => <option value={offer.id} key={offer.id}>{offer.name}</option>)}</select></label>}
    {(step === "hotelMinutes" || step === "checkinMinutes" || step === "leaveHotelAt" || step === "stationMinutes") && hotelText(step, labels[step], step === "leaveHotelAt" ? "datetime-local" : "number")}
    {step === "hotelMinutes" && hotelText("hotelCost", "Airport to hotel cost (USD)")}
    {step === "stationMinutes" && <>{hotelText("stationCost", "Hotel to boarding stop cost (USD)")}<p className="text-xs text-muted-foreground">To {draft.transit.departureTerminal || "the actual checkout-date boarding stop"}. A different property or boarding stop needs its own confirmation.</p></>}
    {(step === "hotelMinutes" || step === "stationMinutes") && <p className="text-xs text-muted-foreground">Confirm this exact property's transfer. Leave price blank if unknown; use 0 only for a confirmed free transfer.</p>}
    {step === "service" && <fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">Checkout-date onward service</legend><p className="text-xs text-muted-foreground">Enter a service you checked. No timetable is inferred or moved to another date.</p>{transitText("title","Operator / service name")}{transitText("departure","Transit departure","datetime-local")}{transitText("arrival","Transit arrival","datetime-local")}{transitText("departureTerminal","Departure terminal")}{transitText("arrivalTerminal","Arrival terminal")}{transitText("boardingMinutes","Transit boarding minutes","number")}{transitText("accessMinutes","Airport to boarding stop minutes","number")}{transitText("accessCost","Airport to boarding stop cost (USD)","number")}{transitText("finalMinutes","Final transfer minutes","number")}{transitText("fare","Fare (USD)","number")}{transitText("finalCost","Final transfer cost (USD)","number")}</fieldset>}
    {step === "ready" && <p className="text-sm">The property transfers and service are entered. Recheck the full journey before choosing it.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="button" onClick={advance} disabled={busy}>{step === "ready" ? "Check this hotel journey" : "Use this fact"}</Button>
  </div>;
}
