import { Temporal } from '@js-temporal/polyfill'
import { FlightOfferSchema, NationalHotelOfferSchema, TRAVEL_MAX_FACT_AGE_MS, type FlightOffer } from '@domain/travel-contracts'
import type { CostLine, SourceEvidence } from '@domain/schemas'
import { Button } from '@/components/ui/button'

export const travelMoney = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
export function formatTravelTime(at: string, zone: string): string {
  try {
    const local = Temporal.Instant.from(at).toZonedDateTimeISO(zone)
    return `${local.toPlainDate()} ${local.toPlainTime().toString({ smallestUnit: 'minute' })} ${local.offset} · ${zone}`
  } catch { return `${at} · ${zone}` }
}
export function travelEvidenceFresh(evidence: SourceEvidence[], expiresAt?: string | null, now = Date.now()): boolean {
  return evidence.length > 0 && evidence.every(source => {
    const checked = Date.parse(source.checkedAt)
    const expires = source.expiresAt === null ? Infinity : Date.parse(source.expiresAt)
    return Number.isFinite(checked) && checked <= now && Math.min(checked + TRAVEL_MAX_FACT_AGE_MS, expires) > now
  }) && (expiresAt === undefined || (expiresAt !== null && Date.parse(expiresAt) > now))
}
export function TravelCosts({ costs }: { costs: CostLine[] }) {
  return <ul className="space-y-1 text-sm">{costs.map((line, index) => <li key={index}>{line.label}: {line.cents === null ? 'Unknown' : line.currency === 'USD' ? `${travelMoney(line.cents)} USD` : `${(line.cents / 100).toFixed(2)} ${line.currency}`}{line.includedInOtherCharge ? ' (included in another charge)' : ''}</li>)}</ul>
}
export function TravelEvidence({ evidence }: { evidence: SourceEvidence[] }) {
  return <ul className="space-y-1 text-xs text-muted-foreground">{evidence.map((source, index) => <li key={index} className="break-words">{source.provider} · {source.type} · checked {source.checkedAt} · expires {source.expiresAt ?? 'not supplied; refresh within five minutes'}{source.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</li>)}</ul>
}
export function CustomerHandoff({ href, kind, fresh, onExpired }: { href: string | null; kind: 'flights' | 'hotels'; fresh: () => boolean; onExpired?: () => void }) {
  const allowed = href !== null && (kind === 'flights' ? FlightOfferSchema.shape.handoffUrl : NationalHotelOfferSchema.shape.handoffUrl).safeParse(href).success
  return <div className="space-y-2 text-xs text-muted-foreground">{allowed && <a className="underline text-foreground" href={href!} target="_blank" rel="noopener noreferrer" onClick={event => { if (!fresh()) { event.preventDefault(); onExpired?.() } }}>Check current {kind === 'flights' ? 'flight' : 'hotel'} options on Google Travel</a>}<p>Opening a link does not reserve or purchase anything. Recheck the exact itinerary, availability and final price with the provider.</p></div>
}
export function FlightOffers({ offers, busy = false, expiresAt, onPlan, onExpired }: {
  offers: FlightOffer[]; busy?: boolean; expiresAt?: string | null; onPlan: (offer: FlightOffer) => void; onExpired?: () => void
}) {
  if (!offers.length) return null
  return <section aria-label="Flight quotes" className="rounded-lg border bg-white p-5 space-y-3">
    <h2 className="text-lg font-semibold">Start with a flight</h2>
    <p className="text-sm text-muted-foreground">Observed flight quotes. We will check your transfers and timing before building a complete journey.</p>
    <ul className="divide-y">{offers.map(offer => {
      const evidence = [...offer.evidence, ...offer.segments.flatMap(segment => segment.evidence)]
      const fresh = () => travelEvidenceFresh(evidence, expiresAt)
      return <li key={offer.id} className="space-y-3 py-4">
        <h3 className="font-medium">{offer.originAirportIata} to {offer.destinationAirportIata} · {offer.departureDate}</h3>
        <ol className="space-y-3 text-sm">{offer.segments.map((segment, index) => <li key={segment.id}>
          {index > 0 && <p className="mb-2 text-muted-foreground">Connection: {offer.segments[index - 1].destinationAirport.iata} to {segment.originAirport.iata} · {(Date.parse(segment.departureAt) - Date.parse(offer.segments[index - 1].arrivalAt)) / 60000} minutes between flights{offer.segments[index - 1].destinationAirport.iata !== segment.originAirport.iata ? ' · airport change requires a separate transfer' : ' · confirm the connection allowance'}</p>}
          <p className="font-medium">{segment.carrier} {segment.flightNumber}</p>
          <p>{segment.originAirport.name} ({segment.originAirport.iata}) · {formatTravelTime(segment.departureAt, segment.originAirport.timeZone)}</p>
          <p>{segment.destinationAirport.name} ({segment.destinationAirport.iata}) · {formatTravelTime(segment.arrivalAt, segment.destinationAirport.timeZone)}</p>
          <p className="text-xs text-muted-foreground">{segment.durationMinutes} minutes in flight</p>
        </li>)}</ol>
        <TravelCosts costs={offer.costs} />
        <p className="text-xs text-muted-foreground">Unknown baggage and additional fees need confirmation. An observed fare is not a complete journey total.</p>
        <details className="text-sm"><summary className="cursor-pointer">Source and freshness</summary><div className="mt-2"><TravelEvidence evidence={evidence} /></div></details>
        <Button disabled={busy} onClick={() => { if (fresh()) onPlan(offer); else onExpired?.() }}>Plan this flight</Button>
        <CustomerHandoff href={offer.handoffUrl} kind="flights" fresh={fresh} onExpired={onExpired} />
      </li>
    })}</ul>
  </section>
}
