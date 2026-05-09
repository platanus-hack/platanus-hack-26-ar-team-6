import { useEffect, useRef, useState } from 'react'
import agents from '../fixtures/agents.json'
import useChatStore from '../stores/chatStore'
import useWorkspaceStore from '../stores/workspaceStore'

const fixtureBootstrap = {
  user_summary: {
    user_id: 'marf',
    display_name: 'Marf'
  },
  project_context: {
    roster: agents
  }
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  return text.split(/(\*\*.*?\*\*)/g).filter(Boolean).map((part, index) => {
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

function ChatView(): React.JSX.Element {
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId)
  const messagesByWorkspace = useChatStore((state) => state.messagesByWorkspace)
  const toolStatusByWorkspace = useChatStore((state) => state.toolStatusByWorkspace)
  const addMessage = useChatStore((state) => state.addMessage)
  const startAssistantMessage = useChatStore((state) => state.startAssistantMessage)
  const appendMessageText = useChatStore((state) => state.appendMessageText)
  const setMessageText = useChatStore((state) => state.setMessageText)
  const setToolStatus = useChatStore((state) => state.setToolStatus)
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeAssistantIdRef = useRef<string | null>(null)
  const hasAssistantTextRef = useRef(false)
  const workspaceId = currentWorkspaceId ?? 'default'
  const messages = messagesByWorkspace[workspaceId] ?? []
  const toolStatus = toolStatusByWorkspace[workspaceId] ?? null

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
        setToolStatus(workspaceId, `tool: ${event.toolName}`)
        return
      }

      if (event.type === 'tool_status') {
        const elapsedSuffix =
          typeof event.elapsedTimeSeconds === 'number' ? ` (${Math.round(event.elapsedTimeSeconds)}s)` : ''
        setToolStatus(workspaceId, `running ${event.toolName}${elapsedSuffix}`)
        return
      }

      if (event.type === 'result') {
        if (!hasAssistantTextRef.current) {
          setMessageText(workspaceId, activeAssistantId, event.result)
        }
        setToolStatus(workspaceId, null)
        setIsRunning(false)
        activeAssistantIdRef.current = null
        hasAssistantTextRef.current = false
        return
      }

      if (event.type === 'error') {
        setMessageText(workspaceId, activeAssistantId, `error: ${event.message}`)
        setToolStatus(workspaceId, 'run failed')
        setIsRunning(false)
        activeAssistantIdRef.current = null
        hasAssistantTextRef.current = false
      }
    })
  }, [appendMessageText, setMessageText, setToolStatus, workspaceId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, toolStatus])

  function handleSend(): void {
    const text = input.trim()
    if (!text || isRunning) return

    const userMessageId = Date.now().toString()
    const assistantMessageId = `${userMessageId}-assistant`
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'https://creative-possibility-production-f2af.up.railway.app'
    const repoPath = import.meta.env.VITE_LOCAL_REPO_PATH || '.'
    const userId = import.meta.env.VITE_USER_ID || 'marf'

    addMessage(workspaceId, { id: userMessageId, role: 'user', text })
    startAssistantMessage(workspaceId, assistantMessageId)
    setMessageText(workspaceId, assistantMessageId, 'thinking...')
    activeAssistantIdRef.current = assistantMessageId
    hasAssistantTextRef.current = false
    setToolStatus(workspaceId, null)
    setIsRunning(true)
    setInput('')

    void window.api
      .startAssistantRun({
        prompt: text,
        cwd: repoPath,
        bootstrap: fixtureBootstrap,
        serverUrl: apiBaseUrl,
        userId
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown runner error'
        setMessageText(workspaceId, assistantMessageId, `error: ${message}`)
        setToolStatus(workspaceId, 'run failed')
        setIsRunning(false)
        activeAssistantIdRef.current = null
        hasAssistantTextRef.current = false
      })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <section className="chat-view">
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">type a message to start the chat.</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg chat-msg--${msg.role}`}>
            <div className="chat-msg__header">
              <span className="chat-msg__role">{msg.role === 'user' ? 'you' : 'obni'}</span>
            </div>
            <div className="chat-msg__text">{renderMessageText(msg.text)}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {toolStatus && <div className="chat-tool-status">{toolStatus}</div>}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          rows={2}
          placeholder="type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
        />
        <button className="chat-send" type="button" onClick={handleSend} disabled={isRunning}>
          {isRunning ? 'running...' : 'send'}
        </button>
      </div>
    </section>
  )
}

export default ChatView
