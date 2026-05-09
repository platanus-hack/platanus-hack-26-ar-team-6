import { create } from 'zustand'

type ChatMessage = {
  id: string
  author: string
  text: string
  isStreaming?: boolean
}

type ChatState = {
  messages: ChatMessage[]
  setMessages: (messages: ChatMessage[]) => void
  appendMessage: (message: ChatMessage) => void
  appendAssistantText: (replyId: string, text: string) => void
  finishAssistantText: (replyId: string, finalText?: string) => void
}

const ASSISTANT_AUTHOR = 'assistant'

function mergeAssistantText(messages: ChatMessage[], replyId: string, text: string): ChatMessage[] {
  if (text.length === 0) {
    return messages
  }

  const existing = messages.find(
    (message) => message.id === replyId && message.author === ASSISTANT_AUTHOR
  )

  if (!existing) {
    return [
      ...messages,
      {
        id: replyId,
        author: ASSISTANT_AUTHOR,
        text,
        isStreaming: true
      }
    ]
  }

  // V2 workaround: the runner emits streamed deltas and then the final full
  // assistant message as the same assistant_text event. When the new text
  // already contains the streamed prefix, treat it as the full message rather
  // than another chunk to append. V3 should split delta/final event semantics.
  if (text === existing.text || existing.text.startsWith(text)) {
    return messages
  }

  const nextText = text.startsWith(existing.text) ? text : `${existing.text}${text}`

  return messages.map((message) =>
    message.id === existing.id
      ? {
          ...message,
          text: nextText,
          isStreaming: true
        }
      : message
  )
}

function completeAssistantText(
  messages: ChatMessage[],
  replyId: string,
  finalText?: string
): ChatMessage[] {
  const withFinalText = finalText ? mergeAssistantText(messages, replyId, finalText) : messages

  return withFinalText.map((message) =>
    message.id === replyId && message.author === ASSISTANT_AUTHOR
      ? {
          ...message,
          isStreaming: false
        }
      : message
  )
}

const useChatStore = create<ChatState>((set) => ({
  messages: [],
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  appendAssistantText: (replyId, text) =>
    set((state) => ({ messages: mergeAssistantText(state.messages, replyId, text) })),
  finishAssistantText: (replyId, finalText) =>
    set((state) => ({ messages: completeAssistantText(state.messages, replyId, finalText) }))
}))

export { completeAssistantText, mergeAssistantText }
export type { ChatMessage, ChatState }
export default useChatStore
