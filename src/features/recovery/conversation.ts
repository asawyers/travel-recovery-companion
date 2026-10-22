import type { ConversationContext, ConversationEcho } from "@domain/conversation";

export type ConversationTurn = { id: string; role: "user" | "assistant"; content: string; revision: number };
/** Only current-tab plain text, bounded independently of the rendered conversation. */
export function conversationContext(turnId: string, baseRevision: number, turns: ConversationTurn[]): ConversationContext {
  const history: ConversationContext["history"] = [];
  let length = 0;
  for (const turn of turns.slice(-12).reverse()) {
    const content = turn.content.trim().slice(0, 1000);
    if (!content || length + content.length > 8000) continue;
    history.unshift({ role: turn.role, content });
    length += content.length;
  }
  return { turnId, baseRevision, history };
}
export function matchesConversation(context: ConversationContext | undefined, echo: ConversationEcho | undefined, liveRevision: number): boolean {
  return !context || (context.baseRevision === liveRevision && echo?.turnId === context.turnId && echo.baseRevision === context.baseRevision);
}
export function appendConversation(turns: ConversationTurn[], turn: ConversationTurn): ConversationTurn[] {
  return [...turns, { ...turn, content: turn.content.slice(0, 1000) }].slice(-24);
}
