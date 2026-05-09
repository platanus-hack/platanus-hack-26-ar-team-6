import { create } from 'zustand'

type ChatMessage = {
  id: string
  author: string
  text: string
}

type ChatState = {
  messages: ChatMessage[]
  setMessages: (messages: ChatMessage[]) => void
}

const useChatStore = create<ChatState>((set) => ({
  messages: [],
  setMessages: (messages) => set({ messages })
}))

export type { ChatMessage, ChatState }
export default useChatStore
