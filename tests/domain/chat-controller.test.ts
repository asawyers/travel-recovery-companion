import { cityFixture } from '@domain/city-fixtures';
import { buildCityRequest, emptyCityDraft } from '../../src/features/city/formModel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatHistoryController, ROUTE_DETAILS_PLACEHOLDER } from '../../src/features/chats/chatHistoryController';
import { ChatConflictError, ChatNotFoundError } from '../../src/features/chats/repository';
import type { ChatInput, ChatRecord, StoredTrip } from '../../src/features/chats/contracts';

const trip: StoredTrip = { originCityId: null, destinationCityId: null, goal: 'asap', readyLocal: '', readyAt: null, deadlineLocal: '', budget: '', budgetMode: 'soft', priority: 'earliest' };
const turn = (id: string) => ({ id, role: 'user' as const, content: id, revision: 0 });
const record = (id: string, input: ChatInput, revision = 1): ChatRecord => ({ id, userId: 'alice', createdAt: '2026-10-22T10:00:00Z', updatedAt: '2026-10-22T10:00:00Z', revision, ...input });
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function setup() {
  const rows = new Map<string, ChatRecord>();
  const repository = {
    list: vi.fn(async () => [...rows.values()]),
    load: vi.fn(async (_u: string, id: string) => { const row = rows.get(id); if (!row) throw new ChatNotFoundError(); return row; }),
    create: vi.fn(async (_u: string, input: ChatInput & {id: string}) => { const row = record(input.id, input); rows.set(row.id, row); return row; }),
    update: vi.fn(async (_u: string, id: string, revision: number, input: ChatInput) => { const row = record(id, input, revision + 1); rows.set(id, row); return row; }),
    remove: vi.fn(async (_u: string, id: string) => { rows.delete(id); }),
  };
  const restored = vi.fn(async (_trip: StoredTrip, _historical: boolean) => {});
  let idSequence = 0;
  const controller = new ChatHistoryController(repository, restored, () => ++idSequence === 1 ? 'new-id' : `new-id-${idSequence}`);
  return { rows, repository, controller, restored };
}
afterEach(() => vi.useRealTimers());
describe('account chat controller', () => {
  it('loads latest history before allowing any autosave', async () => {
    vi.useFakeTimers();
    const { controller, repository } = setup();
    const loading = deferred<ChatRecord[]>(); repository.list.mockReturnValueOnce(loading.promise);
    const start = controller.start('alice');
    controller.append(turn('should-not-write')); controller.setTrip(trip, 'draft');
    await vi.advanceTimersByTimeAsync(500);
    expect(repository.create).not.toHaveBeenCalled();
    loading.resolve([record('existing', { title: 'Saved', messages: [turn('old')], trip })]);
    // The repository normally lists summaries and then loads the full record.
    repository.load.mockResolvedValueOnce(record('existing', { title: 'Saved', messages: [turn('old')], trip }));
    await start;
    expect(controller.getSnapshot().messages.map(t => t.id)).toEqual(['old']);
    await vi.advanceTimersByTimeAsync(500);
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('archives more than 24 turns and saves a placeholder for derived route text', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    controller.setTrip(trip, 'Trip');
    for (let i = 0; i < 30; i++) controller.append(turn(String(i)));
    controller.append({ ...turn('route'), role: 'assistant', content: 'Google route specific facts' }, true);
    await vi.advanceTimersByTimeAsync(300);
    const input = repository.create.mock.calls[0][1];
    expect(input.messages).toHaveLength(31);
    expect(input.messages.at(-1)?.content).toBe(ROUTE_DETAILS_PLACEHOLDER);
    expect(controller.getSnapshot().messages.at(-1)?.content).toBe('Google route specific facts');
  });
  it('retains local text after failed save and retries the exact chat', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    repository.create.mockRejectedValueOnce(new Error('offline'));
    controller.append(turn('retained')); await vi.advanceTimersByTimeAsync(300);
    expect(controller.getSnapshot().status).toBe('error');
    expect(controller.getSnapshot().messages[0].content).toBe('retained');
    await controller.retry();
    expect(controller.getSnapshot().status).toBe('saved');
    expect(repository.create).toHaveBeenCalledTimes(2);
  });
  it('queues edits behind an in-flight write and advances the revision', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    const save = deferred<ChatRecord>(); repository.create.mockReturnValueOnce(save.promise);
    controller.append(turn('one')); await vi.advanceTimersByTimeAsync(300);
    controller.append(turn('two')); await vi.advanceTimersByTimeAsync(300);
    expect(repository.update).not.toHaveBeenCalled();
    save.resolve(record('new-id', { title: 'New chat', messages: [turn('one')], trip }));
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.update.mock.calls[0][2]).toBe(1);
    expect(repository.update.mock.calls[0][3].messages).toHaveLength(2);
  });
  it('ignores a stale account load after switching accounts', async () => {
    const { controller, repository } = setup(); const old = deferred<ChatRecord[]>();
    repository.list.mockReturnValueOnce(old.promise);
    const first = controller.start('alice'); await controller.start('bob');
    old.resolve([record('alice-chat', { title: 'Private', messages: [turn('alice')], trip })]); await first;
    expect(controller.getSnapshot().summaries).toEqual([]);
    expect(repository.load).not.toHaveBeenCalled();
  });
  it('blocks retries on a revision conflict until the user reopens history', async () => {
    vi.useFakeTimers(); const { controller, repository, rows } = setup();
    rows.set('existing', record('existing', { title: 'Saved', messages: [turn('old')], trip }));
    await controller.start('alice'); repository.update.mockRejectedValueOnce(new ChatConflictError());
    controller.append(turn('local')); await vi.advanceTimersByTimeAsync(300);
    expect(controller.getSnapshot().status).toBe('conflict'); await controller.retry();
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().messages.at(-1)?.content).toBe('local');
  });
  it('keeps an in-flight old chat write from changing the selected new chat', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    const save = deferred<ChatRecord>(); repository.create.mockReturnValueOnce(save.promise);
    controller.append(turn('old-chat')); await vi.advanceTimersByTimeAsync(300);
    await controller.newChat();
    expect(controller.getSnapshot().messages).toEqual([]);
    save.resolve(record('new-id', { title: 'Old chat', messages: [turn('old-chat')], trip }));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().messages).toEqual([]);
  });
  it('does not continue queued writes after an account switch or leak completion state', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    const save = deferred<ChatRecord>(); repository.create.mockReturnValueOnce(save.promise);
    controller.append(turn('alice-one')); await vi.advanceTimersByTimeAsync(300);
    controller.append(turn('alice-two')); await controller.start('bob');
    save.resolve(record('new-id', { title: 'Alice', messages: [turn('alice-one')], trip }));
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.update).not.toHaveBeenCalled();
    expect(controller.getSnapshot().summaries).toEqual([]);
    expect(controller.getSnapshot().messages).toEqual([]);
  });
  it('also withholds model replies that could derive from recent Google route text', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    controller.append({ ...turn('route'), role: 'assistant', content: 'A route detail' }, true);
    controller.append(turn('question'));
    controller.append({ ...turn('followup'), role: 'assistant', content: 'A reply to prior route facts' });
    await vi.advanceTimersByTimeAsync(300);
    expect(repository.create.mock.calls[0][1].messages.map(message => message.content)).toEqual([ROUTE_DETAILS_PLACEHOLDER, 'question', ROUTE_DETAILS_PLACEHOLDER]);
  });

  it('makes a failed first-save draft selectable after starting another chat', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    repository.create.mockRejectedValueOnce(new Error('offline'));
    controller.append(turn('recoverable')); await vi.advanceTimersByTimeAsync(300);
    const localId = controller.getSnapshot().id!;
    await controller.newChat();
    expect(controller.getSnapshot().summaries.some(summary => summary.id === localId)).toBe(true);
    await controller.open(localId);
    expect(controller.getSnapshot().messages[0].content).toBe('recoverable');
  });
  it('reconciles a committed create with a lost response before retrying queued edits', async () => {
    vi.useFakeTimers(); const { controller, repository, rows } = setup(); await controller.start('alice');
    repository.create.mockImplementationOnce(async (_user, input) => {
      rows.set(input.id, record(input.id, input));
      throw new Error('response lost');
    });
    controller.append(turn('committed')); await vi.advanceTimersByTimeAsync(300);
    controller.append(turn('later-local-edit')); await controller.retry();
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.update.mock.calls[0][2]).toBe(1);
    expect(rows.get('new-id')?.messages.map(message => message.content)).toEqual(['committed', 'later-local-edit']);
    expect(controller.getSnapshot().status).toBe('saved');
  });
  it('does not replace a different remote chat after reconciling an uncertain create', async () => {
    vi.useFakeTimers(); const { controller, repository, rows } = setup(); await controller.start('alice');
    repository.create.mockRejectedValueOnce(new Error('response lost'));
    controller.append(turn('local')); await vi.advanceTimersByTimeAsync(300);
    rows.set('new-id', record('new-id', { title: 'Other version', messages: [turn('remote')], trip }));
    await controller.retry();
    expect(controller.getSnapshot().status).toBe('conflict');
    expect(controller.getSnapshot().messages[0].content).toBe('local');
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('removes an uncertain create by owner and id even before its response is recovered', async () => {
    vi.useFakeTimers(); const { controller, repository, rows } = setup(); await controller.start('alice');
    repository.create.mockImplementationOnce(async (_user, input) => {
      rows.set(input.id, record(input.id, input)); throw new Error('response lost');
    });
    controller.append(turn('committed')); await vi.advanceTimersByTimeAsync(300);
    await controller.deleteSelected();
    expect(repository.remove).toHaveBeenCalledWith('alice', 'new-id');
    expect(rows.size).toBe(0);
  });

  it('does not reinsert or restore a summary when deletion overtakes retry reconciliation', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    repository.create.mockRejectedValueOnce(new Error('offline'));
    controller.append(turn('local')); await vi.advanceTimersByTimeAsync(300);
    const lookup = deferred<ChatRecord | null>(); repository.load.mockReturnValueOnce(lookup.promise);
    const retry = controller.retry(); await controller.deleteSelected();
    lookup.resolve(record('new-id', { title: 'New chat', messages: [turn('local')], trip })); await retry;
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().summaries).toEqual([]);
    expect(controller.getSnapshot().messages).toEqual([]);
  });
  it('allows only one uncertain-create reconciliation at a time', async () => {
    vi.useFakeTimers(); const { controller, repository } = setup(); await controller.start('alice');
    repository.create.mockRejectedValueOnce(new Error('offline'));
    controller.append(turn('local')); await vi.advanceTimersByTimeAsync(300);
    const lookup = deferred<ChatRecord | null>(); repository.load.mockReturnValueOnce(lookup.promise);
    const retry = controller.retry(); const duplicate = controller.retry();
    expect(repository.load).toHaveBeenCalledTimes(1);
    lookup.resolve(null); await Promise.all([retry, duplicate]);
  });

  it('reopens Leaving now history with the current search time instead of its old generated instant', async () => {
    const { controller, rows, restored, repository } = setup(); const cities = cityFixture();
    const storedTrip = { ...trip, originCityId: cities.origin.id, destinationCityId: cities.destination.id, readyAt: '2026-10-21T09:00:00Z' };
    rows.set('existing', record('existing', { title: 'Saved', messages: [turn('old')], trip: storedTrip }));
    await controller.start('alice');
    const restoredTrip = restored.mock.calls[0][0];
    const now = '2026-11-20T12:00:00Z';
    const built = buildCityRequest({ ...emptyCityDraft(), ...restoredTrip, origin: cities.origin, destination: cities.destination }, now);
    expect(built.request?.readyAt).toBe(now);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('preserves explicit local readiness and deadline when reopening a chat', async () => {
    const { controller, rows, restored } = setup(); const cities = cityFixture();
    const storedTrip: StoredTrip = { ...trip, originCityId: cities.origin.id, destinationCityId: cities.destination.id, goal: 'deadline', readyLocal: '2026-11-20T10:00', readyAt: '2026-11-20T15:00:00Z', deadlineLocal: '2026-11-20T18:00' };
    rows.set('existing', record('existing', { title: 'Saved', messages: [turn('old')], trip: storedTrip }));
    await controller.start('alice');
    const restoredTrip = restored.mock.calls[0][0];
    expect(restoredTrip).toEqual(storedTrip);
    const built = buildCityRequest({ ...emptyCityDraft(), ...restoredTrip, origin: cities.origin, destination: cities.destination }, '2026-11-20T16:00:00Z');
    expect(Date.parse(built.request!.readyAt)).toBe(Date.parse('2026-11-20T15:00:00Z'));
    expect(Date.parse(built.request!.deadlineAt!)).toBe(Date.parse('2026-11-20T23:00:00Z'));
  });

});
