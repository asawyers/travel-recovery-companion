import type { ConversationContext } from '../domain/conversation.ts'
import type { Assistance, PreferencePatch } from '../domain/assistance.ts'
import type { ConfirmedOption, HotelOption, RecoveryResult, TripRequest } from '../domain/schemas.ts'

export type Assessment = { assessmentId: string; result: RecoveryResult }
export type AgentDiscovery = { candidates: ConfirmedOption[]; offers?: HotelOption[]; warnings: string[] }
export type AgentTools = {
  findTransport(): Promise<AgentDiscovery>
  findHotels(): Promise<AgentDiscovery>
  assess(patch: PreferencePatch): Promise<Assessment>
}
export type AgentExecutor = (args: {
  request: TripRequest
  refinement: string
  conversation?: ConversationContext
  tools: AgentTools
  signal: AbortSignal
}) => Promise<Assistance>
