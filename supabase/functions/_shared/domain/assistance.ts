import { z } from 'zod'
import { toInstantMillis } from './time.ts'

export const PreferencePatchSchema = z.strictObject({
  drivingAllowed: z.boolean().optional(),
  priority: z.enum(['earliest', 'cheapest', 'fewest_transfers']).optional(),
})
export type PreferencePatch = z.infer<typeof PreferencePatchSchema>
export const AgentActivitySchema = z.strictObject({
  tool: z.enum(['find_transport_options', 'find_hotel_options', 'assess_recovery_options', 'model']),
  status: z.enum(['started', 'completed', 'unavailable', 'limited']),
  message: z.string().trim().min(1).max(500),
  checkedAt: z.string().max(40).refine(value => { try { toInstantMillis(value); return true } catch { return false } }, 'Expected timestamp with explicit offset'),
})
export type AgentActivity = z.infer<typeof AgentActivitySchema>
export const AssistanceSchema = z.strictObject({
  status: z.enum(['completed', 'unavailable', 'limited']),
  summary: z.string().trim().min(1).max(1500),
  appliedPreferences: PreferencePatchSchema,
  selectedPlanId: z.string().trim().min(1).max(100).nullable(),
  activity: z.array(AgentActivitySchema).max(32),
})
export type Assistance = z.infer<typeof AssistanceSchema>
