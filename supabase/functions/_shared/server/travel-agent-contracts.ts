import type { ConversationContext } from '../domain/conversation.ts'
import type { PreferencePatch } from '../domain/assistance.ts'
import type { City, FlightOffer, NationalHotelOffer, TravelAssistance, TravelRecoveryInput, TravelRecoveryResponse, TravelSourceStatus } from '../domain/travel-contracts.ts'

export type TravelFlightDiscovery = { offers: FlightOffer[]; status: TravelSourceStatus; warnings: string[] }
export type TravelHotelDiscovery = { offers: NationalHotelOffer[]; status: TravelSourceStatus; warnings: string[] }
export type TravelAssessment = { assessmentId: string; result: TravelRecoveryResponse }
export type TravelAgentTools = {
  findFlights(): Promise<TravelFlightDiscovery>
  findHotels(): Promise<TravelHotelDiscovery>
  assess(patch: PreferencePatch): Promise<TravelAssessment>
}
export type TravelAgentExecutor = (args: {
  input: TravelRecoveryInput
  origin: City
  destination: City
  refinement: string
  conversation?: ConversationContext
  signal: AbortSignal
  tools: TravelAgentTools
}) => Promise<TravelAssistance>
