import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { parseMentions } from '../../../mentionParser.js'
import { hasConnectedProjectFolder } from '../projectFolders'
import useChatStore from '../stores/chatStore'
import MarkdownMessage from '../components/MarkdownMessage'
import ChatHistorySidebar, {
  type ChatHistoryEntry,
  deriveTitle,
  readHistory,
  writeHistory
} from '../components/ChatHistorySidebar'

type BootstrapResponse = Awaited<ReturnType<typeof window.api.getBootstrap>>

type RunnerBootstrapPayload = {
  user_summary: BootstrapResponse['user']
  project_context: {
    project: BootstrapResponse['project']
    roster: BootstrapResponse['roster']
    recent_entries: BootstrapResponse['recent_entries']
    project_context: BootstrapResponse['project_context']
  }
}

type ChatViewProps = {
  workspaceId: string
  userId: string
  bootstrap: RunnerBootstrapPayload
  isAssistantConfigured: boolean
  onConfigureAssistant: () => void
  projectFolderPath: string | null
  onReconnectFolder: () => void
}

type ToolCallInput = {
  target_agent_id?: string
  query?: string
}

function isToolCallInput(value: unknown): value is ToolCallInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    (obj.target_agent_id === undefined || typeof obj.target_agent_id === 'string') &&
    (obj.query === undefined || typeof obj.query === 'string')
  )
}

