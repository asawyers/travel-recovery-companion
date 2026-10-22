import { Temporal } from '@js-temporal/polyfill'
import { FlightOfferSchema, NationalHotelOfferSchema, TRAVEL_MAX_FACT_AGE_MS, type FlightOffer } from '@domain/travel-contracts'
import type { CostLine, SourceEvidence } from '@domain/schemas'
import { Button } from '@/components/ui/button'
import { PriceHighlight } from '@/components/ui/companion'
import { sumCosts } from '@domain/time'

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
  return <ul className="space-y-1 text-xs text-muted-foreground">{evidence.map((source, index) => <li key={index} className="break-words [overflow-wrap:anywhere]">{source.provider} · {source.type} · checked {source.checkedAt} · expires {source.expiresAt ?? 'not supplied; refresh within five minutes'}{source.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</li>)}</ul>
}
export function CustomerHandoff({ href, kind, fresh, onExpired }: { href: string | null; kind: 'flights' | 'hotels'; fresh: () => boolean; onExpired?: () => void }) {
  const allowed = href !== null && (kind === 'flights' ? FlightOfferSchema.shape.handoffUrl : NationalHotelOfferSchema.shape.handoffUrl).safeParse(href).success
  return <div className="space-y-2 text-xs text-muted-foreground">{allowed && <a className="underline text-foreground" href={href!} target="_blank" rel="noopener noreferrer" onClick={event => { if (!fresh()) { event.preventDefault(); onExpired?.() } }}>Check current {kind === 'flights' ? 'flight' : 'hotel'} options on Google Travel</a>}<p>Opening a link does not reserve or purchase anything. Recheck the exact itinerary, availability and final price with the provider.</p></div>
}
/** Preserve unknown quotes and omit charges already included in the quoted amount. */
export function quotedTravelAmount(costs: CostLine[]): number | null {
  return costs.some(line => !line.includedInOtherCharge && line.cents !== null && line.currency === 'USD')
    ? sumCosts(costs).knownCostCents : null
}
export function compactTravelTime(at: string, zone: string): string {
  try { return Temporal.Instant.from(at).toZonedDateTimeISO(zone).toPlainTime().toString({ smallestUnit: 'minute' }) }
  catch { return at }
}
function compactTravelDate(at: string, zone: string): string {
  try { return Temporal.Instant.from(at).toZonedDateTimeISO(zone).toPlainDate().toString() }
  catch { return at }
}
export function FlightOffers({ offers, busy = false, expiresAt, onPlan, onExpired }: {
  offers: FlightOffer[]; busy?: boolean; expiresAt?: string | null; onPlan: (offer: FlightOffer) => void; onExpired?: () => void
}) {
  if (!offers.length) return null
  return <section aria-label="Flight quotes" className="min-w-0 space-y-4">
    <div className="space-y-1"><h2 className="companion-heading text-xl font-semibold">Start with a flight</h2>
    <p className="text-sm text-muted-foreground">Observed flight quotes. We will check your transfers and timing before building a complete journey.</p></div>
    <ul className="space-y-4">{offers.map((offer, offerIndex) => {
      const evidence = [...offer.evidence, ...offer.segments.flatMap(segment => segment.evidence)]
      const fresh = () => travelEvidenceFresh(evidence, expiresAt)
      const first = offer.segments[0], last = offer.segments.at(-1)!
      return <li key={offer.id} className="min-w-0 space-y-4 rounded-2xl border border-[var(--companion-border)] bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">Flight option {offerIndex + 1}</p><h3 className="companion-heading text-lg font-semibold">{offer.originAirportIata} to {offer.destinationAirportIata}</h3><p className="text-xs text-muted-foreground">{offer.departureDate} · 1 adult</p></div>
          <PriceHighlight amountCents={quotedTravelAmount(offer.costs)} label="Observed flight fare" qualifier="Journey total still needs transfers and additional fees" className="max-w-60" />
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-[var(--companion-paper)] p-3">
          <div><p className="companion-heading text-xl font-semibold">{compactTravelTime(first.departureAt, first.originAirport.timeZone)}</p><p className="text-sm font-medium">{first.originAirport.iata}</p><p className="text-xs text-muted-foreground"><time dateTime={first.departureAt}>{compactTravelDate(first.departureAt, first.originAirport.timeZone)}</time></p><p className="text-xs text-muted-foreground">Departure local time</p></div>
          <div className="text-center text-xs text-muted-foreground"><p aria-hidden="true" className="mb-1 text-lg">→</p><p>{offer.segments.length === 1 ? 'Nonstop' : `${offer.segments.length - 1} connection${offer.segments.length > 2 ? 's' : ''}`}</p></div>
          <div className="text-right"><p className="companion-heading text-xl font-semibold text-[var(--companion-arrival)]">{compactTravelTime(last.arrivalAt, last.destinationAirport.timeZone)}</p><p className="text-sm font-medium">{last.destinationAirport.iata}</p><p className="text-xs text-muted-foreground"><time dateTime={last.arrivalAt}>{compactTravelDate(last.arrivalAt, last.destinationAirport.timeZone)}</time></p><p className="text-xs text-muted-foreground">Arrival local time</p></div>
        </div>
        <p className="text-xs text-muted-foreground">Unknown baggage and additional fees need confirmation. An observed fare is not a complete journey total.</p>
        <details className="rounded-xl border border-[var(--companion-border)] text-sm"><summary className="cursor-pointer px-3 py-3 font-medium">Flight details</summary><div className="space-y-4 px-3 pb-3">
          <ol className="space-y-4">{offer.segments.map((segment, index) => <li key={segment.id} className="space-y-1 [overflow-wrap:anywhere]">
            {index > 0 && <p className="mb-2 rounded-lg bg-[var(--companion-paper)] p-2 text-xs text-muted-foreground">Connection: {offer.segments[index - 1].destinationAirport.iata} to {segment.originAirport.iata} · {(Date.parse(segment.departureAt) - Date.parse(offer.segments[index - 1].arrivalAt)) / 60000} minutes between flights{offer.segments[index - 1].destinationAirport.iata !== segment.originAirport.iata ? ' · airport change requires a separate transfer' : ' · confirm the connection allowance'}</p>}
            <p className="font-medium">{segment.carrier} {segment.flightNumber}</p>
            <p>{segment.originAirport.name} ({segment.originAirport.iata}) · {formatTravelTime(segment.departureAt, segment.originAirport.timeZone)}</p>
            <p>{segment.destinationAirport.name} ({segment.destinationAirport.iata}) · {formatTravelTime(segment.arrivalAt, segment.destinationAirport.timeZone)}</p>
            <p className="text-xs text-muted-foreground">{segment.durationMinutes} minutes in flight</p>
          </li>)}</ol>
          <TravelCosts costs={offer.costs} />
        </div></details>
        <Button className="w-full whitespace-normal" disabled={busy} onClick={() => { if (fresh()) onPlan(offer); else onExpired?.() }}>Plan this flight</Button>
        <details className="text-sm"><summary className="cursor-pointer py-1 text-muted-foreground">Source and freshness</summary><div className="mt-2"><TravelEvidence evidence={evidence} /></div></details>
        <CustomerHandoff href={offer.handoffUrl} kind="flights" fresh={fresh} onExpired={onExpired} />
      </li>
    })}</ul>
  </section>
}
