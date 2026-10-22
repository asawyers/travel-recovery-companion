import type { ChatInput, ChatMessage, ChatRecord, ChatSummary, StoredTrip } from './contracts';
import { ChatConflictError, ChatNotFoundError, type ChatRepository } from './repository';

export const ROUTE_DETAILS_PLACEHOLDER = 'Route-specific details were not saved. Check current options to review this part of the conversation.';
export const emptyStoredTrip = (): StoredTrip => ({ originCityId: null, destinationCityId: null, goal: 'asap', readyLocal: '', readyAt: null, deadlineLocal: '', budget: '', budgetMode: 'soft', priority: 'earliest' });
export type ChatHistoryState = {
  summaries: (ChatSummary & { localOnly?: boolean })[]; id: string | null; messages: ChatMessage[];
  status: 'loading' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict';
  error: string | null; initialized: boolean; historical: boolean;
};
type LocalChat = {
  id: string; userId: string; input: ChatInput; messages: ChatMessage[];
  uncertainCreate: { input: ChatInput; version: number } | null;
  revision: number | null; version: number; savedVersion: number;
  writing: Promise<void> | null; retrying: boolean; deleting: boolean; failed: boolean; conflict: boolean; deleted: boolean;
};
const initial = (): ChatHistoryState => ({ summaries: [], id: null, messages: [], status: 'loading', error: null, initialized: false, historical: false });

