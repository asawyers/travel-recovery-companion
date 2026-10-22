import { Button } from '@/components/ui/button';
import type { ChatHistoryController, ChatHistoryState } from './chatHistoryController';

export function ChatHistoryPanel({ state, controller }: { state: ChatHistoryState; controller: ChatHistoryController }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm" aria-label="Account chats">
    <Button type="button" variant="outline" size="sm" disabled={!state.initialized} onClick={() => void controller.newChat()}>New chat</Button>
    <details className="relative min-w-0">
      <summary className="cursor-pointer rounded-md px-2 py-2 text-sm font-medium">Chat history{state.summaries.length ? ` (${state.summaries.length})` : ''}</summary>
      <div className="absolute left-0 top-full z-40 mt-2 w-72 max-w-[85vw] rounded-xl border bg-white p-3 shadow-lg">
        <p className="mb-2 text-xs text-muted-foreground">Recent account chats and drafts in this tab</p>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {state.summaries.map(chat => <li key={chat.id}><button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-60" disabled={!state.initialized} aria-current={chat.id === state.id ? 'true' : undefined} onClick={() => void controller.open(chat.id)}><span className="block truncate font-medium">{chat.title}</span><span className="text-xs text-muted-foreground">{chat.localOnly ? 'Not saved · This tab' : new Date(chat.updatedAt).toLocaleDateString()}</span></button></li>)}
        </ul>
        {!state.summaries.length && <p className="py-2 text-sm text-muted-foreground">{state.status === 'loading' ? 'Loading chats…' : 'No saved chats yet.'}</p>}
        {state.id && state.summaries.some(chat => chat.id === state.id) && <Button type="button" variant="outline" size="sm" className="mt-3 w-full" disabled={!state.initialized} onClick={() => void controller.deleteSelected()}>Delete selected chat</Button>}
      </div>
    </details>
    <span role="status" className="text-xs text-muted-foreground">{state.status === 'loading' ? 'Loading chats…' : state.status === 'saving' ? 'Saving chat…' : state.status === 'saved' ? 'Chat saved' : state.status === 'error' || state.status === 'conflict' ? 'Chat not saved' : state.messages.length ? 'Changes waiting to save' : ''}</span>
    {state.error && <div className="basis-full text-xs text-destructive" role="alert"><p>{state.error}</p>{state.status === 'conflict' && state.id ? <Button type="button" variant="link" size="sm" onClick={() => void controller.open(state.id!, true)}>Reopen saved version</Button> : <Button type="button" variant="link" size="sm" onClick={() => void controller.retry()}>Retry save</Button>}</div>}
  </div>;
}
