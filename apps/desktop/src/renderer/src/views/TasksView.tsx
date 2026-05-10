import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Circle, Clock, Sparkles, X, Plus, Trash2 } from 'lucide-react'
import useSuggestionsStore, { activeSubscriptions } from '../stores/suggestionsStore'
import type { TaskSuggestion, SuggestionsPhase } from '../stores/suggestionsStore'

type BootstrapResponse = Awaited<ReturnType<typeof window.api.getBootstrap>>
type BootstrapContextEntry = BootstrapResponse['project_context'][number]

type RunnerBootstrapPayload = {
  user_summary: BootstrapResponse['user']
  project_context: {
    project: BootstrapResponse['project']
    roster: BootstrapResponse['roster']
    recent_entries: BootstrapResponse['recent_entries']
    project_context: BootstrapResponse['project_context']
  }
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

// v3: project-scoped so all member tasks live together
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

// Parse tasks written by teammates from server global memory (bootstrap project_context)
function loadFromBootstrapEntries(entries: BootstrapContextEntry[]): ApprovedTask[] {
  const tasks: ApprovedTask[] = []
  for (const entry of entries) {
    if (entry.metadata?.source !== 'task-board') continue
    try {
      const match = entry.content.match(/(\[[\s\S]*\])/)
      if (!match) continue
      const parsed = JSON.parse(match[1]) as unknown[]
      if (!Array.isArray(parsed)) continue
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue
        const t = item as Record<string, unknown>
        if (typeof t.id !== 'string' || typeof t.title !== 'string') continue
        tasks.push({
          id: t.id,
          title: t.title,
          priority: (['high', 'medium', 'low'].includes(t.priority as string)
            ? t.priority : 'medium') as ApprovedTask['priority'],
          status: (['open', 'in progress', 'done'].includes(t.status as string)
            ? t.status : 'open') as ApprovedTask['status'],
          context: typeof t.context === 'string' ? t.context : '',
          approvedAt: typeof t.approvedAt === 'string' ? t.approvedAt : new Date().toISOString(),
          ownerId: typeof t.ownerId === 'string' ? t.ownerId : '',
          ownerDisplayName: typeof t.ownerDisplayName === 'string' ? t.ownerDisplayName : '',
        })
      }
    } catch {
      // skip malformed entries
    }
  }
  return tasks
}

// Merge server tasks with local tasks; local wins on id conflict (user's own recent changes)
function mergeApproved(fromServer: ApprovedTask[], fromLocal: ApprovedTask[]): ApprovedTask[] {
  const byId = new Map<string, ApprovedTask>()
  for (const t of fromServer) byId.set(t.id, t)
  for (const t of fromLocal) byId.set(t.id, t)
  return Array.from(byId.values())
}

// Canonical content stored as JSON so teammates can read it back from bootstrap entries
function buildTasksCanonicalContent(tasks: ApprovedTask[], ownerDisplayName: string): string {
  if (tasks.length === 0) return `${ownerDisplayName}'s task board:\n[]`
  return `${ownerDisplayName}'s task board:\n${JSON.stringify(tasks)}`
}

