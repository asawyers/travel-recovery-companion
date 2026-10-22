import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import {
  ChatIdSchema,
  ChatInputSchema,
  ChatRecordRowSchema,
  ChatRevisionSchema,
  ChatSummaryRowSchema,
} from './contracts';
import type { ChatInput, ChatRecord, ChatSummary } from './contracts';

export interface ChatRepository {
  list(userId: string): Promise<ChatSummary[]>;
  load(userId: string, id: string): Promise<ChatRecord>;
  create(userId: string, input: ChatInput & { id: string }): Promise<ChatRecord>;
  update(userId: string, id: string, expectedRevision: number, input: ChatInput): Promise<ChatRecord>;
  remove(userId: string, id: string): Promise<void>;
}

export class ChatNotFoundError extends Error {
  constructor() {
    super('This saved chat was not found in your account.');
    this.name = 'ChatNotFoundError';
  }
}

export class ChatConflictError extends Error {
  constructor() {
    super('This chat changed in another tab or was deleted. Reload it before saving again.');
    this.name = 'ChatConflictError';
  }
}

const TABLE = 'recovery_conversations';
const SUMMARY_COLUMNS = 'id,user_id,title,revision,created_at,updated_at';
const RECORD_COLUMNS = `${SUMMARY_COLUMNS},messages,trip`;
const CreateInputSchema = ChatInputSchema.extend({ id: ChatIdSchema }).strict();
const SummaryRowsSchema = z.array(ChatSummaryRowSchema).max(50);

type SummaryRow = z.infer<typeof ChatSummaryRowSchema>;
function summary(row: SummaryRow, userId: string): ChatSummary {
  if (row.user_id !== userId) throw new Error('The saved chat does not belong to the signed-in account.');
  return {
    id: row.id, userId: row.user_id, title: row.title, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function record(data: unknown, userId: string, id: string): ChatRecord {
  const row = ChatRecordRowSchema.parse(data);
  if (row.id !== id) throw new Error('The database returned a different saved chat.');
  return { ...summary(row, userId), messages: row.messages, trip: row.trip };
}
function databaseError(error: { message: string } | null): void {
  if (error) throw new Error(`Unable to access saved chats: ${error.message}`);
}

/** RLS enforces ownership; explicit owner filters also prevent accidental broad requests. */
export function createChatRepository(client: SupabaseClient): ChatRepository {
  return {
    async list(userId) {
      ChatIdSchema.parse(userId);
      const { data, error } = await client.from(TABLE).select(SUMMARY_COLUMNS)
        .eq('user_id', userId).order('updated_at', { ascending: false }).limit(50);
      databaseError(error);
      return SummaryRowsSchema.parse(data).map(row => summary(row, userId));
    },
    async load(userId, id) {
      ChatIdSchema.parse(userId); ChatIdSchema.parse(id);
      const { data, error } = await client.from(TABLE).select(RECORD_COLUMNS)
        .eq('user_id', userId).eq('id', id).maybeSingle();
      databaseError(error);
      if (!data) throw new ChatNotFoundError();
      return record(data, userId, id);
    },
    async create(userId, input) {
      ChatIdSchema.parse(userId);
      const parsed = CreateInputSchema.parse(input);
      const { data, error } = await client.from(TABLE).insert({
        id: parsed.id, user_id: userId, title: parsed.title,
        messages: parsed.messages, trip: parsed.trip, revision: 0,
      }).select(RECORD_COLUMNS).eq('user_id', userId).single();
      databaseError(error);
      return record(data, userId, parsed.id);
    },
    async update(userId, id, expectedRevision, input) {
      ChatIdSchema.parse(userId); ChatIdSchema.parse(id);
      ChatRevisionSchema.max(2_147_483_646).parse(expectedRevision);
      const parsed = ChatInputSchema.parse(input);
      const { data, error } = await client.from(TABLE).update({
        title: parsed.title, messages: parsed.messages, trip: parsed.trip,
        revision: expectedRevision + 1,
      }).eq('user_id', userId).eq('id', id).eq('revision', expectedRevision)
        .select(RECORD_COLUMNS).maybeSingle();
      databaseError(error);
      if (!data) throw new ChatConflictError();
      return record(data, userId, id);
    },
    async remove(userId, id) {
      ChatIdSchema.parse(userId); ChatIdSchema.parse(id);
      const { error } = await client.from(TABLE).delete().eq('user_id', userId).eq('id', id);
      databaseError(error);
    },
  };
}

export const chatRepository = createChatRepository(supabase);
export default chatRepository;
