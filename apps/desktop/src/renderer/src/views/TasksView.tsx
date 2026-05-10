import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Clock, Sparkles, X, Plus, Trash2 } from 'lucide-react'

type RunnerBootstrapPayload = {
  user_summary: BootstrapResponse['user']
  project_context: {
    project: BootstrapResponse['project']
    roster: BootstrapResponse['roster']
    recent_entries: BootstrapResponse['recent_entries']
    project_context: BootstrapResponse['project_context']
  }
}

type TaskSuggestion = {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  context: string
}

type ApprovedTask = {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  status: 'open' | 'in progress' | 'done'
  context: string
  approvedAt: string
  ownerId: string
  ownerDisplayName: string
}

type SuggestionsPhase =
  | { kind: 'hidden' }
  | { kind: 'generating'; progressMessages: string[] }
  | { kind: 'visible'; suggestions: TaskSuggestion[] }
  | { kind: 'error'; message: string }

type TasksViewProps = {
  bootstrap: RunnerBootstrapPayload
  userId: string
  userDisplayName: string
  projectId: string
  projectName: string
  projectFolderPath: string | null
}

type StatusConfig = {
  icon: typeof Circle
  label: string
  className: string
  next: 'open' | 'in progress' | 'done'
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  open: { icon: Circle, label: 'Open', className: 'task-card--open', next: 'in progress' },
  'in progress': { icon: Clock, label: 'In progress', className: 'task-card--progress', next: 'done' },
  done: { icon: CheckCircle2, label: 'Done', className: 'task-card--done', next: 'open' },
}

// v3: project-scoped (not user-scoped) so all member tasks live together
function storageKey(projectId: string): string {
  return `relevo:tasks:v3:${projectId}`
}

function loadApproved(projectId: string): ApprovedTask[] {
  try {
    const stored = localStorage.getItem(storageKey(projectId))
    if (!stored) return []
    const parsed = JSON.parse(stored) as { approved?: ApprovedTask[] }
    return Array.isArray(parsed.approved) ? parsed.approved : []
  } catch {
    return []
  }
}

function saveApprovedToStorage(projectId: string, tasks: ApprovedTask[]): void {
  localStorage.setItem(storageKey(projectId), JSON.stringify({ approved: tasks }))
}

function parseSuggestionsJson(raw: string): TaskSuggestion[] {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const str = (fenceMatch ? fenceMatch[1] : raw).trim()
  const arr = JSON.parse(str)
  if (!Array.isArray(arr)) throw new Error('expected JSON array')
  return arr.map((item: Record<string, unknown>, i: number) => ({
    id: String(item.id ?? `suggestion-${i}`),
    title: String(item.title ?? ''),
    priority: (['high', 'medium', 'low'].includes(item.priority as string)
      ? item.priority
      : 'medium') as TaskSuggestion['priority'],
    context: String(item.context ?? ''),
  }))
}

function buildPrompt(
  targetDisplayName: string,
  projectName: string,
  domainSummary: string
): string {
  return `You are helping ${targetDisplayName} figure out what to work on next in the project "${projectName}".

Their role and expertise: ${domainSummary || 'not specified'}

Use the ask_retriever tool exactly twice:
1. query: "team responsibilities, current assignments, and recent activity"
2. query: "${targetDisplayName} work in progress, blockers, and open items"

Based on the retrieved context, suggest 3–6 tasks SPECIFICALLY for ${targetDisplayName} that match their domain and address what is unfinished, blocked, or most needed from their area.

Return ONLY a valid JSON array — no prose, no markdown outside the array. Each object:
{
  "id": "<unique string, e.g. task-1>",
  "title": "<concise action phrase, max 10 words>",
  "priority": "<high | medium | low>",
  "context": "<one sentence: why this matters now>"
}

Order by priority descending.`
}

function PriorityBadge({ priority }: { priority: TaskSuggestion['priority'] }): React.JSX.Element {
  return (
    <span className={`task-card__priority task-card__priority--${priority}`}>{priority}</span>
  )
}

