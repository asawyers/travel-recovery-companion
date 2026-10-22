import { z } from 'zod'

export const ConversationEchoSchema = z.strictObject({
  turnId: z.string().min(1).max(100),
  baseRevision: z.number().int().nonnegative(),
})
export const ConversationContextSchema = z.strictObject({
  ...ConversationEchoSchema.shape,
  history: z.array(z.strictObject({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(1000),
  })).max(12),
}).superRefine((context, ctx) => {
  if (context.history.reduce((total, message) => total + message.content.length, 0) > 8000) {
    ctx.addIssue({ code: 'custom', path: ['history'], message: 'Conversation history must contain at most 8000 characters' })
  }
})
export const ClarificationSchema = z.strictObject({
  field: z.enum(['arrivalAt', 'deadlineAt', 'budget', 'stay', 'hotelJourney', 'connection', 'preference']),
  reason: z.enum(['required', 'ambiguous', 'conflicting', 'unsupported']),
})
export type ConversationContext = z.infer<typeof ConversationContextSchema>
export type ConversationEcho = z.infer<typeof ConversationEchoSchema>
export type Clarification = z.infer<typeof ClarificationSchema>

const questions: Record<Clarification['field'], string> = {
  arrivalAt: 'What is your updated gate arrival in Boston? Use Eastern time.',
  deadlineAt: 'What is your latest acceptable arrival time in Portland, or do you have no deadline?',
  budget: 'What budget should I use, and is it a hard limit or a preference?',
  stay: 'Which night would you stay, and what nationality should I use for the hotel search?',
  hotelJourney: 'What is the next missing detail for this hotel journey?',
  connection: 'What original departure and connection details should I use, or should I leave them unspecified?',
  preference: 'Should I change driving permission or prioritize earliest arrival, lowest price, or fewest transfers?',
}
export function clarificationQuestion(clarification: Clarification): string {
  return questions[clarification.field]
}
