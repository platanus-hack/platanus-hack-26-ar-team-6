import { Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import useChatStore from '../stores/chatStore'
import useWorkspaceStore from '../stores/workspaceStore'

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
  apiBaseUrl: string
  authToken: string
  bootstrap: RunnerBootstrapPayload
  isAssistantConfigured: boolean
  onConfigureAssistant: () => void
}

type ToolCallInput = {
  target?: string
  question?: string
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
    return 'invalid repo path'
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
  apiBaseUrl,
  authToken,
  bootstrap,
  isAssistantConfigured,
  onConfigureAssistant
}: ChatViewProps): React.JSX.Element {
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId)
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
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeAssistantIdRef = useRef<string | null>(null)
  const activePromptRef = useRef('')
  const hasAssistantTextRef = useRef(false)
  const workspaceId = currentWorkspaceId ?? 'default'
  const messages = messagesByWorkspace[workspaceId] ?? []
  const toolTrace = toolTraceByWorkspace[workspaceId] ?? []
  const saveStatus = saveStatusByWorkspace[workspaceId] ?? null
  const runStatus = runStatusByWorkspace[workspaceId] ?? null
  const rosterById = Object.fromEntries(bootstrap.project_context.roster.map((user) => [user.id, user.display_name]))

  useEffect(() => {
    return window.api.onAssistantEvent((event) => {
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
        const targetUserId = typeof input.target === 'string' ? input.target : undefined
        addToolTraceEntry(workspaceId, {
          id: event.toolUseId ?? `${event.toolName}-${Date.now()}`,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          targetUserId,
          targetDisplayName: targetUserId ? rosterById[targetUserId] : undefined,
          question: typeof input.question === 'string' ? input.question : undefined,
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
          answerPreview: event.result?.answer ? answerPreview(event.result.answer) : undefined,
          errorMessage: event.errorMessage
        })
        return
      }

      if (event.type === 'result') {
        if (!hasAssistantTextRef.current) {
          setMessageText(workspaceId, activeAssistantId, event.result)
        }
        setIsRunning(false)
        setRunStatus(workspaceId, null)

        if (!authToken.trim()) {
          setSaveStatus(workspaceId, 'not saved: missing auth token')
        } else {
          void window.api
            .savePromptAnswer({
              apiBaseUrl,
              authToken,
              prompt: activePromptRef.current,
              finalAnswer: event.result,
              metadata: {
                source: 'desktop-app'
              }
            })
            .then(() => {
              setSaveStatus(workspaceId, 'saved')
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : 'save failed'
              setSaveStatus(workspaceId, `save failed: ${message}`)
            })
        }

        activeAssistantIdRef.current = null
        activePromptRef.current = ''
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
        activePromptRef.current = ''
        hasAssistantTextRef.current = false
      }
    })
  }, [
    addToolTraceEntry,
    apiBaseUrl,
    appendMessageText,
    authToken,
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
    const text = input.trim()
    if (!text || isRunning) return

    if (!isAssistantConfigured) {
      setRunStatus(workspaceId, 'configure Anthropic API key in settings')
      onConfigureAssistant()
      return
    }

    const userMessageId = Date.now().toString()
    const assistantMessageId = `${userMessageId}-assistant`
    const repoPath = import.meta.env.VITE_LOCAL_REPO_PATH || '.'
    const userId = import.meta.env.VITE_USER_ID || 'user1'

    addMessage(workspaceId, { id: userMessageId, role: 'user', text })
    startAssistantMessage(workspaceId, assistantMessageId)
    setMessageText(workspaceId, assistantMessageId, 'thinking...')
    activeAssistantIdRef.current = assistantMessageId
    activePromptRef.current = text
    hasAssistantTextRef.current = false
    resetToolTrace(workspaceId)
    setSaveStatus(workspaceId, null)
    setRunStatus(workspaceId, null)
    setIsRunning(true)
    setInput('')

    void window.api
      .startAssistantRun({
        prompt: text,
        cwd: repoPath,
        bootstrap,
        serverUrl: apiBaseUrl,
        userId,
        authToken
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown runner error'
        setMessageText(workspaceId, assistantMessageId, `error: ${message}`)
        setSaveStatus(workspaceId, null)
        setRunStatus(workspaceId, toRunStatusMessage(error))
        setIsRunning(false)
        activeAssistantIdRef.current = null
        activePromptRef.current = ''
        hasAssistantTextRef.current = false
      })
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
      {runStatus && <div className="chat-run-status">{runStatus}</div>}
      {saveStatus && <div className="chat-save-status">{saveStatus}</div>}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          rows={1}
          placeholder={isAssistantConfigured ? 'type a message...' : 'configure Anthropic API key in settings'}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
        />
        <button
          className="chat-send"
          type="button"
          onClick={isAssistantConfigured ? handleSend : onConfigureAssistant}
          disabled={isRunning}
        >
          {isRunning ? 'running...' : <Send size={16} strokeWidth={2} />}
        </button>
      </div>
    </section>
  )
}

export default ChatView
