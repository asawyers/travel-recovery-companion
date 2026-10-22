import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { ChatConflictError, ChatNotFoundError, createChatRepository } from '../../src/features/chats/repository';
import { MAX_CHAT_MESSAGES } from '../../src/features/chats/contracts';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const message = { id: 'turn-1', role: 'user' as const, content: 'Get me home', revision: 0 };
const trip = { originCityId: 'new-york', destinationCityId: 'boston', goal: 'asap' as const, readyLocal: '', readyAt: null, deadlineLocal: '', budget: '100', budgetMode: 'soft' as const, priority: 'earliest' as const };
const input = { title: 'New York to Boston', messages: [message], trip };
const row = { id, user_id: userId, ...input, revision: 0, created_at: '2026-10-22T12:00:00+00:00', updated_at: '2026-10-22T12:00:00+00:00' };
function sdk(data: unknown, error: unknown = null) {
  const response = { data, error };
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'delete', 'single', 'maybeSingle']) query[method] = vi.fn(() => query);
  query.then = vi.fn((resolve) => Promise.resolve(response).then(resolve));
  const from = vi.fn(() => query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}
function summary() { const { messages: _messages, trip: _trip, ...result } = row; return result; }

describe('account chat repository', () => {
  it('lists the recent 50 summaries scoped to their owner without downloading transcripts', async () => {
    const mock = sdk([summary()]);
    const result = await createChatRepository(mock.client).list(userId);
    expect(result).toEqual([{ id, userId, title: input.title, revision: 0, createdAt: row.created_at, updatedAt: row.updated_at }]);
    expect(mock.from).toHaveBeenCalledWith('recovery_conversations');
    expect(mock.query.select).toHaveBeenCalledWith('id,user_id,title,revision,created_at,updated_at');
    expect(mock.query.eq).toHaveBeenCalledWith('user_id', userId);
    expect(mock.query.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(mock.query.limit).toHaveBeenCalledWith(50);
  });
  it('loads an owner-scoped full transcript and trip', async () => {
    const mock = sdk(row);
    const chat = await createChatRepository(mock.client).load(userId, id);
    expect(chat.messages).toEqual([message]); expect(chat.trip).toEqual(trip);
    expect(chat.userId).toBe(userId);
    expect(mock.query.eq).toHaveBeenCalledWith('user_id', userId);
    expect(mock.query.eq).toHaveBeenCalledWith('id', id);
  });
  it('creates an explicit input-only payload and accepts server timestamps', async () => {
    const mock = sdk(row);
    const chat = await createChatRepository(mock.client).create(userId, { id, ...input });
    expect(mock.query.insert).toHaveBeenCalledWith({ id, user_id: userId, ...input, revision: 0 });
    expect(chat.updatedAt).toBe(row.updated_at);
    expect(mock.query.eq).toHaveBeenCalledWith('user_id', userId);
  });
  it('increments the persisted revision only when the expected revision still matches', async () => {
    const mock = sdk({ ...row, revision: 8 });
    const chat = await createChatRepository(mock.client).update(userId, id, 7, input);
    expect(chat.revision).toBe(8);
    expect(mock.query.update).toHaveBeenCalledWith({ ...input, revision: 8 });
    expect(mock.query.eq).toHaveBeenCalledWith('user_id', userId);
    expect(mock.query.eq).toHaveBeenCalledWith('id', id);
    expect(mock.query.eq).toHaveBeenCalledWith('revision', 7);
  });
  it('reports a conflicting or deleted update without overwriting it', async () => {
    const mock = sdk(null);
    await expect(createChatRepository(mock.client).update(userId, id, 7, input)).rejects.toBeInstanceOf(ChatConflictError);
    expect(mock.query.insert).not.toHaveBeenCalled();
  });
  it('removes only the named chat for the supplied owner', async () => {
    const mock = sdk(null);
    await createChatRepository(mock.client).remove(userId, id);
    expect(mock.query.delete).toHaveBeenCalledOnce();
    expect(mock.query.eq).toHaveBeenCalledWith('user_id', userId);
    expect(mock.query.eq).toHaveBeenCalledWith('id', id);
  });
  it.each(['list', 'load', 'create', 'update', 'remove'] as const)('surfaces database errors for %s', async method => {
    const mock = sdk(null, { message: 'Database unavailable', code: '503' });
    const repo = createChatRepository(mock.client);
    const action = { list: () => repo.list(userId), load: () => repo.load(userId, id), create: () => repo.create(userId, { id, ...input }), update: () => repo.update(userId, id, 0, input), remove: () => repo.remove(userId, id) }[method];
    await expect(action()).rejects.toThrow(/database unavailable/i);
  });
  it('fails honestly when a requested chat is missing', async () => {
    await expect(createChatRepository(sdk(null).client).load(userId, id)).rejects.toBeInstanceOf(ChatNotFoundError);
  });
  it.each([
    { ...row, messages: [{ ...message, role: 'system' }] },
    { ...row, messages: [{ ...message, content: 'a'.repeat(1001) }] },
    { ...row, messages: [{ ...message, revision: -1 }] },
    { ...row, messages: [{ ...message, providerResult: {} }] },
    { ...row, trip: { ...trip, providerResults: {} } },
    { ...row, trip: { ...trip, drivingAllowed: true } },
    { ...row, title: 'a'.repeat(121) },
    { ...row, revision: 0.5 },
    { ...row, updated_at: 'not a timestamp' },
    { ...row, unknown: 'unexpected' },
    { ...row, user_id: otherUser },
  ])('rejects malformed or mismatched restored rows %#', async invalid => {
    await expect(createChatRepository(sdk(invalid).client).load(userId, id)).rejects.toThrow();
  });
  it('rejects malformed summaries rather than silently dropping them', async () => {
    await expect(createChatRepository(sdk([{ ...summary(), revision: -1 }]).client).list(userId)).rejects.toThrow();
    await expect(createChatRepository(sdk([{ ...summary(), user_id: otherUser }]).client).list(userId)).rejects.toThrow();
  });
  it('keeps 1000 archived turns intact and rejects 1001 before writing', async () => {
    const messages = Array.from({ length: MAX_CHAT_MESSAGES }, (_, n) => ({ ...message, id: `turn-${n}` }));
    const mock = sdk({ ...row, messages }); const repo = createChatRepository(mock.client);
    const result = await repo.create(userId, { id, ...input, messages });
    expect(result.messages).toHaveLength(1000); expect(result.messages[0].id).toBe('turn-0');
    mock.query.insert.mockClear();
    await expect(repo.create(userId, { id, ...input, messages: [...messages, message] })).rejects.toThrow(/1000/);
    expect(mock.query.insert).not.toHaveBeenCalled();
  });
  it('rejects a turn ID beyond the database limit before writing', async () => {
    const mock = sdk(row);
    await expect(createChatRepository(mock.client).create(userId, { id, ...input, messages: [{ ...message, id: 'a'.repeat(121) }] })).rejects.toThrow();
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('rejects oversized UTF-8 transcripts before a network write', async () => {
    const mock = sdk(row);
    const messages = Array.from({ length: 400 }, (_, n) => ({ ...message, id: `turn-${n}`, content: '漢'.repeat(1000) }));
    await expect(createChatRepository(mock.client).create(userId, { id, ...input, messages })).rejects.toThrow(/large|size|bytes/i);
    expect(mock.from).not.toHaveBeenCalled();
    await expect(createChatRepository(sdk({ ...row, messages }).client).load(userId, id)).rejects.toThrow(/large|size|bytes/i);
  });
  it.each(['create', 'update'] as const)('rejects unexpected ownership in %s responses', async method => {
    const repo = createChatRepository(sdk({ ...row, user_id: otherUser }).client);
    const action = method === 'create' ? repo.create(userId, { id, ...input }) : repo.update(userId, id, 0, input);
    await expect(action).rejects.toThrow(/account/i);
  });
  it('rejects a response for a different chat', async () => {
    await expect(createChatRepository(sdk({ ...row, id: otherUser }).client).load(userId, id)).rejects.toThrow(/different/i);
  });
  it('rejects unsafe runtime payloads before creating or updating', async () => {
    const mock = sdk(row); const repo = createChatRepository(mock.client);
    await expect(repo.create(userId, { id, ...input, messages: [{ ...message, providerResult: {} }] } as never)).rejects.toThrow();
    await expect(repo.update(userId, id, 0, { ...input, trip: { ...trip, origin: { name: 'Provider city' } } } as never)).rejects.toThrow();
    await expect(repo.update(userId, id, -1, input)).rejects.toThrow();
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('rejects absent or malformed owner and chat IDs before querying', async () => {
    const mock = sdk(row); const repo = createChatRepository(mock.client);
    await expect(repo.list('')).rejects.toThrow(); await expect(repo.load(userId, 'invalid')).rejects.toThrow();
    expect(mock.from).not.toHaveBeenCalled();
  });
});
