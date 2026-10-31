import { createContext, useContext } from 'react'

/**
 * The session a message list shows, for a block inside it that acts on that
 * session's composer (an MCP view's 添加快照到对话). Null outside a list.
 */
const ChatSessionIdContext = createContext<string | null>(null)

export const ChatSessionIdProvider = ChatSessionIdContext.Provider

export function useChatSessionId(): string | null {
  return useContext(ChatSessionIdContext)
}
