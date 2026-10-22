type TimedLeg = { mode: string; startAt: string; endAt: string }

export function travelModeLabel(mode: string): string {
  return ({ bus: 'Bus', rail: 'Train', subway: 'Subway', tram: 'Tram', ferry: 'Ferry', drive: 'Drive' } as Record<string, string>)[mode] ?? mode
}

export function isTransferDetail(mode: string): boolean {
  return mode === 'walk' || mode === 'wait'
}

export function WalkingAccessSummary({ legs }: { legs: TimedLeg[] }) {
  const walkingMinutes = legs.filter(leg => leg.mode === 'walk').reduce((total, leg) => total + Math.max(0, (Date.parse(leg.endAt) - Date.parse(leg.startAt)) / 60000), 0)
  if (!Number.isFinite(walkingMinutes) || walkingMinutes <= 0) return null
  const duration = Number.isInteger(walkingMinutes) ? String(walkingMinutes) : `about ${Math.ceil(walkingMinutes)}`
  return <p className="text-sm text-muted-foreground">Includes {duration} min walking; consider luggage and station access.</p>
}