/** Owns the full archive independently of the bounded display and model context. */
export class ChatHistoryController {
  private state = initial();
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private generation = 0;
  private active: LocalChat | null = null;
  private chats = new Map<string, LocalChat>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private repository: ChatRepository;
  private restore: (trip: StoredTrip, historical: boolean) => void | Promise<void>;
  private makeId: () => string;
  constructor(repository: ChatRepository, restore: (trip: StoredTrip, historical: boolean) => void | Promise<void>, makeId: () => string = () => crypto.randomUUID()) {
    this.repository = repository; this.restore = restore; this.makeId = makeId;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<ChatHistoryState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private cancelTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private local(record?: ChatRecord): LocalChat {
    return { id: record?.id ?? this.makeId(), userId: this.userId!, input: record ? { title: record.title, messages: record.messages, trip: record.trip } : { title: 'New chat', messages: [], trip: emptyStoredTrip() }, messages: record?.messages ?? [], revision: record?.revision ?? null, uncertainCreate: null, version: 0, savedVersion: 0, writing: null, retrying: false, deleting: false, failed: false, conflict: false, deleted: false };
  }
  async start(userId: string | null) {
    this.cancelTimer(); const generation = ++this.generation;
    this.userId = userId; this.active = null; this.chats.clear(); this.state = initial(); this.patch({});
    if (!userId) return;
    try {
      const summaries = await this.repository.list(userId);
      if (generation !== this.generation) return;
      this.patch({ summaries });
      const record = summaries[0] ? await this.repository.load(userId, summaries[0].id) : null;
      if (generation !== this.generation) return;
      await this.activate(this.local(record ?? undefined), Boolean(record), generation);
    } catch (error) {
      if (generation === this.generation) this.patch({ status: 'error', error: this.errorMessage(error) });
    }
  }
  private async activate(chat: LocalChat, historical: boolean, generation = this.generation) {
    const trip = chat.input.trip ?? emptyStoredTrip();
    // An earlier ASAP search generated readyAt; reopening Leaving now must
    // resolve against the next explicit search clock, not that old search.
    await this.restore({ ...trip, readyAt: trip.readyLocal ? trip.readyAt : null }, historical);
    if (generation !== this.generation) return;
    this.active = chat; this.chats.set(chat.id, chat);
    this.patch({ id: chat.id, messages: chat.messages, initialized: true, historical, error: chat.failed ? 'Chat not saved. Your messages are retained in this tab.' : null, status: chat.conflict ? 'conflict' : chat.failed ? 'error' : chat.revision === null ? 'unsaved' : 'saved' });
  }
  private leave() {
    this.cancelTimer();
    const chat = this.active;
    if (chat && !chat.failed && !chat.conflict) void this.flush(chat);
  }
  async newChat() {
    if (!this.state.initialized) return;
    this.leave(); this.patch({ initialized: false, status: 'loading' });
    await this.activate(this.local(), false);
  }
  async open(id: string, reload = false) {
    if (!this.userId || !this.state.initialized) return;
    this.leave(); const generation = this.generation;
    const cached = this.chats.get(id);
    this.patch({ initialized: false, status: 'loading', error: null });
    try {
      const chat = cached && !reload ? cached : null;
      const record = chat ? null : await this.repository.load(this.userId, id);
      if (generation !== this.generation) return;
      if (!chat && !record) throw new Error('This chat is no longer available.');
      await this.activate(chat ?? this.local(record!), true, generation);
    } catch (error) {
      if (generation === this.generation) this.patch({ initialized: true, status: 'error', error: this.errorMessage(error) });
    }
  }
  append(turn: ChatMessage, routeDerived = false) {
    const chat = this.active;
    if (!chat || !this.state.initialized) return;
    const recentRouteContext = chat.messages.slice(-12).some(message => {
      const saved = chat.input.messages.find(candidate => candidate.id === message.id);
      return saved?.content === ROUTE_DETAILS_PLACEHOLDER && saved.content !== message.content;
    });
    const withholdRouteText = turn.role === 'assistant' && (routeDerived || recentRouteContext);
    const message = { ...turn, content: turn.content.slice(0, 1000) };
    chat.messages = [...chat.messages, message];
    chat.input = { ...chat.input, messages: [...chat.input.messages, withholdRouteText ? { ...message, content: ROUTE_DETAILS_PLACEHOLDER } : message] };
    this.patch({ messages: chat.messages }); this.changed(chat);
  }
  setTrip(trip: StoredTrip, title: string) {
    const chat = this.active;
    if (!chat || !this.state.initialized || (JSON.stringify(chat.input.trip) === JSON.stringify(trip) && chat.input.title === title)) return;
    chat.input = { ...chat.input, trip, title }; this.changed(chat);
  }
  private changed(chat: LocalChat) {
    chat.version++;
    if (this.nonempty(chat)) {
      const previous = this.state.summaries.find(summary => summary.id === chat.id);
      const now = new Date().toISOString();
      this.patch({ summaries: [{ id: chat.id, userId: chat.userId, title: chat.input.title, revision: chat.revision ?? 0, createdAt: previous?.createdAt ?? now, updatedAt: now, localOnly: chat.revision === null }, ...this.state.summaries.filter(summary => summary.id !== chat.id)] });
    }
    if (chat.failed || chat.conflict) return;
    this.patch({ status: 'unsaved', error: null }); this.cancelTimer();
    this.timer = setTimeout(() => { this.timer = null; void this.flush(chat); }, 300);
  }
  private nonempty(chat: LocalChat) {
    const trip = chat.input.trip ?? emptyStoredTrip();
    return Boolean(chat.input.messages.length || trip.originCityId || trip.destinationCityId || trip.budget || trip.readyLocal || trip.deadlineLocal);
  }
  private flush(chat: LocalChat): Promise<void> {
    if (chat.writing) return chat.writing;
    if (chat.deleted || chat.deleting || chat.failed || chat.conflict || chat.version === chat.savedVersion || !this.nonempty(chat)) return Promise.resolve();
    const generation = this.generation;
    const visible = () => generation === this.generation && chat === this.active && !chat.deleted && !chat.deleting;
    chat.writing = (async () => {
      while (generation === this.generation && !chat.deleted && !chat.deleting && !chat.failed && !chat.conflict && chat.savedVersion < chat.version) {
        const version = chat.version;
        const input = { ...chat.input, messages: [...chat.input.messages] };
        if (visible()) this.patch({ status: 'saving', error: null });
        try {
          if (chat.revision === null) chat.uncertainCreate = { input, version };
          const record = chat.revision === null
            ? await this.repository.create(chat.userId, { id: chat.id, ...input })
            : await this.repository.update(chat.userId, chat.id, chat.revision, input);
          chat.revision = record.revision; chat.savedVersion = version; chat.uncertainCreate = null;
          if (generation === this.generation && !chat.deleted) {
            this.patch({ summaries: [record, ...this.state.summaries.filter(summary => summary.id !== record.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((summary, index) => index < 50 || ('localOnly' in summary && summary.localOnly)), ...(visible() ? { status: 'saved' as const } : {}) });
          }
        } catch (error) {
          chat.failed = true; chat.conflict = error instanceof ChatConflictError;
          if (visible()) this.patch({ status: chat.conflict ? 'conflict' : 'error', error: chat.conflict ? 'This chat changed in another tab or device. Your local messages are retained. Reopen the saved version to continue.' : this.errorMessage(error) });
        }
      }
    })().finally(() => { chat.writing = null; });
    return chat.writing;
  }
  async retry() {
    if (!this.state.initialized) {
      if (!this.active && this.state.status === 'error') await this.start(this.userId);
      return;
    }
    const chat = this.active;
    if (!chat || chat.conflict || chat.retrying || chat.deleting) return;
    chat.retrying = true;
    try { await this.retryChat(chat); } finally { chat.retrying = false; }
  }
  private async retryChat(chat: LocalChat) {
    const generation = this.generation;
    if (chat.revision === null && chat.uncertainCreate) {
      // A network error may arrive after INSERT commits. Recover that exact row
      // before issuing another INSERT, without treating newer local edits as saved.
      const attempt = chat.uncertainCreate;
      try {
        let remote: ChatRecord | null;
        try { remote = await this.repository.load(chat.userId, chat.id); }
        catch (error) { if (error instanceof ChatNotFoundError) remote = null; else throw error; }
        if (generation !== this.generation || chat.deleted || chat.deleting || chat.uncertainCreate !== attempt) return;
        if (remote) {
          if (!sameInput(remote, attempt.input)) {
            chat.conflict = true;
            if (chat === this.active) this.patch({ status: 'conflict', error: 'A different version of this chat is saved. Your local messages are retained. Reopen the saved version to continue.' });
            return;
          }
          chat.revision = remote.revision;
          chat.savedVersion = attempt.version;
          this.patch({ summaries: [remote, ...this.state.summaries.filter(summary => summary.id !== remote.id)] });
        }
        chat.uncertainCreate = null;
      } catch (error) {
        if (generation === this.generation && chat === this.active && !chat.deleted && !chat.deleting) this.patch({ status: 'error', error: this.errorMessage(error) });
        return;
      }
    }
    chat.failed = false;
    await this.flush(chat);
    if (generation === this.generation && chat === this.active && !chat.failed && chat.savedVersion === chat.version) this.patch({ status: 'saved', error: null });
  }
  async deleteSelected() {
    const chat = this.active; if (!chat || !this.userId || !this.state.initialized) return;
    this.cancelTimer(); const generation = this.generation;
    chat.deleting = true;
    this.patch({ initialized: false, status: 'loading' });
    if (chat.writing) await chat.writing;
    try {
      await this.repository.remove(chat.userId, chat.id);
      if (generation !== this.generation) return;
      chat.deleted = true; this.chats.delete(chat.id);
      this.patch({ summaries: this.state.summaries.filter(summary => summary.id !== chat.id) });
      await this.activate(this.local(), false);
    } catch (error) {
      chat.deleting = false;
      if (generation === this.generation) this.patch({ initialized: true, status: 'error', error: this.errorMessage(error) });
    }
  }
  private errorMessage(error: unknown) {
    return `${error instanceof Error ? error.message : 'Chat storage is unavailable.'} Your messages are retained in this tab.`;
  }
  dispose() { this.leave(); this.generation++; this.listeners.clear(); }
}

function sameInput(left: ChatInput, right: ChatInput): boolean {
  if (left.title !== right.title || left.messages.length !== right.messages.length) return false;
  if (!left.messages.every((message, index) => {
    const other = right.messages[index];
    return message.id === other.id && message.role === other.role && message.content === other.content && message.revision === other.revision;
  })) return false;
  if (left.trip === null || right.trip === null) return left.trip === right.trip;
  return (Object.keys(emptyStoredTrip()) as (keyof StoredTrip)[]).every(key => left.trip![key] === right.trip![key]);
}