function buildTasksEventContent(tasks: ApprovedTask[]): string {
  const open = tasks.filter((t) => t.status === 'open').length
  const inProgress = tasks.filter((t) => t.status === 'in progress').length
  const done = tasks.filter((t) => t.status === 'done').length
  return `Task board updated: ${tasks.length} task${tasks.length !== 1 ? 's' : ''} (${inProgress} in progress, ${open} open, ${done} done)`
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

function AddTaskForm({
  ownerId,
  ownerDisplayName,
  onAdd,
}: {
  ownerId: string
  ownerDisplayName: string
  onAdd: (task: ApprovedTask) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<ApprovedTask['priority']>('medium')

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    onAdd({
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: t,
      priority,
      status: 'open',
      context: '',
      approvedAt: new Date().toISOString(),
      ownerId,
      ownerDisplayName,
    })
    setTitle('')
  }

  return (
    <form className="tasks-add-form" onSubmit={handleSubmit}>
      <input
        className="tasks-add-form__input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`Add a task for ${ownerDisplayName}...`}
        maxLength={120}
      />
      <div className="tasks-add-form__row">
        {(['high', 'medium', 'low'] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`tasks-add-form__pri tasks-add-form__pri--${p}${priority === p ? ' tasks-add-form__pri--active' : ''}`}
            onClick={() => setPriority(p)}
          >
            {p}
          </button>
        ))}
        <button
          type="submit"
          className="tasks-btn tasks-btn--add"
          disabled={!title.trim()}
        >
          <Plus size={13} />
          Add
        </button>
      </div>
    </form>
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
      <div className="task-card__top">
        <button
          type="button"
          className="task-card__status task-card__status--clickable"
          onClick={() => onCycleStatus(task.id)}
          title={`Mark as ${config.next}`}
        >
          <Icon size={14} />
          <span>{config.label}</span>
        </button>
        <div className="task-card__top-actions">
          <PriorityBadge priority={task.priority} />
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
      </div>
      <h3 className="task-card__title">{task.title}</h3>
      {showOwner && (
        <div className="task-card__authors">{task.ownerDisplayName}</div>
      )}
      {task.context && <p className="task-card__context">{task.context}</p>}
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

  const [approved, setApproved] = useState<ApprovedTask[]>(() => {
    const local = loadApproved(projectId)
    const fromServer = loadFromBootstrapEntries(bootstrap.project_context.project_context)
    return mergeApproved(fromServer, local)
  })
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | 'all'>('all')
  const suggestions = useSuggestionsStore((s) => s.phaseByProject[projectId] ?? { kind: 'hidden' } as SuggestionsPhase)
  const setPhase = useSuggestionsStore((s) => s.setPhase)
  const addProgressMessage = useSuggestionsStore((s) => s.addProgressMessage)

  // Reload and re-merge when the active project changes
  useEffect(() => {
    const local = loadApproved(projectId)
    const fromServer = loadFromBootstrapEntries(bootstrap.project_context.project_context)
    setApproved(mergeApproved(fromServer, local))
    setSelectedOwnerId('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const visibleTasks =
    selectedOwnerId === 'all'
      ? approved
      : approved.filter((t) => t.ownerId === selectedOwnerId)

  const selectedMember =
    selectedOwnerId === 'all'
      ? null
      : roster.find((m) => m.id === selectedOwnerId) ?? null

  const syncToMemory = useCallback((allTasks: ApprovedTask[]) => {
    const myTasks = allTasks.filter((t) => t.ownerId === userId)
    window.api.syncTasksToMemory({
      userId,
      projectId,
      eventContent: buildTasksEventContent(myTasks),
      canonicalContent: buildTasksCanonicalContent(myTasks, userDisplayName),
    }).catch(() => { /* silent — localStorage is source of truth */ })
  }, [userId, projectId, userDisplayName])

  const cycleStatus = useCallback(
    (taskId: string) => {
      const next = approved.map((t) =>
        t.id === taskId ? { ...t, status: STATUS_CONFIG[t.status]!.next } : t
      )
      saveApprovedToStorage(projectId, next)
      syncToMemory(next)
      setApproved(next)
    },
    [approved, projectId, syncToMemory]
  )

  const deleteTask = useCallback(
    (taskId: string) => {
      const next = approved.filter((t) => t.id !== taskId)
      saveApprovedToStorage(projectId, next)
      syncToMemory(next)
      setApproved(next)
    },
    [approved, projectId, syncToMemory]
  )

  const addTaskManually = useCallback(
    (task: ApprovedTask) => {
      const next = [...approved, task]
      saveApprovedToStorage(projectId, next)
      syncToMemory(next)
      setApproved(next)
    },
    [approved, projectId, syncToMemory]
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
      const next = [...approved, newTask]
      saveApprovedToStorage(projectId, next)
      syncToMemory(next)
      setApproved(next)
      if (suggestions.kind === 'visible') {
        const remaining = suggestions.suggestions.filter((s) => s.id !== suggestion.id)
        setPhase(projectId, remaining.length === 0 ? { kind: 'hidden' } : { ...suggestions, suggestions: remaining })
      }
    },
    [approved, projectId, selectedOwnerId, userId, userDisplayName, roster, syncToMemory, suggestions, setPhase]
  )

  const dismissSuggestion = useCallback((id: string) => {
    if (suggestions.kind === 'visible') {
      const remaining = suggestions.suggestions.filter((s) => s.id !== id)
      setPhase(projectId, remaining.length === 0 ? { kind: 'hidden' } : { ...suggestions, suggestions: remaining })
    }
  }, [suggestions, projectId, setPhase])

  const getSuggestions = useCallback(async () => {
    activeSubscriptions.get(projectId)?.()
    activeSubscriptions.delete(projectId)
    setPhase(projectId, { kind: 'generating', progressMessages: [] })

    const targetDisplayName = selectedMember?.display_name ?? userDisplayName
    const targetDomain =
      selectedMember?.domain_summary ?? bootstrap.user_summary.domain_summary ?? ''

    const unsubscribe = window.api.onAssistantEvent((event) => {
      if (event.type === 'tool_call') {
        const query = (event.input as Record<string, unknown> | undefined)?.query
        const label = typeof query === 'string' ? query : event.toolName
        addProgressMessage(projectId, `querying: ${label}`)
        return
      }
      if (event.type === 'result') {
        activeSubscriptions.delete(projectId)
        unsubscribe()
        try {
          const parsed = parseSuggestionsJson(event.result)
          setPhase(projectId, { kind: 'visible', suggestions: parsed })
        } catch (err) {
          setPhase(projectId, { kind: 'error', message: String(err) })
        }
        return
      }
      if (event.type === 'error') {
        activeSubscriptions.delete(projectId)
        unsubscribe()
        setPhase(projectId, { kind: 'error', message: event.message })
      }
    })

    activeSubscriptions.set(projectId, unsubscribe)

    try {
      await window.api.startAssistantRun({
        prompt: buildPrompt(targetDisplayName, projectName, targetDomain),
        cwd: projectFolderPath ?? undefined,
        bootstrap,
        userId,
        maxTurns: 4,
        suggestionsContextQueries: [
          'team responsibilities, current assignments, and recent activity',
          `${targetDisplayName} work in progress, blockers, and open items`,
        ],
      })
    } catch (err) {
      activeSubscriptions.delete(projectId)
      unsubscribe()
      setPhase(projectId, { kind: 'error', message: String(err) })
    }
  }, [bootstrap, userId, userDisplayName, projectName, projectFolderPath, selectedMember, projectId, setPhase, addProgressMessage])

  const isGenerating = suggestions.kind === 'generating'
  const showOwnerOnCards = selectedOwnerId === 'all'

  const addFormOwnerId = selectedOwnerId === 'all' ? userId : selectedOwnerId
  const addFormOwnerDisplayName =
    selectedOwnerId === 'all'
      ? userDisplayName
      : (roster.find((m) => m.id === selectedOwnerId)?.display_name ?? userDisplayName)

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

      {/* Manual add form */}
      <AddTaskForm
        ownerId={addFormOwnerId}
        ownerDisplayName={addFormOwnerDisplayName}
        onAdd={addTaskManually}
      />

      {/* Task grid */}
      {visibleTasks.length === 0 ? (
        <div className="tasks-approved-empty">
          <p>
            {selectedOwnerId === 'all'
              ? 'no tasks yet — add one above or get AI suggestions'
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
