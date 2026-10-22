import { useState, type FormEvent } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { TravelJourneyFactsSchema, type FlightOffer, type NationalHotelOffer, type TravelJourneyFacts } from '@domain/travel-contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatTravelTime } from './FlightOffers'

export type JourneyFactsDraft = {
  originMinutes: string; originCost: string; destinationMinutes: string; destinationCost: string
  airportProcessingMinutes: string; arrivalProcessingMinutes: string; flightExtras: string
  connections: { afterSegmentId: string; allowanceMinutes: string; transferMinutes: string; transferCost: string }[]
  hotelArrivalLocal: string; hotelDepartureLocal: string; checkinMinutes: string
  hotelToAirportMinutes: string; hotelToAirportCost: string; hotelExtras: string
  arrangementsConfirmed: boolean; checkedAt: string | null
}
const costText = (cents: number | null | undefined) => cents == null ? '' : (cents / 100).toFixed(2)
function localText(at: string | undefined, zone: string | undefined): string {
  if (!at || !zone) return ''
  try { return Temporal.Instant.from(at).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: 'minute' }) }
  catch { return '' }
}
/** Restore explicit confirmed facts without refreshing their original confirmation timestamp. */
export function createJourneyFactsDraft(flight: FlightOffer, hotel: NationalHotelOffer | null, facts?: TravelJourneyFacts | null): JourneyFactsDraft {
  return {
    originMinutes: facts ? String(facts.originTransfer.minutes) : '', originCost: costText(facts?.originTransfer.costCents),
    destinationMinutes: facts ? String(facts.destinationTransfer.minutes) : '', destinationCost: costText(facts?.destinationTransfer.costCents),
    airportProcessingMinutes: facts ? String(facts.airportProcessingMinutes) : '',
    arrivalProcessingMinutes: facts ? String(facts.arrivalProcessingMinutes) : '', flightExtras: costText(facts?.flightExtrasCents),
    connections: flight.segments.slice(0, -1).map(segment => {
      const connection = facts?.connections.find(value => value.afterSegmentId === segment.id)
      return { afterSegmentId: segment.id, allowanceMinutes: connection ? String(connection.allowanceMinutes) : '',
        transferMinutes: connection?.airportTransfer ? String(connection.airportTransfer.minutes) : '', transferCost: costText(connection?.airportTransfer?.costCents) }
    }),
    hotelArrivalLocal: localText(facts?.stay?.hotelArrivalAt, hotel?.timeZone), hotelDepartureLocal: localText(facts?.stay?.hotelDepartureAt, hotel?.timeZone),
    checkinMinutes: facts?.stay ? String(facts.stay.checkinMinutes) : '', hotelToAirportMinutes: facts?.stay ? String(facts.stay.hotelToAirport.minutes) : '',
    hotelToAirportCost: costText(facts?.stay?.hotelToAirport.costCents), hotelExtras: costText(facts?.stay?.extraFeesCents),
    arrangementsConfirmed: facts?.stay?.arrangementsConfirmed ?? false, checkedAt: facts?.checkedAt ?? null,
  }
}
function minutes(value: string, label: string, zero = false): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < (zero ? 0 : 1) || Number(value) > 10_080)
    throw new Error(`${label}: enter whole minutes from ${zero ? 0 : 1} to 10,080.`)
  return Number(value)
}
function amount(value: string): number | null {
  if (value.trim() === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 1_000_000)
    throw new Error('Enter a nonnegative USD amount with at most two decimal places, up to $1,000,000. Leave it blank if unknown.')
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}
function hotelTime(value: string, date: string, zone: string): string {
  if (value.slice(0, 10) !== date) throw new Error(`Use the exact hotel local date ${date}.`)
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/.test(value)) throw new Error()
    return Temporal.PlainDateTime.from(value, { overflow: 'reject' }).toZonedDateTime(zone, { disambiguation: 'reject' }).toString({ timeZoneName: 'never' })
  } catch { throw new Error(`Enter a valid, unambiguous local time in ${zone}. Daylight-saving gaps and repeated times need clarification.`) }
}
/** Build only at explicit confirmation. Blank costs remain unknown; allowances are never inferred. */
export function buildJourneyFacts(draft: JourneyFactsDraft, flight: FlightOffer, hotel: NationalHotelOffer | null, checkedAt: string): TravelJourneyFacts {
  const originTransfer = { minutes: minutes(draft.originMinutes, 'Origin transfer'), costCents: amount(draft.originCost) }
  const destinationTransfer = { minutes: minutes(draft.destinationMinutes, 'Destination transfer'), costCents: amount(draft.destinationCost) }
  if (draft.connections.length !== flight.segments.length - 1 || new Set(draft.connections.map(c => c.afterSegmentId)).size !== draft.connections.length)
    throw new Error('Confirm exactly one allowance for every connection.')
  const connections = flight.segments.slice(0, -1).map((segment, index) => {
    const connection = draft.connections.find(c => c.afterSegmentId === segment.id)
    if (!connection) throw new Error('Confirm every connection allowance.')
    const change = segment.destinationAirport.iata !== flight.segments[index + 1].originAirport.iata
    if (!change && (connection.transferMinutes !== '' || connection.transferCost !== '')) throw new Error('A same-airport connection cannot include an airport transfer.')
    return { afterSegmentId: segment.id, allowanceMinutes: minutes(connection.allowanceMinutes, 'Connection allowance'), airportTransfer: change ? {
      minutes: minutes(connection.transferMinutes, 'Connection airport transfer'), costCents: amount(connection.transferCost),
    } : null }
  })
  let stay: TravelJourneyFacts['stay'] = null
  if (hotel) {
    if (!draft.arrangementsConfirmed) throw new Error('Confirm the hotel arrangements, estimated time zone, check-in and checkout policies with the property.')
    const hotelArrivalAt = hotelTime(draft.hotelArrivalLocal, hotel.checkin, hotel.timeZone)
    const hotelDepartureAt = hotelTime(draft.hotelDepartureLocal, hotel.checkout, hotel.timeZone)
    const checkinMinutes = minutes(draft.checkinMinutes, 'Hotel check-in allowance')
    if (Temporal.Instant.compare(Temporal.Instant.from(hotelArrivalAt).add({ minutes: checkinMinutes }), Temporal.Instant.from(hotelDepartureAt)) >= 0)
      throw new Error('Hotel departure must follow arrival and the check-in allowance.')
    stay = { hotelArrivalAt, hotelDepartureAt, checkinMinutes, hotelToAirport: { minutes: minutes(draft.hotelToAirportMinutes, 'Hotel to airport transfer'), costCents: amount(draft.hotelToAirportCost) }, extraFeesCents: amount(draft.hotelExtras), arrangementsConfirmed: true }
  }
  return TravelJourneyFactsSchema.parse({ originTransfer, destinationTransfer,
    airportProcessingMinutes: minutes(draft.airportProcessingMinutes, 'Airport processing allowance'),
    arrivalProcessingMinutes: minutes(draft.arrivalProcessingMinutes, 'Arrival processing allowance', true), connections,
    flightExtrasCents: amount(draft.flightExtras), stay, checkedAt })
}
type Props = { flight: FlightOffer; hotel?: NationalHotelOffer | null; initialFacts?: TravelJourneyFacts | null; busy?: boolean;
  onConfirm: (facts: TravelJourneyFacts) => void; onCancel?: () => void }
