import { useEffect, useState } from 'react'
import { SquarePen, Trash2 } from 'lucide-react'

export type ChatHistoryMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export type ChatHistoryEntry = {
  id: string
  title: string
  savedAt: string
  sessionId: string | null
  messages: ChatHistoryMessage[]
}

const STORAGE_PREFIX = 'omni:chat-history:'
const MAX_ENTRIES = 50

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`
}

export function readHistory(workspaceId: string): ChatHistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as ChatHistoryEntry[]
  } catch {
    return []
  }
}

export function writeHistory(workspaceId: string, entries: ChatHistoryEntry[]): void {
  try {
    localStorage.setItem(
      storageKey(workspaceId),
      JSON.stringify(entries.slice(0, MAX_ENTRIES))
    )
  } catch {
    // ignore quota errors
  }
}

export function deriveTitle(messages: ChatHistoryMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return 'untitled chat'
  const text = firstUser.text.replace(/\s+/g, ' ').trim()
  if (!text) return 'untitled chat'
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

type ChatHistorySidebarProps = {
  workspaceId: string
  refreshKey: number
  onNewChat: () => void
  onLoadEntry: (entry: ChatHistoryEntry) => void
  disabled?: boolean
}

function ChatHistorySidebar({
  workspaceId,
  refreshKey,
  onNewChat,
  onLoadEntry,
  disabled
}: ChatHistorySidebarProps): React.JSX.Element {
  const [entries, setEntries] = useState<ChatHistoryEntry[]>([])

  useEffect(() => {
    setEntries(readHistory(workspaceId))
  }, [workspaceId, refreshKey])

  function handleDelete(id: string, e: React.MouseEvent): void {
    e.stopPropagation()
    const next = entries.filter((entry) => entry.id !== id)
    setEntries(next)
    writeHistory(workspaceId, next)
  }

  return (
    <aside className="chat-history">
      <button
        type="button"
        className="chat-history__new"
        onClick={onNewChat}
        disabled={disabled}
        title="start a new chat"
      >
        <SquarePen size={15} />
        <span>new chat</span>
      </button>

      <div className="chat-history__list">
        {entries.length === 0 ? (
          <div className="chat-history__empty">no past chats yet</div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="chat-history__item"
              onClick={() => onLoadEntry(entry)}
              disabled={disabled}
              title={entry.title}
            >
              <span className="chat-history__item-title">{entry.title}</span>
              <span className="chat-history__item-meta">
                {new Date(entry.savedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
                {' · '}
                {entry.messages.length} msg
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label="delete chat"
                className="chat-history__item-delete"
                onClick={(e) => handleDelete(entry.id, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleDelete(entry.id, e as unknown as React.MouseEvent)
                  }
                }}
              >
                <Trash2 size={13} />
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}

export default ChatHistorySidebar