function ApprovedTaskCard({
  task,
  showOwner,
  onCycleStatus,
  onDelete,
}: {
  task: ApprovedTask
  showOwner: boolean
  onCycleStatus: (id: string) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.open!
  const Icon = config.icon
  return (
    <div className={`task-card ${config.className}`}>
      <button
        type="button"
        className="task-card__status task-card__status--clickable"
        onClick={() => onCycleStatus(task.id)}
        title={`Mark as ${config.next}`}
      >
        <Icon size={14} />
        <span>{config.label}</span>
      </button>
      <h3 className="task-card__title">{task.title}</h3>
      {showOwner && (
        <div className="task-card__authors">{task.ownerDisplayName}</div>
      )}
      <PriorityBadge priority={task.priority} />
      {task.context && <p className="task-card__context">{task.context}</p>}
      <button
        type="button"
        className="task-card__delete"
        onClick={() => onDelete(task.id)}
        title="Remove task"
        aria-label="Remove task"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function SuggestionCard({
  suggestion,
  onApprove,
  onDismiss,
}: {
  suggestion: TaskSuggestion
  onApprove: (s: TaskSuggestion) => void
  onDismiss: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="suggestion-card">
      <div className="suggestion-card__header">
        <PriorityBadge priority={suggestion.priority} />
      </div>
      <p className="suggestion-card__title">{suggestion.title}</p>
      {suggestion.context && (
        <p className="suggestion-card__context">{suggestion.context}</p>
      )}
      <div className="suggestion-card__actions">
        <button
          type="button"
          className="suggestion-btn suggestion-btn--dismiss"
          onClick={() => onDismiss(suggestion.id)}
        >
          <X size={12} />
          Dismiss
        </button>
        <button
          type="button"
          className="suggestion-btn suggestion-btn--approve"
          onClick={() => onApprove(suggestion)}
        >
          <Plus size={12} />
          Add to tasks
        </button>
      </div>
    </div>
  )
}

function TasksView({
  bootstrap,
  userId,
  userDisplayName,
  projectId,
  projectName,
  projectFolderPath,
}: TasksViewProps): React.JSX.Element {
  const roster = bootstrap.project_context.roster

  const [approved, setApproved] = useState<ApprovedTask[]>(() =>
    loadApproved(projectId)
  )
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | 'all'>('all')
  const [suggestions, setSuggestions] = useState<SuggestionsPhase>({ kind: 'hidden' })

  useEffect(() => {
    setApproved(loadApproved(projectId))
    setSelectedOwnerId('all')
    setSuggestions({ kind: 'hidden' })
  }, [projectId])

  const unsubscribeRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { unsubscribeRef.current?.() }, [])

  const visibleTasks =
    selectedOwnerId === 'all'
      ? approved
      : approved.filter((t) => t.ownerId === selectedOwnerId)

  const selectedMember =
    selectedOwnerId === 'all'
      ? null
      : roster.find((m) => m.id === selectedOwnerId) ?? null

  const cycleStatus = useCallback(
    (taskId: string) => {
      setApproved((prev) => {
        const next = prev.map((t) =>
          t.id === taskId ? { ...t, status: STATUS_CONFIG[t.status]!.next } : t
        )
        saveApprovedToStorage(projectId, next)
        return next
      })
    },
    [projectId]
  )

  const deleteTask = useCallback(
    (taskId: string) => {
      setApproved((prev) => {
        const next = prev.filter((t) => t.id !== taskId)
        saveApprovedToStorage(projectId, next)
        return next
      })
    },
    [projectId]
  )

  const approveSuggestion = useCallback(
    (suggestion: TaskSuggestion) => {
      const ownerId = selectedOwnerId === 'all' ? userId : selectedOwnerId
      const ownerDisplayName =
        selectedOwnerId === 'all'
          ? userDisplayName
          : (roster.find((m) => m.id === selectedOwnerId)?.display_name ?? userDisplayName)

      const newTask: ApprovedTask = {
        ...suggestion,
        status: 'open',
        approvedAt: new Date().toISOString(),
        ownerId,
        ownerDisplayName,
      }
      setApproved((prev) => {
        const next = [...prev, newTask]
        saveApprovedToStorage(projectId, next)
        return next
      })
      setSuggestions((prev) => {
        if (prev.kind !== 'visible') return prev
        const remaining = prev.suggestions.filter((s) => s.id !== suggestion.id)
        return remaining.length === 0 ? { kind: 'hidden' } : { ...prev, suggestions: remaining }
      })
    },
    [projectId, selectedOwnerId, userId, userDisplayName, roster]
  )

  const dismissSuggestion = useCallback((id: string) => {
    setSuggestions((prev) => {
      if (prev.kind !== 'visible') return prev
      const remaining = prev.suggestions.filter((s) => s.id !== id)
      return remaining.length === 0 ? { kind: 'hidden' } : { ...prev, suggestions: remaining }
    })
  }, [])

  const getSuggestions = useCallback(async () => {
    unsubscribeRef.current?.()
    setSuggestions({ kind: 'generating', progressMessages: [] })

    const targetDisplayName = selectedMember?.display_name ?? userDisplayName
    const targetDomain =
      selectedMember?.domain_summary ?? bootstrap.user_summary.domain_summary ?? ''

    const unsubscribe = window.api.onAssistantEvent((event) => {
      if (event.type === 'tool_call') {
        const query = (event.input as Record<string, unknown> | undefined)?.query
        const label = typeof query === 'string' ? query : event.toolName
        setSuggestions((prev) =>
          prev.kind === 'generating'
            ? { ...prev, progressMessages: [...prev.progressMessages, `querying: ${label}`] }
            : prev
        )
        return
      }
      if (event.type === 'result') {
        unsubscribeRef.current = null
        unsubscribe()
        try {
          const parsed = parseSuggestionsJson(event.result)
          setSuggestions({ kind: 'visible', suggestions: parsed })
        } catch (err) {
          setSuggestions({ kind: 'error', message: String(err) })
        }
        return
      }
      if (event.type === 'error') {
        unsubscribeRef.current = null
        unsubscribe()
        setSuggestions({ kind: 'error', message: event.message })
      }
    })

    unsubscribeRef.current = unsubscribe

    try {
      await window.api.startAssistantRun({
        prompt: buildPrompt(targetDisplayName, projectName, targetDomain),
        cwd: projectFolderPath ?? undefined,
        bootstrap,
        userId,
        maxTurns: 4,
      })
    } catch (err) {
      unsubscribeRef.current = null
      unsubscribe()
      setSuggestions({ kind: 'error', message: String(err) })
    }
  }, [bootstrap, userId, userDisplayName, projectName, projectFolderPath, selectedMember])

  const isGenerating = suggestions.kind === 'generating'
  const showOwnerOnCards = selectedOwnerId === 'all'

  const suggestLabel = isGenerating
    ? 'analyzing...'
    : selectedMember
      ? `Suggest for ${selectedMember.display_name}`
      : 'Get suggestions'

  return (
    <section className="content-panel tasks-view">
      {/* Slicer + action row */}
      <div className="tasks-header">
        <div className="tasks-slicer">
          <button
            type="button"
            className={`tasks-slicer__pill ${selectedOwnerId === 'all' ? 'tasks-slicer__pill--active' : ''}`}
            onClick={() => setSelectedOwnerId('all')}
          >
            All
          </button>
          {roster.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`tasks-slicer__pill ${selectedOwnerId === member.id ? 'tasks-slicer__pill--active' : ''}`}
              onClick={() => setSelectedOwnerId(member.id)}
            >
              {member.display_name}
              {member.id === userId && <span className="tasks-slicer__you">you</span>}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="tasks-btn tasks-btn--suggest"
          onClick={() => void getSuggestions()}
          disabled={isGenerating}
        >
          <Sparkles size={13} />
          {suggestLabel}
        </button>
      </div>

      {/* Task grid */}
      {visibleTasks.length === 0 ? (
        <div className="tasks-approved-empty">
          <p>
            {selectedOwnerId === 'all'
              ? 'no tasks yet — get suggestions and add what you want to work on'
              : `no tasks for ${selectedMember?.display_name ?? 'this person'} yet`}
          </p>
        </div>
      ) : (
        <div className="tasks-grid">
          {visibleTasks.map((task) => (
            <ApprovedTaskCard
              key={task.id}
              task={task}
              showOwner={showOwnerOnCards}
              onCycleStatus={cycleStatus}
              onDelete={deleteTask}
            />
          ))}
        </div>
      )}

      {/* Suggestions panel */}
      {suggestions.kind !== 'hidden' && (
        <div className="tasks-suggestions-panel">
          <div className="tasks-suggestions-header">
            <span className="tasks-suggestions-header__label">
              <Sparkles size={13} />
              {suggestions.kind === 'generating' && 'finding suggestions...'}
              {suggestions.kind === 'visible' &&
                `${suggestions.suggestions.length} suggestion${suggestions.suggestions.length !== 1 ? 's' : ''}${selectedMember ? ` for ${selectedMember.display_name}` : ''}`}
              {suggestions.kind === 'error' && 'suggestions failed'}
            </span>
            <button
              type="button"
              className="tasks-suggestions-close"
              onClick={() => setSuggestions({ kind: 'hidden' })}
              aria-label="Close suggestions"
            >
              <X size={14} />
            </button>
          </div>

          {suggestions.kind === 'generating' && (
            <div className="tasks-suggestions-generating">
              <span className="tasks-spinner" aria-hidden="true" />
              {suggestions.progressMessages.length > 0 && (
                <ul className="tasks-generating__progress">
                  {suggestions.progressMessages.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {suggestions.kind === 'error' && (
            <div className="tasks-suggestions-error">
              <p>{suggestions.message}</p>
              <button
                type="button"
                className="tasks-btn"
                onClick={() => void getSuggestions()}
              >
                Try again
              </button>
            </div>
          )}

          {suggestions.kind === 'visible' && (
            <div className="suggestions-list">
              {suggestions.suggestions.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  onApprove={approveSuggestion}
                  onDismiss={dismissSuggestion}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default TasksView