type Step = 'origin' | 'hotelArrival' | 'hotelDeparture' | 'checkin' | 'hotelAirport' | 'arrangements' | 'airport' | `connection:${number}` | 'arrival' | 'destination' | 'review'
export function JourneyFactsForm(props: Props) {
  return <FactsEditor key={`${props.flight.fingerprint}:${props.hotel?.fingerprint ?? 'no-stay'}`} {...props} />
}
function FactsEditor({ flight, hotel = null, initialFacts, busy = false, onConfirm, onCancel }: Props) {
  const [draft, setDraft] = useState(() => createJourneyFactsDraft(flight, hotel, initialFacts))
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState('')
  const steps: Step[] = ['origin', ...(hotel ? ['hotelArrival', 'hotelDeparture', 'checkin', 'hotelAirport', 'arrangements'] as const : []),
    'airport', ...flight.segments.slice(0, -1).map((_, i) => `connection:${i}` as const), 'arrival', 'destination', 'review']
  const step = steps[stepIndex]
  const update = <K extends keyof JourneyFactsDraft>(key: K, value: JourneyFactsDraft[K]) => setDraft(current => ({ ...current, [key]: value }))
  function field(key: keyof Omit<JourneyFactsDraft, 'connections' | 'arrangementsConfirmed' | 'checkedAt'>, label: string, type = 'number') {
    return <label className="block space-y-2 text-sm"><span>{label}</span><Input type={type} value={draft[key]} min={type === 'number' ? 0 : undefined} max={type === 'number' ? 10_080 : undefined} step={type === 'datetime-local' ? 1 : 'any'} onChange={event => update(key, event.target.value)} disabled={busy} /></label>
  }
  function optionalCost(key: 'originCost' | 'destinationCost' | 'hotelToAirportCost', label: string) {
    return <details className="space-y-2 text-sm"><summary className="cursor-pointer">Optional transfer cost</summary>{field(key, `${label} (USD)`, 'text')}<p className="text-xs text-muted-foreground">Leave blank if unknown. Enter 0 only when confirmed free.</p></details>
  }
  function connectionFields(index: number) {
    const before = flight.segments[index], after = flight.segments[index + 1], connection = draft.connections[index]
    const change = before.destinationAirport.iata !== after.originAirport.iata
    const connectionField = (key: 'allowanceMinutes' | 'transferMinutes' | 'transferCost', label: string) => <label className="block space-y-2 text-sm"><span>{label}</span><Input type={key === 'transferCost' ? 'text' : 'number'} min={1} value={connection[key]} onChange={event => update('connections', draft.connections.map((c, i) => i === index ? { ...c, [key]: event.target.value } : c))} disabled={busy} /></label>
    return <>
      <p className="text-sm">Connection {index + 1}: {before.destinationAirport.iata} to {after.originAirport.iata}</p>
      <p className="text-xs text-muted-foreground">Arrive {formatTravelTime(before.arrivalAt, before.destinationAirport.timeZone)}. Next departure {formatTravelTime(after.departureAt, after.originAirport.timeZone)}.</p>
      {connectionField('allowanceMinutes', 'Connection processing allowance minutes')}
      {change && <><p className="text-sm">This connection changes airports. Confirm the separate transfer.</p>{connectionField('transferMinutes', 'Connection airport transfer minutes')}<details><summary className="text-sm cursor-pointer">Optional airport transfer cost</summary>{connectionField('transferCost', 'Airport transfer cost (USD)')}<p className="text-xs">Blank means unknown.</p></details></>}
    </>
  }
  function validateStep() {
    switch (step) {
      case 'origin': minutes(draft.originMinutes, 'Origin transfer'); amount(draft.originCost); break
      case 'hotelArrival': hotelTime(draft.hotelArrivalLocal, hotel!.checkin, hotel!.timeZone); break
      case 'hotelDeparture': hotelTime(draft.hotelDepartureLocal, hotel!.checkout, hotel!.timeZone); break
      case 'checkin': minutes(draft.checkinMinutes, 'Check-in allowance'); break
      case 'hotelAirport': minutes(draft.hotelToAirportMinutes, 'Hotel to airport transfer'); amount(draft.hotelToAirportCost); break
      case 'arrangements': if (!draft.arrangementsConfirmed) throw new Error('Confirm the hotel arrangements with the property before continuing.'); break
      case 'airport': minutes(draft.airportProcessingMinutes, 'Airport processing allowance'); break
      case 'arrival': minutes(draft.arrivalProcessingMinutes, 'Arrival processing allowance', true); break
      case 'destination': minutes(draft.destinationMinutes, 'Destination transfer'); amount(draft.destinationCost); break
      default:
        if (step.startsWith('connection:')) {
          const index = Number(step.split(':')[1]), connection = draft.connections[index]
          minutes(connection.allowanceMinutes, 'Connection allowance')
          if (flight.segments[index].destinationAirport.iata !== flight.segments[index + 1].originAirport.iata) {
            minutes(connection.transferMinutes, 'Connection airport transfer'); amount(connection.transferCost)
          }
        }
    }
  }
  function advance(event: FormEvent) {
    event.preventDefault(); setError('')
    try {
      validateStep()
      if (step === 'review') onConfirm(buildJourneyFacts(draft, flight, hotel, new Date().toISOString()))
      else setStepIndex(index => index + 1)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check this fact before continuing.') }
  }
  return <form onSubmit={advance} aria-label="Complete journey facts" className="rounded-lg border bg-white p-5 space-y-4">
    <div><h2 className="text-lg font-semibold">Let’s check the rest of your journey</h2><p className="text-sm text-muted-foreground">Step {stepIndex + 1} of {steps.length}. These are your planning allowances; confirm them for this trip.</p></div>
    {step === 'origin' && <>{field('originMinutes', 'Origin transfer minutes')}<p className="text-xs text-muted-foreground">From your selected origin city to {hotel ? hotel.name : `${flight.originAirportIata} airport`}. Confirm the actual transfer.</p>{optionalCost('originCost', 'Origin transfer cost')}</>}
    {step === 'hotelArrival' && <><p className="text-sm">{hotel!.name} · {hotel!.checkin} to {hotel!.checkout}</p>{field('hotelArrivalLocal', `Hotel arrival local date and time (${hotel!.timeZone}, estimated)`, 'datetime-local')}<p className="text-xs text-muted-foreground">Enter the arrival you arranged on {hotel!.checkin}. No check-in time is assumed.</p></>}
    {step === 'hotelDeparture' && <>{field('hotelDepartureLocal', `Hotel departure local date and time (${hotel!.timeZone}, estimated)`, 'datetime-local')}<p className="text-xs text-muted-foreground">Enter your arranged departure on {hotel!.checkout}.</p></>}
    {step === 'checkin' && <>{field('checkinMinutes', 'Hotel check-in allowance minutes')}<p className="text-xs text-muted-foreground">Your time allowance to complete check-in after arrival; confirm property access separately.</p></>}
    {step === 'hotelAirport' && <>{field('hotelToAirportMinutes', 'Hotel to airport transfer minutes')}<p className="text-xs text-muted-foreground">From {hotel!.name} to {flight.originAirportIata} on {hotel!.checkout}.</p>{optionalCost('hotelToAirportCost', 'Hotel to airport transfer cost')}</>}
    {step === 'arrangements' && <div className="space-y-3 text-sm"><p>Property time zone estimated from the origin city: {hotel!.timeZone}. Check it with the property.</p><p>{hotel!.checkinPolicy ?? 'Check-in policy unknown; check with the property.'}</p><p>{hotel!.checkoutPolicy ?? 'Checkout policy unknown; check with the property.'}</p><p>{hotel!.cancellation ?? 'Cancellation policy unknown; check with the property.'}</p><label className="flex items-start gap-2"><input type="checkbox" checked={draft.arrangementsConfirmed} onChange={event => update('arrangementsConfirmed', event.target.checked)} disabled={busy} /><span>I checked the estimated time zone, check-in and checkout policies, and confirmed these arrival and departure arrangements with the property.</span></label></div>}
    {step === 'airport' && <>{field('airportProcessingMinutes', 'Airport processing allowance minutes')}<p className="text-xs text-muted-foreground">Allow for check-in, baggage and security before {flight.originAirportIata} departure. Adjust for this airport and trip.</p><Button type="button" variant="outline" disabled={busy} onClick={() => update('airportProcessingMinutes', '120')}>Use 120-minute planning allowance</Button></>}
    {step.startsWith('connection:') && connectionFields(Number(step.split(':')[1]))}
    {step === 'arrival' && <>{field('arrivalProcessingMinutes', 'Arrival processing allowance minutes')}<p className="text-xs text-muted-foreground">Time after landing for baggage and airport exit, before the final transfer.</p><Button type="button" variant="outline" disabled={busy} onClick={() => update('arrivalProcessingMinutes', '30')}>Use 30-minute planning allowance</Button></>}
    {step === 'destination' && <>{field('destinationMinutes', 'Destination transfer minutes')}<p className="text-xs text-muted-foreground">From {flight.destinationAirportIata} to your selected destination city. Confirm the actual transfer.</p>{optionalCost('destinationCost', 'Destination transfer cost')}</>}
    {step === 'review' && <div className="space-y-3 text-sm">
      <p>Origin transfer {draft.originMinutes} min · airport processing {draft.airportProcessingMinutes} min · arrival processing {draft.arrivalProcessingMinutes} min · destination transfer {draft.destinationMinutes} min.</p>
      {draft.connections.map((connection, index) => <p key={connection.afterSegmentId}>Connection {index + 1}: {connection.allowanceMinutes} min processing{connection.transferMinutes ? ` + ${connection.transferMinutes} min airport transfer` : ''}.</p>)}
      {hotel && <p>{hotel.name}: arrive {draft.hotelArrivalLocal}, leave {draft.hotelDepartureLocal} ({hotel.timeZone}, estimated); {draft.checkinMinutes} min check-in, {draft.hotelToAirportMinutes} min to airport. Property arrangements confirmed.</p>}
      <details><summary className="cursor-pointer">Optional additional costs</summary><div className="mt-3 space-y-3">{field('flightExtras', 'Additional flight fees and baggage (USD)', 'text')}{hotel && field('hotelExtras', 'Additional hotel fees (USD)', 'text')}<p className="text-xs text-muted-foreground">Blank means unknown. Enter 0 only for checked, confirmed zero additional charges.</p></div></details>
      {draft.checkedAt && <p className="text-xs text-muted-foreground">Previously confirmed {draft.checkedAt}. Confirming again records a new check time.</p>}
      <p>Confirm these facts to check the complete journey. Availability and final prices still need provider confirmation.</p>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">{stepIndex > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => { setStepIndex(index => index - 1); setError('') }}>Back</Button>}<Button type="submit" disabled={busy}>{step === 'review' ? 'Confirm facts and check journey' : 'Confirm and continue'}</Button>{onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}</div>
  </form>
}
