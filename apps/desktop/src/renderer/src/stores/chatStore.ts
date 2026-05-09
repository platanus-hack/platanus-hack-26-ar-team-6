import { create } from 'zustand'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type ChatState = {
  messagesByWorkspace: Record<string, ChatMessage[]>
  toolStatusByWorkspace: Record<string, string | null>
  addMessage: (workspaceId: string, message: ChatMessage) => void
  startAssistantMessage: (workspaceId: string, id: string) => void
  appendMessageText: (workspaceId: string, id: string, text: string) => void
  setMessageText: (workspaceId: string, id: string, text: string) => void
  setToolStatus: (workspaceId: string, status: string | null) => void
}

const useChatStore = create<ChatState>((set) => ({
  messagesByWorkspace: {},
  toolStatusByWorkspace: {},
  addMessage: (workspaceId, message) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: [...(state.messagesByWorkspace[workspaceId] ?? []), message]
      }
    })),
  startAssistantMessage: (workspaceId, id) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: [...(state.messagesByWorkspace[workspaceId] ?? []), { id, role: 'assistant', text: '' }]
      }
    })),
  appendMessageText: (workspaceId, id, text) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: (state.messagesByWorkspace[workspaceId] ?? []).map((message) =>
          message.id === id ? { ...message, text: `${message.text}${text}` } : message
        )
      }
    })),
  setMessageText: (workspaceId, id, text) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: (state.messagesByWorkspace[workspaceId] ?? []).map((message) =>
          message.id === id ? { ...message, text } : message
        )
      }
    })),
  setToolStatus: (workspaceId, status) =>
    set((state) => ({
      toolStatusByWorkspace: {
        ...state.toolStatusByWorkspace,
        [workspaceId]: status
      }
    }))
}))

export type { ChatMessage, ChatState }
export default useChatStore
