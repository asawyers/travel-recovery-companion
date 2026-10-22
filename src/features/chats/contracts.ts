import { z } from 'zod';

export const MAX_CHAT_MESSAGES = 1000;
export const MAX_CHAT_MESSAGE_LENGTH = 1000;
// Leave room for PostgreSQL jsonb spacing below its 1,100,000-byte transcript cap.
export const MAX_CHAT_MESSAGES_BYTES = 1_000_000;
export const MAX_STORED_TRIP_BYTES = 16_000;
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const ChatIdSchema = z.uuid();
export const ChatRevisionSchema = z.number().int().min(0).max(2_147_483_647);
const timestamp = z.string().max(64).datetime({ offset: true });

/** Persist plain conversation text only, never provider responses or rendered cards. */
export const ChatMessageSchema = z.object({
  id: z.string().min(1).max(120),
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_CHAT_MESSAGE_LENGTH),
  revision: ChatRevisionSchema,
}).strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Enough user input to reopen a draft; current provider data must be fetched again. */
export const StoredTripSchema = z.object({
  originCityId: z.string().min(1).max(200).nullable(),
  destinationCityId: z.string().min(1).max(200).nullable(),
  goal: z.enum(['asap', 'deadline']),
  readyLocal: z.string().max(64),
  readyAt: z.string().max(64).nullable(),
  deadlineLocal: z.string().max(64),
  budget: z.string().max(32),
  budgetMode: z.enum(['soft', 'hard']),
  priority: z.enum(['earliest', 'cheapest', 'fewest_transfers']),
}).strict().refine(value => jsonBytes(value) <= MAX_STORED_TRIP_BYTES, 'The saved trip is too large. Reduce its size before saving.');
export type StoredTrip = z.infer<typeof StoredTripSchema>;

export const ChatInputSchema = z.object({
  title: z.string().min(1).max(120),
  messages: z.array(ChatMessageSchema).max(MAX_CHAT_MESSAGES, 'A chat can contain at most 1000 messages. Start a new chat to continue.').refine(value => jsonBytes(value) <= MAX_CHAT_MESSAGES_BYTES, 'This chat is too large to save. Start a new chat to continue.'),
  trip: StoredTripSchema.nullable(),
}).strict();
export type ChatInput = z.infer<typeof ChatInputSchema>;

export const ChatSummaryRowSchema = z.object({
  id: ChatIdSchema,
  user_id: ChatIdSchema,
  title: ChatInputSchema.shape.title,
  revision: ChatRevisionSchema,
  created_at: timestamp,
  updated_at: timestamp,
}).strict();
export const ChatRecordRowSchema = ChatSummaryRowSchema.extend({
  messages: ChatInputSchema.shape.messages,
  trip: ChatInputSchema.shape.trip,
}).strict();

export type ChatSummary = {
  id: string;
  userId: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type ChatRecord = ChatSummary & { messages: ChatMessage[]; trip: StoredTrip | null };