function answerPreview(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1)}…`
}

function toRunStatusMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('cwd must be a directory')) {
    return 'project folder unavailable; reconnect it'
  }

  return `runner error: ${message}`
}

function renderUserText(text: string): React.ReactNode {
  return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
}

function ChatView({
  workspaceId,
  userId,
  bootstrap,
  isAssistantConfigured,
  onConfigureAssistant,
  projectFolderPath,
  onReconnectFolder
}: ChatViewProps): React.JSX.Element {
  const messagesByWorkspace = useChatStore((state) => state.messagesByWorkspace)
  const toolTraceByWorkspace = useChatStore((state) => state.toolTraceByWorkspace)
  const saveStatusByWorkspace = useChatStore((state) => state.saveStatusByWorkspace)
  const runStatusByWorkspace = useChatStore((state) => state.runStatusByWorkspace)
  const addMessage = useChatStore((state) => state.addMessage)
  const startAssistantMessage = useChatStore((state) => state.startAssistantMessage)
  const appendMessageText = useChatStore((state) => state.appendMessageText)
  const setMessageText = useChatStore((state) => state.setMessageText)
  const resetToolTrace = useChatStore((state) => state.resetToolTrace)
  const addToolTraceEntry = useChatStore((state) => state.addToolTraceEntry)
  const updateToolTraceEntry = useChatStore((state) => state.updateToolTraceEntry)
  const setSaveStatus = useChatStore((state) => state.setSaveStatus)
  const setRunStatus = useChatStore((state) => state.setRunStatus)
  const loadMessages = useChatStore((state) => state.loadMessages)
  const clearMessages = useChatStore((state) => state.clearMessages)
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [mentionSuggestions, setMentionSuggestions] = useState<typeof bootstrap.project_context.roster>([])
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [, setMentionQuery] = useState('')
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mentionListRef = useRef<HTMLUListElement>(null)
  const activeAssistantIdRef = useRef<string | null>(null)
  const hasAssistantTextRef = useRef(false)
  const currentSessionIdRef = useRef<string | null>(null)
  const messages = messagesByWorkspace[workspaceId] ?? []
  const toolTrace = toolTraceByWorkspace[workspaceId] ?? []
  const saveStatus = saveStatusByWorkspace[workspaceId] ?? null
  const runStatus = runStatusByWorkspace[workspaceId] ?? null
  const rosterById = Object.fromEntries(bootstrap.project_context.roster.map((user) => [user.id, user.display_name]))
  const hasProjectFolder = hasConnectedProjectFolder(projectFolderPath)
  const inputPlaceholder = !hasProjectFolder
    ? 'connect project folder before chatting'
    : isAssistantConfigured
      ? 'type a message...'
      : 'configure Anthropic API key in settings'
  const sendButtonContent: React.ReactNode = isRunning
    ? 'running...'
    : !hasProjectFolder
      ? 'folder'
      : isAssistantConfigured
        ? <Send size={18} />
        : 'settings'
  const sendButtonAriaLabel = isRunning
    ? 'running'
    : !hasProjectFolder
      ? 'connect folder'
      : isAssistantConfigured
        ? 'send message'
        : 'open settings'

  useEffect(() => {
    currentSessionIdRef.current = null
    void window.api.loadConversation(workspaceId).then((persisted) => {
      if (persisted.messages.length > 0) {
        loadMessages(workspaceId, persisted.messages)
      }
      currentSessionIdRef.current = persisted.sessionId
    })
  }, [workspaceId, loadMessages])

  useEffect(() => {
    return window.api.onAssistantEvent((event) => {
      if (event.type === 'memory_update') {
        if (event.status === 'succeeded') {
          setSaveStatus(workspaceId, `memory checkpoint ${event.checkpointIndex ?? ''} saved`.trim())
        } else if (event.status === 'failed') {
          setSaveStatus(workspaceId, `memory update failed: ${event.errorMessage ?? 'unknown error'}`)
        }
        return
      }

      const activeAssistantId = activeAssistantIdRef.current

      if (!activeAssistantId) {
        return
      }

      if (event.type === 'assistant_text') {
        if (!hasAssistantTextRef.current) {
          setMessageText(workspaceId, activeAssistantId, event.text)
          hasAssistantTextRef.current = true
        } else {
          appendMessageText(workspaceId, activeAssistantId, event.text)
        }
        return
      }

      if (event.type === 'tool_call') {
        const input = isToolCallInput(event.input) ? event.input : {}
        const targetUserId = typeof input.target_agent_id === 'string' ? input.target_agent_id : undefined
        addToolTraceEntry(workspaceId, {
          id: event.toolUseId ?? `${event.toolName}-${Date.now()}`,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          targetUserId,
          targetDisplayName: targetUserId ? rosterById[targetUserId] : undefined,
          question: typeof input.query === 'string' ? input.query : undefined,
          status: 'running'
        })
        return
      }

      if (event.type === 'tool_status') {
        const traceId = event.toolUseId ?? event.toolName
        updateToolTraceEntry(workspaceId, traceId, {
          status: 'running',
          elapsedTimeSeconds: event.elapsedTimeSeconds
        })
        return
      }

      if (event.type === 'tool_result') {
        updateToolTraceEntry(workspaceId, event.toolUseId, {
          status: event.errorMessage ? 'failed' : 'succeeded',
          answerPreview: event.result?.summary ? answerPreview(event.result.summary) : undefined,
          errorMessage: event.errorMessage
        })
        return
      }

      if (event.type === 'result') {
        const typedEvent = event as { type: 'result'; result: string; sessionId?: string }
        if (!hasAssistantTextRef.current) {
          setMessageText(workspaceId, activeAssistantId, typedEvent.result)
        }
        setIsRunning(false)
        setRunStatus(workspaceId, null)

        if (typedEvent.sessionId) {
          currentSessionIdRef.current = typedEvent.sessionId
        }

        const currentMessages = useChatStore.getState().messagesByWorkspace[workspaceId] ?? []
        void window.api.saveConversation(workspaceId, {
          sessionId: currentSessionIdRef.current,
          messages: currentMessages.map((m) => ({ id: m.id, role: m.role, text: m.text }))
        })

        setSaveStatus(workspaceId, 'memory checkpoint pending')

        activeAssistantIdRef.current = null
        hasAssistantTextRef.current = false
        return
      }

      if (event.type === 'error') {
        setMessageText(workspaceId, activeAssistantId, `error: ${event.message}`)
        const lastRunningEntry = [...toolTrace].reverse().find((entry) => entry.status === 'running')
        if (lastRunningEntry) {
          updateToolTraceEntry(workspaceId, lastRunningEntry.id, {
            status: 'failed',
            errorMessage: event.message
          })
        }
        setSaveStatus(workspaceId, null)
        setRunStatus(workspaceId, toRunStatusMessage(event.message))
        setIsRunning(false)
        activeAssistantIdRef.current = null
        hasAssistantTextRef.current = false
      }
    })
  }, [
    addToolTraceEntry,
    appendMessageText,
    rosterById,
    setMessageText,
    setSaveStatus,
    toolTrace,
    updateToolTraceEntry,
    setRunStatus,
    workspaceId
  ])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, runStatus, saveStatus, toolTrace])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    const nextHeight = Math.min(el.scrollHeight, 160)
    el.style.height = `${nextHeight}px`
  }, [input])

  useEffect(() => {
    if (mentionSuggestions.length === 0) return
    const list = mentionListRef.current
    if (!list) return
    const activeItem = list.querySelector<HTMLButtonElement>(
      `[data-mention-index="${activeMentionIndex}"]`
    )
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [activeMentionIndex, mentionSuggestions])

  function handleSend(): void {
    if (isRunning) return

    if (!hasProjectFolder) {
      setRunStatus(workspaceId, 'connect project folder before running assistant')
      onReconnectFolder()
      return
    }

    const text = input.trim()
    if (!text) return

    if (!isAssistantConfigured) {
      setRunStatus(workspaceId, 'configure Anthropic API key in settings')
      onConfigureAssistant()
      return
    }

    const userMessageId = Date.now().toString()
    const assistantMessageId = `${userMessageId}-assistant`

    const mentions = parseMentions(text, bootstrap.project_context.roster)
    const mentionedAgentIds = mentions.map((m) => m.userId)

    addMessage(workspaceId, { id: userMessageId, role: 'user', text })
    startAssistantMessage(workspaceId, assistantMessageId)
    setMessageText(workspaceId, assistantMessageId, 'thinking...')
    activeAssistantIdRef.current = assistantMessageId
    hasAssistantTextRef.current = false
    resetToolTrace(workspaceId)
    setSaveStatus(workspaceId, null)
    setRunStatus(workspaceId, null)
    setIsRunning(true)
    setInput('')
    setMentionSuggestions([])
    setActiveMentionIndex(0)

    void window.api
      .startAssistantRun({
        prompt: text,
        bootstrap,
        userId,
        chatSessionId: workspaceId,
        mentionedAgentIds,
        conversationMessages: [
          ...messages.map((message) => ({ role: message.role, text: message.text })),
          { role: 'user' as const, text }
        ]
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown runner error'
        setMessageText(workspaceId, assistantMessageId, `error: ${message}`)
        setSaveStatus(workspaceId, null)
        setRunStatus(workspaceId, toRunStatusMessage(error))
        setIsRunning(false)
        activeAssistantIdRef.current = null
        hasAssistantTextRef.current = false
      })
  }

  function archiveCurrentChat(): void {
    const current = useChatStore.getState().messagesByWorkspace[workspaceId] ?? []
    if (current.length === 0) return
    const entry: ChatHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: deriveTitle(current),
      savedAt: new Date().toISOString(),
      sessionId: currentSessionIdRef.current,
      messages: current.map((m) => ({ id: m.id, role: m.role, text: m.text }))
    }
    const existing = readHistory(workspaceId)
    writeHistory(workspaceId, [entry, ...existing])
  }

  function handleNewChat(): void {
    if (isRunning) return
    archiveCurrentChat()
    clearMessages(workspaceId)
    currentSessionIdRef.current = null
    setSaveStatus(workspaceId, null)
    setRunStatus(workspaceId, null)
    void window.api.clearConversation(workspaceId)
    setHistoryRefreshKey((k) => k + 1)
  }

  function handleLoadHistoryEntry(entry: ChatHistoryEntry): void {
    if (isRunning) return
    archiveCurrentChat()
    const remaining = readHistory(workspaceId).filter((e) => e.id !== entry.id)
    writeHistory(workspaceId, remaining)
    loadMessages(workspaceId, entry.messages)
    currentSessionIdRef.current = entry.sessionId
    setSaveStatus(workspaceId, null)
    setRunStatus(workspaceId, null)
    void window.api.saveConversation(workspaceId, {
      sessionId: entry.sessionId,
      messages: entry.messages
    })
    setHistoryRefreshKey((k) => k + 1)
  }

  function handleInputChange(value: string): void {
    setInput(value)
    const match = value.match(/@(\w*)$/)
    if (match) {
      const query = match[1].toLowerCase()
      setMentionQuery(query)
      const suggestions = bootstrap.project_context.roster.filter((u) =>
        u.display_name.split(' ')[0].toLowerCase().startsWith(query)
      )
      setMentionSuggestions(suggestions)
      setActiveMentionIndex(0)
    } else {
      setMentionSuggestions([])
      setActiveMentionIndex(0)
      setMentionQuery('')
    }
  }

  function handleMentionSelect(user: (typeof bootstrap.project_context.roster)[0]): void {
    const newInput = input.replace(/@\w*$/, `@${user.display_name} `)
    setInput(newInput)
    setMentionSuggestions([])
    setActiveMentionIndex(0)
    setMentionQuery('')
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionSuggestions.length > 0 && event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveMentionIndex((index) => (index + 1) % mentionSuggestions.length)
      return
    }
    if (mentionSuggestions.length > 0 && event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveMentionIndex((index) => (index - 1 + mentionSuggestions.length) % mentionSuggestions.length)
      return
    }
    if (event.key === 'Escape' && mentionSuggestions.length > 0) {
      setMentionSuggestions([])
      setActiveMentionIndex(0)
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && mentionSuggestions.length > 0) {
      event.preventDefault()
      const user = mentionSuggestions[activeMentionIndex]
      if (user) handleMentionSelect(user)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <section className="chat-view chat-view--with-sidebar">
      <ChatHistorySidebar
        workspaceId={workspaceId}
        refreshKey={historyRefreshKey}
        onNewChat={handleNewChat}
        onLoadEntry={handleLoadHistoryEntry}
        disabled={isRunning}
      />
      <div className="chat-main">
      <div className="chat-messages">
        {messages.length === 0 && <p className="chat-empty">type a message to start the chat.</p>}
        {messages.map((message) => (
          <div key={message.id} className={`chat-msg chat-msg--${message.role}`}>
            <div className="chat-msg__header">
              <span className="chat-msg__role">{message.role === 'user' ? 'you' : 'omni'}</span>
            </div>
            <div className="chat-msg__text">
              {message.role === 'assistant'
                ? <MarkdownMessage text={message.text} />
                : renderUserText(message.text)
              }
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {runStatus && runStatus.includes('folder') && (
        <div className="chat-run-status">
          <span>{runStatus}</span>
          <button className="chat-run-status__button" type="button" onClick={onReconnectFolder}>
            reconnect
          </button>
        </div>
      )}
      <div className="chat-input-row">
        {mentionSuggestions.length > 0 && (
          <ul className="mention-suggestions" ref={mentionListRef}>
            {mentionSuggestions.map((user, index) => (
              <li key={user.id}>
                <button
                  type="button"
                  data-mention-index={index}
                  className={`mention-suggestion-item${mentionSuggestions[activeMentionIndex]?.id === user.id ? ' mention-suggestion-item--active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleMentionSelect(user)
                  }}
                  onMouseEnter={() => setActiveMentionIndex(mentionSuggestions.findIndex((item) => item.id === user.id))}
                >
                  <span className="mention-suggestion-name">{user.display_name}</span>
                  {user.domain_summary && (
                    <span className="mention-suggestion-domain">{user.domain_summary}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={1}
          placeholder={inputPlaceholder}
          value={input}
          onChange={(event) => handleInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!hasProjectFolder}
        />
        <div className="chat-actions">
          <button
            className="chat-send"
            type="button"
            onClick={isAssistantConfigured && hasProjectFolder ? handleSend : !hasProjectFolder ? onReconnectFolder : onConfigureAssistant}
            disabled={isRunning}
            aria-label={sendButtonAriaLabel}
            title={sendButtonAriaLabel}
          >
            {sendButtonContent}
          </button>
        </div>
      </div>
      </div>
    </section>
  )
}

export default ChatView
