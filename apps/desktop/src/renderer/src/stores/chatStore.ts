import { create } from 'zustand'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  isStreaming?: boolean
}

type ToolTraceStatus = 'running' | 'succeeded' | 'failed'

type ToolTraceEntry = {
  id: string
  toolName: string
  toolUseId?: string
  targetUserId?: string
  targetDisplayName?: string
  question?: string
  status: ToolTraceStatus
  elapsedTimeSeconds?: number
  answerPreview?: string
  errorMessage?: string
}

type ChatState = {
  messagesByWorkspace: Record<string, ChatMessage[]>
  toolTraceByWorkspace: Record<string, ToolTraceEntry[]>
  saveStatusByWorkspace: Record<string, string | null>
  runStatusByWorkspace: Record<string, string | null>
  addMessage: (workspaceId: string, message: ChatMessage) => void
  loadMessages: (workspaceId: string, messages: ChatMessage[]) => void
  clearMessages: (workspaceId: string) => void
  startAssistantMessage: (workspaceId: string, id: string) => void
  appendMessageText: (workspaceId: string, id: string, text: string) => void
  setMessageText: (workspaceId: string, id: string, text: string) => void
  resetToolTrace: (workspaceId: string) => void
  addToolTraceEntry: (workspaceId: string, entry: ToolTraceEntry) => void
  updateToolTraceEntry: (workspaceId: string, id: string, patch: Partial<ToolTraceEntry>) => void
  setSaveStatus: (workspaceId: string, status: string | null) => void
  setRunStatus: (workspaceId: string, status: string | null) => void
}

const useChatStore = create<ChatState>((set) => ({
  messagesByWorkspace: {},
  toolTraceByWorkspace: {},
  saveStatusByWorkspace: {},
  runStatusByWorkspace: {},
  addMessage: (workspaceId, message) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: [...(state.messagesByWorkspace[workspaceId] ?? []), message]
      }
    })),
  loadMessages: (workspaceId, messages) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: messages
      }
    })),
  clearMessages: (workspaceId) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: []
      }
    })),
  startAssistantMessage: (workspaceId, id) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: [
          ...(state.messagesByWorkspace[workspaceId] ?? []),
          { id, role: 'assistant', text: '', isStreaming: true }
        ]
      }
    })),
  appendMessageText: (workspaceId, id, text) =>
    set((state) => ({
      messagesByWorkspace: {
        ...state.messagesByWorkspace,
        [workspaceId]: (state.messagesByWorkspace[workspaceId] ?? []).map((message) =>
          message.id === id ? { ...message, text: `${message.text}${text}`, isStreaming: true } : message
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
  resetToolTrace: (workspaceId) =>
    set((state) => ({
      toolTraceByWorkspace: {
        ...state.toolTraceByWorkspace,
        [workspaceId]: []
      }
    })),
  addToolTraceEntry: (workspaceId, entry) =>
    set((state) => ({
      toolTraceByWorkspace: {
        ...state.toolTraceByWorkspace,
        [workspaceId]: [...(state.toolTraceByWorkspace[workspaceId] ?? []), entry]
      }
    })),
  updateToolTraceEntry: (workspaceId, id, patch) =>
    set((state) => ({
      toolTraceByWorkspace: {
        ...state.toolTraceByWorkspace,
        [workspaceId]: (state.toolTraceByWorkspace[workspaceId] ?? []).map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry
        )
      }
    })),
  setSaveStatus: (workspaceId, status) =>
    set((state) => ({
      saveStatusByWorkspace: {
        ...state.saveStatusByWorkspace,
        [workspaceId]: status
      }
    })),
  setRunStatus: (workspaceId, status) =>
    set((state) => ({
      runStatusByWorkspace: {
        ...state.runStatusByWorkspace,
        [workspaceId]: status
      }
    }))
}))

export type { ChatMessage, ChatState, ToolTraceEntry, ToolTraceStatus }
export default useChatStore
