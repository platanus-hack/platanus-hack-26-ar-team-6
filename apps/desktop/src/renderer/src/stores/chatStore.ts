import { create } from 'zustand'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type ChatState = {
  messages: ChatMessage[]
  toolStatus: string | null
  addMessage: (message: ChatMessage) => void
  startAssistantMessage: (id: string) => void
  appendMessageText: (id: string, text: string) => void
  setMessageText: (id: string, text: string) => void
  setToolStatus: (status: string | null) => void
}

const useChatStore = create<ChatState>((set) => ({
  messages: [],
  toolStatus: null,
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  startAssistantMessage: (id) =>
    set((state) => ({
      messages: [...state.messages, { id, role: 'assistant', text: '' }]
    })),
  appendMessageText: (id, text) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, text: `${message.text}${text}` } : message
      )
    })),
  setMessageText: (id, text) =>
    set((state) => ({
      messages: state.messages.map((message) => (message.id === id ? { ...message, text } : message))
    })),
  setToolStatus: (status) => set({ toolStatus: status })
}))

export type { ChatMessage, ChatState }
export default useChatStore
