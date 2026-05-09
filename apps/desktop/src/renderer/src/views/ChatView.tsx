import { useEffect, useRef, useState } from 'react'
import { hasConnectedProjectFolder } from '../projectFolders'
import useChatStore from '../stores/chatStore'

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
  if (!value || typeof value !== 'object') {
    return false
  }

  return true
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

function renderInlineMarkdown(text: string): React.ReactNode[] {
  return text
    .split(/(\*\*.*?\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={index}>{part.slice(2, -2)}</strong>
      }

      return <span key={index}>{part}</span>
    })
}

function renderMessageText(text: string): React.ReactNode {
  const paragraphs = text.split(/\n{2,}/)

  return paragraphs.map((paragraph, paragraphIndex) => (
    <p className="chat-msg__paragraph" key={paragraphIndex}>
      {paragraph.split('\n').map((line, lineIndex) => (
        <span key={lineIndex}>
          {lineIndex > 0 && <br />}
          {renderInlineMarkdown(line)}
        </span>
      ))}
    </p>
  ))
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
  const bottomRef = useRef<HTMLDivElement>(null)
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
  const sendButtonLabel = isRunning ? 'running...' : !hasProjectFolder ? 'folder' : isAssistantConfigured ? 'send' : 'settings'

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

    void window.api
      .startAssistantRun({
        prompt: text,
        bootstrap,
        userId,
        chatSessionId: workspaceId,
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

  function handleNewChat(): void {
    if (isRunning) return
    clearMessages(workspaceId)
    currentSessionIdRef.current = null
    setSaveStatus(workspaceId, null)
    setRunStatus(workspaceId, null)
    void window.api.clearConversation(workspaceId)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <section className="chat-view">
      <div className="chat-messages">
        {messages.length === 0 && <p className="chat-empty">type a message to start the chat.</p>}
        {messages.map((message) => (
          <div key={message.id} className={`chat-msg chat-msg--${message.role}`}>
            <div className="chat-msg__header">
              <span className="chat-msg__role">{message.role === 'user' ? 'you' : 'obni'}</span>
            </div>
            <div className="chat-msg__text">{renderMessageText(message.text)}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {toolTrace.length > 0 && (
        <div className="chat-trace-list">
          {toolTrace.map((entry) => (
            <div className="chat-trace-item" key={entry.id}>
              <div className="chat-trace-item__header">
                <span className="chat-trace-item__tool">{entry.toolName}</span>
                <span className={`chat-trace-item__status chat-trace-item__status--${entry.status}`}>{entry.status}</span>
              </div>
              {entry.targetDisplayName && <div className="chat-trace-item__line">target: {entry.targetDisplayName}</div>}
              {!entry.targetDisplayName && entry.targetUserId && (
                <div className="chat-trace-item__line">target: {entry.targetUserId}</div>
              )}
              {entry.question && <div className="chat-trace-item__line">question: {entry.question}</div>}
              {typeof entry.elapsedTimeSeconds === 'number' && (
                <div className="chat-trace-item__line">elapsed: {Math.round(entry.elapsedTimeSeconds)}s</div>
              )}
              {entry.answerPreview && <div className="chat-trace-item__line">answer: {entry.answerPreview}</div>}
              {entry.errorMessage && <div className="chat-trace-item__line">error: {entry.errorMessage}</div>}
            </div>
          ))}
        </div>
      )}
      {runStatus && (
        <div className="chat-run-status">
          <span>{runStatus}</span>
          {runStatus.includes('folder') && (
            <button className="chat-run-status__button" type="button" onClick={onReconnectFolder}>
              reconnect
            </button>
          )}
        </div>
      )}
      {saveStatus && <div className="chat-save-status">{saveStatus}</div>}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          rows={2}
          placeholder={inputPlaceholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning || !hasProjectFolder}
        />
        <div className="chat-actions">
          <button className="chat-send" type="button" onClick={handleSend} disabled={isRunning}>
            {sendButtonLabel}
          </button>
          {messages.length > 0 && (
            <button className="chat-new" type="button" onClick={handleNewChat} disabled={isRunning} title="Start a new chat">
              new chat
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

export default ChatView
